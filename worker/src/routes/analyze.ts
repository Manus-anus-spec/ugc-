/**
 * POST /analyze — the heart (FABLE5-PLAN Phase 2 + Phase 5 long-form + v3 perception).
 * multipart: videoUrl (string) OR video (file) — names from shared/fields.ts.
 *
 * v3 MULTI-PASS PERCEPTION (Part A of the reproduce upgrade). Without fps sampling
 * Gemini sees ~1 frame/sec and INVENTS every sub-second cut and motion timing:
 *  - PASS A  boundary+motion map: whole clip, LOW res, ~8fps, temp 0, FAST model,
 *            run twice — only cuts agreed by both runs survive (self-consistency vote).
 *  - MAIN    perception call (Pro): whole clip at duration-gated fps/res, grounded
 *            with the Pass-A cut map; fills the full DNA minus the virality essay.
 *  - GATE    numeric self-consistency BEFORE acceptance: monotonic beats, durations
 *            sum to total, beat boundaries land on measured cuts. Failure → ONE
 *            SCOPED repair (only the offending windows re-attached at higher fps),
 *            then deterministic normalization with timingConfidence stamped 'low'.
 *  - PASS B  per-shot clipped calls (Pro, HIGH res): shotSize/angle/lens/motion detail.
 *  - MICRO   10-15fps over 1-3s motion windows (FAST): the sub-second body motion.
 *  - VIRALITY text-only scorecard on the FAST model over the extracted DNA — never
 *            re-grounds Pro over the whole clip (spend safety).
 * Every fps/res choice passes through fitVideoSampling so no call can blow budget.
 *
 * Long-form (Phase 5): duration from File API metadata drives
 *  - resolution tiering: ≤90s HIGH, >90s MEDIUM at 1fps (no high-fps passes)
 *  - routing: >300s runs as an async JOB — 202 {job:{id}}, client polls /jobs/:id.
 */
import { z } from 'zod';
import {
  AnalyzerBeatSchema, AnalyzerOutputSchema, BoundaryMapSchema, MotionWindowDetailSchema,
  GroundTruthSchema, PerceptionOutputSchema, RUBRIC_VERSION, ViralityScorecardSchema,
} from '../../../shared/schemas';
import type { AnalyzeResponse, FormatDna, PerceptionOutput, Platform, ViralityScorecard } from '../../../shared/contract';
import { ANALYZE_FIELDS } from '../../../shared/fields';
import { API_VERSION, type Env } from '../env';
import { err, json, newId, nowIso } from '../http';
import { formatInsertStatements } from '../db';
import { ResolverError, fetchVideo, resolveVideoUrl } from '../resolvers';
import { LimitError, assertUploadWithinCap, resolveVideoMime } from '../limits';
import {
  callGeminiJson, deleteGeminiFile, extractJson, fitVideoSampling, geminiKeys, secs,
  uploadToGemini, withGeminiKeyFailover, type GeminiFile, type GeminiPart, type MediaResolution,
} from '../gemini';
import {
  ANALYZER_SYSTEM_INSTRUCTION, BOUNDARY_SYSTEM_INSTRUCTION, CLIP_ANALYST_SYSTEM_INSTRUCTION,
  VIRALITY_SYSTEM_INSTRUCTION, buildCutMapGrounding, buildMotionWindowPrompt, buildRepairPrompt,
  buildTranscriptGrounding,
  buildSamplingPreamble, buildShotDetailPrompt, buildTimingRepairPrompt,
} from '../prompt';

const PERCEPTION_JSON_SCHEMA = z.toJSONSchema(PerceptionOutputSchema) as Record<string, unknown>;
const BOUNDARY_JSON_SCHEMA = z.toJSONSchema(BoundaryMapSchema) as Record<string, unknown>;
const VIRALITY_JSON_SCHEMA = z.toJSONSchema(ViralityScorecardSchema) as Record<string, unknown>;

/** Pass B fills exactly the per-shot filming fields — a pick of the analyzer beat. */
const ShotDetailSchema = AnalyzerBeatSchema.pick({
  shotSize: true, cameraAngle: true, lensFeel: true,
  motionBeat: true, secondaryMotion: true, microExpression: true,
});
const SHOT_DETAIL_JSON_SCHEMA = z.toJSONSchema(ShotDetailSchema) as Record<string, unknown>;

const ASYNC_THRESHOLD_SEC = 300;
const HIGH_RES_MAX_SEC = 90;
const SHORT_FORM_MAX_SEC = 60;       // high-fps perception only below this (spend gate)

const PASS_A_FPS = 8;
const PASS_A_BUDGET_TOKENS = 60_000;
const MAIN_FPS_SHORT = 4;
const MAIN_BUDGET_TOKENS = 160_000;
const PASS_B_FPS = 4;
const PASS_B_BUDGET_TOKENS = 40_000;
const PASS_B_MAX_SHOTS = 12;
const MICRO_FPS = 12;
const MICRO_BUDGET_TOKENS = 30_000;
const MICRO_MAX_WINDOWS = 6;
const DETAIL_CONCURRENCY = 3;        // bounded fan-out for clipped calls
const CUT_VOTE_TOLERANCE_SEC = 0.3;
const CUT_ALIGN_TOLERANCE_SEC = 0.35;

const ANALYZE_USER_PROMPT =
  'Analyze this UGC video and return its complete FORMAT DNA as one JSON object following the system instructions exactly.';

function zodIssuesToText(error: z.ZodError): string {
  return error.issues
    .slice(0, 40)
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(extractJson(text));
  } catch {
    return undefined; // fails schema validation → triggers the repair path
  }
}

interface SourceInfo {
  parts: GeminiPart[];
  geminiFileName: string | null;
  sourceUrl?: string;
  platform: Platform;
  thumbnailUrl?: string;
  durationSec?: number;
  /** The key whose Google project owns the uploaded File API file — every later call
   *  (analysis, delete) MUST reuse it. Undefined for YouTube URLs (not project-bound),
   *  where the analysis call itself is free to fail over between keys. */
  apiKey?: string;
}

/** Upload with spend-cap failover: if the primary project's cap is exhausted,
 *  retry the upload on the fallback key's project and bind the pipeline to it. */
async function uploadWithFailover(env: Env, buffer: ArrayBuffer, mimeType: string): Promise<{ file: GeminiFile; apiKey: string }> {
  return withGeminiKeyFailover(geminiKeys(env), async (apiKey) => ({
    file: await uploadToGemini(apiKey, buffer, mimeType),
    apiKey,
  }));
}

export async function analyze(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // ── 1. Parse input ──
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err('invalid_body', 'expected multipart/form-data', 400, req, env);
  }
  const videoUrl = form.get(ANALYZE_FIELDS.videoUrl);
  const videoFile = form.get(ANALYZE_FIELDS.video);

  // OPTIONAL client-measured ground truth. Malformed input is REJECTED rather than ignored:
  // silently dropping it would look like the grounding worked while the run stayed
  // ungrounded, which is the worst of both outcomes.
  let groundTruth: z.infer<typeof GroundTruthSchema> | undefined;
  const gtRaw = form.get(ANALYZE_FIELDS.groundTruth);
  if (typeof gtRaw === 'string' && gtRaw.trim()) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(gtRaw);
    } catch {
      return err('invalid_ground_truth', `${ANALYZE_FIELDS.groundTruth} must be valid JSON`, 400, req, env);
    }
    const gt = GroundTruthSchema.safeParse(parsedJson);
    if (!gt.success) {
      return err('invalid_ground_truth', `${ANALYZE_FIELDS.groundTruth} invalid:\n${zodIssuesToText(gt.error)}`, 400, req, env);
    }
    groundTruth = gt.data;
  }

  // ── 2. Resolve + upload (we need the duration before choosing sync vs async) ──
  let src: SourceInfo;
  try {
    if (typeof videoUrl === 'string' && videoUrl.trim()) {
      const url = videoUrl.trim();
      const resolved = await resolveVideoUrl(url, env.RAPIDAPI_KEY);
      if (resolved.isYouTube) {
        src = {
          parts: [{ fileData: { mimeType: 'video/mp4', fileUri: url } }],
          geminiFileName: null, sourceUrl: url, platform: resolved.platform,
          thumbnailUrl: resolved.thumbnailUrl,
        };
      } else {
        const { buffer, mimeType } = await fetchVideo(resolved.directUrl!);
        const { file: uploaded, apiKey } = await uploadWithFailover(env, buffer, mimeType);
        src = {
          parts: [{ fileData: { mimeType, fileUri: uploaded.uri } }],
          geminiFileName: uploaded.name, sourceUrl: url, platform: resolved.platform,
          thumbnailUrl: resolved.thumbnailUrl, durationSec: uploaded.durationSec, apiKey,
        };
      }
    } else if (videoFile instanceof File) {
      // §P2: cap the upload BEFORE reading it into memory or paying to upload it. Until now
      // only DURATION was gated and Cloudflare's 100MB request limit was the sole backstop —
      // which fails as an opaque platform error rather than an actionable message, and only
      // after the bytes have already crossed the wire.
      assertUploadWithinCap(videoFile.size);
      const bytes = await videoFile.arrayBuffer();
      // Was `videoFile.type || 'video/mp4'`, which let a plain curl upload's
      // application/octet-stream through (truthy) and produced an opaque Gemini 400.
      // resolveVideoMime falls back through extension, then magic bytes.
      const mimeType = resolveVideoMime(videoFile.type, videoFile.name ?? '', new Uint8Array(bytes.slice(0, 16)));
      const { file: uploaded, apiKey } = await uploadWithFailover(env, bytes, mimeType);
      src = {
        parts: [{ fileData: { mimeType, fileUri: uploaded.uri } }],
        geminiFileName: uploaded.name, platform: 'upload', durationSec: uploaded.durationSec, apiKey,
      };
    } else {
      return err('no_input', `provide "${ANALYZE_FIELDS.videoUrl}" (string) or "${ANALYZE_FIELDS.video}" (file)`, 400, req, env);
    }
  } catch (e) {
    if (e instanceof ResolverError) return err('resolve_failed', e.message, e.status, req, env);
    // Byte-cap rejections carry their own status (413) and an actionable message — without
    // this they would surface as an opaque 500 on a paid endpoint.
    if (e instanceof LimitError) return err(e.code, e.message, e.status, req, env);
    throw e;
  }

  // ── 3. Route: very long videos become jobs; everything else is synchronous ──
  if ((src.durationSec ?? 0) > ASYNC_THRESHOLD_SEC) {
    const jobId = newId();
    const now = nowIso();
    await env.DB.prepare(
      `INSERT INTO jobs (id, kind, status, payload, created_at, updated_at) VALUES (?, 'analyze', 'running', ?, ?, ?)`
    ).bind(jobId, JSON.stringify({ sourceUrl: src.sourceUrl, durationSec: src.durationSec }), now, now).run();

    ctx.waitUntil((async () => {
      try {
        const format = await performAnalysis(env, src, groundTruth);
        await env.DB.prepare('UPDATE jobs SET status = ?, result_format_id = ?, updated_at = ? WHERE id = ?')
          .bind('done', format.id, nowIso(), jobId).run();
      } catch (e) {
        await env.DB.prepare('UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?')
          .bind('error', e instanceof Error ? e.message : String(e), nowIso(), jobId).run();
      } finally {
        if (src.geminiFileName) await deleteGeminiFile(src.apiKey ?? env.GEMINI_API_KEY, src.geminiFileName);
      }
    })());

    const body: AnalyzeResponse = { job: { id: jobId } };
    return json(body, 202, req, env);
  }

  // Sync path — still under waitUntil so a client disconnect can't orphan the run.
  const work = (async (): Promise<Response> => {
    try {
      const format = await performAnalysis(env, src, groundTruth);
      const body: AnalyzeResponse = { format };
      return json(body, 200, req, env);
    } catch (e) {
      if (e instanceof AnalysisInvalidError) {
        return err('analysis_invalid', e.message, 502, req, env, e.detail);
      }
      throw e;
    } finally {
      if (src.geminiFileName) ctx.waitUntil(deleteGeminiFile(src.apiKey ?? env.GEMINI_API_KEY, src.geminiFileName));
    }
  })();
  ctx.waitUntil(work.then(() => undefined, () => undefined));
  return work;
}

class AnalysisInvalidError extends Error {
  constructor(message: string, public readonly detail: unknown) {
    super(message);
  }
}

// ─────────────────────────────────────────────────────────────
// Sampling plumbing
// ─────────────────────────────────────────────────────────────

/** Clone the source parts with per-part videoMetadata (fps and/or clip offsets). */
function videoPartsWith(src: SourceInfo, fps?: number, startSec?: number, endSec?: number): GeminiPart[] {
  return src.parts.map((p) => {
    if (!('fileData' in p)) return p;
    const meta: { fps?: number; startOffset?: string; endOffset?: string } = {};
    if (fps !== undefined) meta.fps = fps;
    if (startSec !== undefined) meta.startOffset = secs(startSec);
    if (endSec !== undefined) meta.endOffset = secs(endSec);
    return Object.keys(meta).length ? { ...p, videoMetadata: meta } : p;
  });
}

const snapToGrid = (t: number, fps: number): number => Math.round(t * fps) / fps;

/** Bounded-concurrency pool; a failed task logs and resolves null (best-effort passes). */
async function runPool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<(T | null)[]> {
  const results: (T | null)[] = new Array(tasks.length).fill(null);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const idx = next++;
      try {
        results[idx] = await tasks[idx]!();
      } catch (e) {
        console.warn(`detail pass task ${idx} failed (best-effort, continuing): ${e instanceof Error ? e.message : e}`);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// ─────────────────────────────────────────────────────────────
// PASS A — boundary + motion map with self-consistency vote
// ─────────────────────────────────────────────────────────────

interface BoundaryResult {
  cuts: number[];
  windows: { startSec: number; endSec: number }[];
  fps: number;
  fpsHonored: boolean;
  /** 'measured' = frame-accurate cuts supplied by the client (ffmpeg). 'estimated' = PASS A
   *  inferred them from a sampled grid. The distinction drives how hard we snap: an estimate
   *  gets a tolerance, a measurement gets obeyed. */
  cutSource: 'estimated' | 'measured';
}

function voteCuts(a: number[], b: number[], fps: number): number[] {
  const agreed: number[] = [];
  for (const ca of a) {
    const match = b.find((cb) => Math.abs(cb - ca) <= CUT_VOTE_TOLERANCE_SEC);
    if (match !== undefined) agreed.push(snapToGrid((ca + match) / 2, fps));
  }
  // dedupe cuts closer than one frame apart
  agreed.sort((x, y) => x - y);
  return agreed.filter((c, i) => i === 0 || c - agreed[i - 1]! > 1 / fps);
}

function mergeWindows(
  a: { startSec: number; endSec: number }[], b: { startSec: number; endSec: number }[], durationSec: number,
): { startSec: number; endSec: number }[] {
  const all = [...a, ...b]
    .map((w) => ({ startSec: Math.max(0, w.startSec), endSec: Math.min(durationSec, w.endSec) }))
    .filter((w) => w.endSec - w.startSec >= 0.3)
    .sort((x, y) => x.startSec - y.startSec);
  const merged: { startSec: number; endSec: number }[] = [];
  for (const w of all) {
    const last = merged[merged.length - 1];
    if (last && w.startSec <= last.endSec + 0.2) last.endSec = Math.max(last.endSec, w.endSec);
    else merged.push({ ...w });
  }
  return merged.map((w) => ({ startSec: w.startSec, endSec: Math.min(w.endSec, w.startSec + 3) })).slice(0, MICRO_MAX_WINDOWS);
}

async function passABoundaryMap(
  env: Env, src: SourceInfo, keys: string[], onKey: (k: string) => void,
  motionWindowsOnly = false,
): Promise<BoundaryResult | null> {
  const duration = src.durationSec!;
  // Cut detection is what needs the high frame rate; locating a motion window does not. When
  // the caller already has measured cuts, halve the sampling and halve the token cost.
  const fps = motionWindowsOnly ? Math.max(2, Math.round(PASS_A_FPS / 2)) : PASS_A_FPS;
  const fit = fitVideoSampling(duration, fps, 'MEDIA_RESOLUTION_LOW', PASS_A_BUDGET_TOKENS);
  const model = env.GEMINI_MODEL_FAST || env.GEMINI_MODEL;
  const doCall = (apiKey: string) => callGeminiJson({
    apiKey, model,
    systemInstruction: BOUNDARY_SYSTEM_INSTRUCTION,
    parts: [
      ...videoPartsWith(src, fit.fps),
      { text: `${buildSamplingPreamble(fit.fps, duration)}\nMap the edits and motion windows now.` },
    ],
    jsonSchema: BOUNDARY_JSON_SCHEMA,
    temperature: 0,
    mediaResolution: fit.mediaResolution,
    maxOutputTokens: 4096,
  });

  try {
    // First run establishes the working key (spend-cap failover allowed here);
    // the second run reuses it. Self-consistency needs two INDEPENDENT reads.
    const first = await withGeminiKeyFailover(keys, async (k) => {
      const r = await doCall(k);
      onKey(k);
      return { key: k, r };
    });
    const second = await doCall(first.key).catch(() => null);

    const parseMap = (text: string) => BoundaryMapSchema.safeParse(tryParse(text));
    const m1 = parseMap(first.r.text);
    const m2 = second ? parseMap(second.text) : { success: false as const, error: undefined };
    if (!m1.success && !(m2 as { success: boolean }).success) return null;

    const a = m1.success ? m1.data : (m2 as z.ZodSafeParseSuccess<z.infer<typeof BoundaryMapSchema>>).data;
    const b = (m2 as { success: boolean; data?: z.infer<typeof BoundaryMapSchema> }).success
      ? (m2 as { data: z.infer<typeof BoundaryMapSchema> }).data
      : null;

    // Vote when we have two reads; a single read passes through un-voted (weaker).
    const cuts = b ? voteCuts(a.cutTimestamps, b.cutTimestamps, fit.fps)
      : a.cutTimestamps.map((c) => snapToGrid(c, fit.fps));
    const windows = mergeWindows(a.motionBeatWindows, b?.motionBeatWindows ?? [], duration);

    // fps-honored detector: 8fps sampling ≈ 8× the prompt tokens of the 1fps default.
    // If the count reads 1fps-sized, Gemini silently ignored videoMetadata.fps.
    const ptc = first.r.promptTokenCount;
    const expectedAtRequested = fit.estTokens;
    const fpsHonored = ptc === undefined ? true : ptc > expectedAtRequested * 0.45;
    if (!fpsHonored) {
      console.warn(`videoMetadata.fps appears IGNORED by ${model}: promptTokenCount=${ptc}, expected ~${expectedAtRequested} at ${fit.fps}fps. Timing confidence downgraded.`);
    }

    return {
      cuts: cuts.filter((c) => c > 0.1 && c < duration - 0.1),
      windows, fps: fit.fps, fpsHonored, cutSource: 'estimated',
    };
  } catch (e) {
    console.warn(`Pass A boundary map failed — degrading to ungrounded perception: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Numeric self-consistency gate (BEFORE acceptance — Part A.5)
// ─────────────────────────────────────────────────────────────

interface NumericViolation { window?: [number, number]; problem: string }

function gateTimings(out: PerceptionOutput, durationSec: number | undefined, boundary: BoundaryResult | null): NumericViolation[] {
  const v: NumericViolation[] = [];
  const beats = out.beats;
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]!;
    if (b.endSec <= b.startSec) v.push({ window: [b.startSec, b.endSec], problem: `beat ${i}: endSec ${b.endSec} ≤ startSec ${b.startSec}` });
    if (i > 0) {
      const prev = beats[i - 1]!;
      if (b.startSec < prev.endSec - 0.05) v.push({ window: [b.startSec, prev.endSec], problem: `beat ${i} overlaps beat ${i - 1} (starts ${b.startSec}, prev ends ${prev.endSec})` });
      if (b.startSec - prev.endSec > 0.75) v.push({ window: [prev.endSec, b.startSec], problem: `unaccounted ${(b.startSec - prev.endSec).toFixed(2)}s gap between beat ${i - 1} and beat ${i}` });
    }
  }
  const total = durationSec ?? out.pacing.totalDurationSec;
  const sum = beats.reduce((s, b) => s + (b.endSec - b.startSec), 0);
  if (Math.abs(sum - total) > 0.5) {
    v.push({ problem: `sum of beat durations ${sum.toFixed(2)}s vs total ${total.toFixed(2)}s — off by more than 0.5s` });
  }
  if (boundary) {
    for (const c of boundary.cuts) {
      if (!beats.some((b) => Math.abs(b.startSec - c) <= CUT_ALIGN_TOLERANCE_SEC)) {
        v.push({ window: [Math.max(0, c - 1), c + 1], problem: `measured cut at ${c.toFixed(2)}s has no beat boundary within ${CUT_ALIGN_TOLERANCE_SEC}s` });
      }
    }
    const onCut = beats.filter((b) => b.startsOnCut).length;
    if (Math.abs(onCut - boundary.cuts.length) > 1) {
      v.push({ problem: `beats flagged startsOnCut = ${onCut} but measured cuts = ${boundary.cuts.length} (must match within ±1)` });
    }
  }
  return v;
}

/** Last-resort deterministic normalization: sort, close overlaps/gaps, rescale to the
 *  real duration, snap boundaries onto measured cuts. Never throws — the run survives
 *  with timingConfidence stamped 'low'. */
function normalizeTimings(out: PerceptionOutput, durationSec: number | undefined, boundary: BoundaryResult | null): void {
  const total = durationSec ?? out.pacing.totalDurationSec;
  const beats = [...out.beats].sort((a, b) => a.startSec - b.startSec);
  const durations = beats.map((b) => Math.max(0.2, b.endSec - b.startSec));
  const scale = total / durations.reduce((s, d) => s + d, 0);
  let cursor = 0;
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]!;
    b.startSec = Math.round(cursor * 100) / 100;
    cursor += durations[i]! * scale;
    b.endSec = Math.round(cursor * 100) / 100;
  }
  if (boundary) {
    for (const c of boundary.cuts) {
      let best = -1;
      let bestDist = Infinity;
      beats.forEach((b, i) => {
        const d = Math.abs(b.startSec - c);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      // The 0.6s guard exists because PASS A's cuts are themselves estimates — snapping a
      // beat to a wrongly-guessed cut would make things worse. A MEASURED cut has no such
      // doubt, so it is obeyed regardless of distance.
      //
      // This is exactly why the multi-pass never fixed the reported drift: on the measured
      // test clip the two worst beats were 0.69s and 1.29s off, BOTH outside 0.6, so the
      // snap silently declined to correct them.
      const snap = boundary.cutSource === 'measured' ? Infinity : 0.6;
      if (best > 0 && bestDist <= snap) {
        beats[best]!.startSec = c;
        beats[best - 1]!.endSec = c;
        beats[best]!.startsOnCut = true;
      }
    }
  }
  out.beats = beats;
}

// ─────────────────────────────────────────────────────────────
// The pipeline
// ─────────────────────────────────────────────────────────────

/** Multi-pass perception → numeric gate → detail merges → virality → D1 save. */
async function performAnalysis(
  env: Env, src: SourceInfo,
  /** OPTIONAL client-measured grounding — frame-accurate cuts and/or a real transcript. */
  groundTruth?: z.infer<typeof GroundTruthSchema>,
): Promise<FormatDna> {
  const duration = src.durationSec;
  const shortForm = duration !== undefined && duration <= SHORT_FORM_MAX_SEC;

  // Uploaded files are bound to the project of the key that uploaded them — no key
  // switching mid-pipeline. YouTube URLs carry no upload, so early calls may fail
  // over to the fallback key when the primary project's spend cap is hit.
  const keys = src.apiKey ? [src.apiKey] : geminiKeys(env);
  let activeKey = keys[0]!;

  // ── PASS A (short-form only): cut map + motion windows ──
  //
  // When the client supplied frame-accurate cuts we still RUN Pass A, but only for its
  // MOTION WINDOWS, and at reduced fps. This is a deliberate departure from "skip Pass A
  // entirely": Pass A returns {cuts, windows}, and those windows are what target the MICRO
  // passes that capture sub-second body motion — the thing this app does that a
  // stills-plus-transcript tool cannot. Supplied cuts replace the cut LIST; they say nothing
  // about where the MOTION is, and a long take can hold a big motion beat nowhere near a cut.
  //
  // The token saving comes from the fps drop instead: cut DETECTION is what needed ~8fps;
  // locating a motion window is a coarser job.
  const gtCuts = groundTruth?.sceneCuts?.filter((c: number) => Number.isFinite(c) && c > 0).sort((a: number, b: number) => a - b);
  const haveMeasuredCuts = !!gtCuts?.length;
  let boundary = shortForm
    ? await passABoundaryMap(env, src, keys, (k) => { activeKey = k; }, haveMeasuredCuts)
    : null;
  if (haveMeasuredCuts) {
    // Measured cuts are authoritative. Keep Pass A's windows if we got them; if Pass A
    // failed outright, the measured cuts alone still ground the run — which is strictly
    // better than the ungrounded degradation that used to be the only fallback.
    boundary = {
      cuts: gtCuts!,
      windows: boundary?.windows ?? [],
      fps: boundary?.fps ?? 0,
      fpsHonored: true,
      cutSource: 'measured',
    };
    console.log(`analyze: using ${gtCuts!.length} client-measured cuts [${gtCuts!.map((c: number) => c.toFixed(3)).join(', ')}]`);
  }

  // ── MAIN perception call: duration-gated sampling, cut-map grounded ──
  let mainFps: number | undefined;
  let mediaResolution: MediaResolution;
  if (duration === undefined) {
    mediaResolution = 'MEDIA_RESOLUTION_HIGH';           // YouTube: duration unknown → default 1fps, no budget math possible
  } else if (shortForm) {
    const fit = fitVideoSampling(duration, MAIN_FPS_SHORT, 'MEDIA_RESOLUTION_HIGH', MAIN_BUDGET_TOKENS);
    mainFps = fit.fps; mediaResolution = fit.mediaResolution;
  } else if (duration <= HIGH_RES_MAX_SEC) {
    const fit = fitVideoSampling(duration, 2, 'MEDIA_RESOLUTION_HIGH', MAIN_BUDGET_TOKENS);
    mainFps = fit.fps; mediaResolution = fit.mediaResolution;
  } else {
    const fit = fitVideoSampling(duration, 1, 'MEDIA_RESOLUTION_MEDIUM', MAIN_BUDGET_TOKENS);
    mainFps = fit.fps; mediaResolution = fit.mediaResolution;   // long-form stays 1-2fps + MEDIUM
  }

  const mainParts = videoPartsWith(src, mainFps);
  const mainUserPrompt = [
    ANALYZE_USER_PROMPT,
    mainFps !== undefined ? buildSamplingPreamble(mainFps, duration) : '',
    boundary ? buildCutMapGrounding(boundary.cuts, boundary.windows, boundary.cutSource) : '',
    buildTranscriptGrounding(groundTruth?.transcript, groundTruth?.transcriptConfidence),
  ].filter(Boolean).join('\n\n');

  const call = (extraText: string, model: string, parts: GeminiPart[] = mainParts) => callGeminiJson({
    apiKey: activeKey,
    model,
    systemInstruction: ANALYZER_SYSTEM_INSTRUCTION,
    parts: [...parts, { text: extraText }],
    jsonSchema: PERCEPTION_JSON_SCHEMA,
    mediaResolution,
  });

  let model = env.GEMINI_MODEL;
  let raw: string;
  try {
    raw = (await withGeminiKeyFailover(keys, (k) => {
      activeKey = k;
      return call(mainUserPrompt, model);
    })).text;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const modelMissing = msg.includes(' 404') || /not found|NOT_FOUND/i.test(msg);
    if (!modelMissing || !env.GEMINI_MODEL_FALLBACK || env.GEMINI_MODEL_FALLBACK === model) throw e;
    model = env.GEMINI_MODEL_FALLBACK;
    raw = (await call(mainUserPrompt, model)).text;
  }

  let parsed = PerceptionOutputSchema.safeParse(tryParse(raw));
  if (!parsed.success) {
    const repair = await call(buildRepairPrompt(zodIssuesToText(parsed.error), raw), model);
    parsed = PerceptionOutputSchema.safeParse(tryParse(repair.text));
    if (!parsed.success) {
      throw new AnalysisInvalidError(
        'analyzer output failed schema validation after one repair attempt',
        parsed.error.issues.slice(0, 20),
      );
    }
    raw = repair.text;
  }
  let perception = parsed.data;

  // ── NUMERIC GATE → scoped repair → deterministic normalize ──
  let timingConfidence: 'high' | 'medium' | 'low' =
    boundary && boundary.fpsHonored && shortForm ? 'high' : 'medium';
  let violations = gateTimings(perception, duration, boundary);
  if (violations.length > 0 && duration !== undefined) {
    // SCOPED repair: re-attach ONLY the offending windows at higher fps — never a
    // blind full-video text re-ask.
    const windows = mergeWindows(
      violations.filter((x) => x.window).map((x) => ({ startSec: x.window![0], endSec: x.window![1] })),
      [], duration,
    ).slice(0, 3);
    const repairFit = fitVideoSampling(
      Math.max(1, windows.reduce((s, w) => s + (w.endSec - w.startSec), 0) || duration),
      MICRO_FPS, 'MEDIA_RESOLUTION_LOW', MICRO_BUDGET_TOKENS,
    );
    const repairParts: GeminiPart[] = windows.length
      ? windows.flatMap((w) => videoPartsWith(src, repairFit.fps, w.startSec, w.endSec))
      : videoPartsWith(src, boundary?.fps ?? mainFps);
    try {
      const repaired = await call(
        buildTimingRepairPrompt(violations.map((x) => `- ${x.problem}`).join('\n'), JSON.stringify(perception)),
        model, repairParts,
      );
      const reparsed = PerceptionOutputSchema.safeParse(tryParse(repaired.text));
      if (reparsed.success) {
        perception = reparsed.data;
        violations = gateTimings(perception, duration, boundary);
      }
    } catch (e) {
      console.warn(`scoped timing repair failed: ${e instanceof Error ? e.message : e}`);
    }
    timingConfidence = 'medium';
  }
  if (violations.length > 0) {
    console.warn(`numeric gate still failing after scoped repair (${violations.length} violations) — normalizing deterministically`);
    normalizeTimings(perception, duration, boundary);
    timingConfidence = 'low';
  }
  if (boundary && !boundary.fpsHonored) timingConfidence = 'low';

  // Snap beat boundaries to the sampling grid — timings can't be finer than what was seen.
  const grid = boundary?.fps ?? mainFps;
  if (grid) {
    for (const b of perception.beats) {
      b.startSec = snapToGrid(b.startSec, grid);
      b.endSec = Math.max(snapToGrid(b.endSec, grid), b.startSec + 1 / grid);
    }
  }

  // ── PASS B (per-shot deep detail) + MICRO-PASS (sub-second motion), pooled ≤3 ──
  if (shortForm && duration !== undefined) {
    const cuts = boundary?.cuts ?? [];
    const bounds = [0, ...cuts, duration];
    let shots: [number, number][] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      if (bounds[i + 1]! - bounds[i]! > 0.05) shots.push([bounds[i]!, bounds[i + 1]!]);
    }
    // merge micro-shots / cap call count (log what gets grouped — no silent truncation)
    while (shots.length > PASS_B_MAX_SHOTS || shots.some(([s, e]) => e - s < 0.4)) {
      let idx = 0;
      let minLen = Infinity;
      shots.forEach(([s, e], i) => { if (e - s < minLen) { minLen = e - s; idx = i; } });
      if (shots.length <= 1) break;
      const mergeWith = idx === 0 ? 1 : idx - 1;
      const merged: [number, number] = [Math.min(shots[idx]![0], shots[mergeWith]![0]), Math.max(shots[idx]![1], shots[mergeWith]![1])];
      shots = shots.filter((_, i) => i !== idx && i !== mergeWith);
      shots.push(merged);
      shots.sort((a, b) => a[0] - b[0]);
      if (shots.length <= 1) break;
    }
    if (cuts.length + 1 > PASS_B_MAX_SHOTS) {
      console.warn(`Pass B: ${cuts.length + 1} shots grouped into ${shots.length} clipped calls (cap ${PASS_B_MAX_SHOTS})`);
    }

    type ShotDetail = z.infer<typeof ShotDetailSchema>;
    const shotTasks = shots.map(([s, e], i) => async () => {
      const fit = fitVideoSampling(e - s, PASS_B_FPS, 'MEDIA_RESOLUTION_HIGH', PASS_B_BUDGET_TOKENS);
      const r = await callGeminiJson({
        apiKey: activeKey, model: env.GEMINI_MODEL,
        systemInstruction: CLIP_ANALYST_SYSTEM_INSTRUCTION,
        parts: [
          ...videoPartsWith(src, fit.fps, s, e),
          { text: buildShotDetailPrompt(s, e, fit.fps, i, shots.length) },
        ],
        jsonSchema: SHOT_DETAIL_JSON_SCHEMA,
        temperature: 0,
        mediaResolution: fit.mediaResolution,
        maxOutputTokens: 4096,
      });
      return { range: [s, e] as [number, number], detail: ShotDetailSchema.parse(tryParse(r.text)) };
    });

    const microTasks = (boundary?.windows ?? []).map((w) => async () => {
      const fit = fitVideoSampling(w.endSec - w.startSec, MICRO_FPS, 'MEDIA_RESOLUTION_LOW', MICRO_BUDGET_TOKENS);
      const r = await callGeminiJson({
        apiKey: activeKey, model: env.GEMINI_MODEL_FAST || env.GEMINI_MODEL,
        systemInstruction: CLIP_ANALYST_SYSTEM_INSTRUCTION,
        parts: [
          ...videoPartsWith(src, fit.fps, w.startSec, w.endSec),
          { text: buildMotionWindowPrompt(w.startSec, w.endSec, fit.fps) },
        ],
        jsonSchema: z.toJSONSchema(MotionWindowDetailSchema) as Record<string, unknown>,
        temperature: 0,
        mediaResolution: fit.mediaResolution,
        maxOutputTokens: 4096,
      });
      return MotionWindowDetailSchema.parse(tryParse(r.text));
    });

    const [shotResults, microResults] = await Promise.all([
      runPool(shotTasks, DETAIL_CONCURRENCY),
      runPool(microTasks, DETAIL_CONCURRENCY),
    ]);

    // Merge Pass B: clipped high-res wins for the per-shot filming fields.
    const usable = (s?: string) => !!s && !/not clearly visible/i.test(s);
    for (const res of shotResults) {
      if (!res) continue;
      const [s, e] = res.range;
      for (const b of perception.beats) {
        const mid = (b.startSec + b.endSec) / 2;
        if (mid < s || mid >= e) continue;
        b.shotSize = res.detail.shotSize;
        b.cameraAngle = res.detail.cameraAngle;
        if (usable(res.detail.lensFeel)) b.lensFeel = res.detail.lensFeel;
        if (usable(res.detail.motionBeat)) b.motionBeat = res.detail.motionBeat;
        if (usable(res.detail.microExpression)) b.microExpression = res.detail.microExpression;
        if (res.detail.secondaryMotion) b.secondaryMotion = res.detail.secondaryMotion;
      }
    }
    // Merge micro-pass LAST: the highest-fps read of the jiggle wins.
    for (const res of microResults) {
      if (!res) continue;
      for (const w of res.windows) {
        const wMid = (w.startSec + w.endSec) / 2;
        for (const b of perception.beats) {
          if (wMid < b.startSec || wMid >= b.endSec) continue;
          if (usable(w.motionBeat)) b.motionBeat = w.motionBeat;
          b.secondaryMotion = w.secondaryMotion;
        }
      }
    }
  }

  // ── VIRALITY: text-only, fast model, over the extracted DNA (never re-grounds Pro) ──
  const scored = await scoreVirality(env, activeKey, perception);
  // Stamp the calibration that produced this score. virality_score drives the surprise
  // sampler as score², so scores from different rubrics are not interchangeable — without
  // this stamp the library would silently mix two calibrations. Existing rows are NOT
  // backfilled: absent means rubric '1' (pre-2026-08-28).
  const virality = { ...scored, rubricVersion: RUBRIC_VERSION };

  const dnaCore: PerceptionOutput & { virality: ViralityScorecard } = { ...perception, virality };
  AnalyzerOutputSchema.parse(dnaCore);   // belt-and-braces: the assembled DNA meets the full contract

  const now = nowIso();
  const format: FormatDna = {
    ...dnaCore,
    schemaVersion: 1,
    id: newId(),
    version: 1,
    source: {
      url: src.sourceUrl,
      platform: src.platform,
      thumbnailUrl: src.thumbnailUrl,
      durationSec: duration ?? dnaCore.pacing.totalDurationSec,
      clipCount: dnaCore.pacing.isOneShot ? 1 : dnaCore.pacing.cutCount + 1,
      isOneShot: dnaCore.pacing.isOneShot,
      analyzedAt: now,
      analyzerVersion: `${API_VERSION}/${model}`,
      samplingFps: mainFps ?? 1,
      timingConfidence,
      // Provenance, so a frame-exact boundary is never silently mixed with a sampled guess,
      // and a client transcript is never mistaken for something the model observed.
      ...(boundary ? { cutSource: boundary.cutSource } : {}),
      transcriptSource: groundTruth?.transcriptConfidence
        ? (`client_${groundTruth.transcriptConfidence}` as 'client_high' | 'client_low' | 'client_no_speech')
        : 'none',
    },
  };

  await env.DB.batch(formatInsertStatements(env, format, format.tags, now));
  return format;
}

/** The brutal scorecard as its own call: FAST model, DNA text in, scorecard out. */
async function scoreVirality(env: Env, apiKey: string, perception: PerceptionOutput): Promise<ViralityScorecard> {
  // frames + characterObservation are heavy and score-irrelevant — keep the essay lean.
  const lean: Record<string, unknown> = { ...perception };
  delete lean.frames;
  delete lean.characterObservation;
  // contentFlag is production-routing metadata (which generation tools accept the input),
  // not a virality signal — the scorer misreads it as a platform-moderation penalty.
  delete lean.contentFlag;

  const doCall = (text: string) => callGeminiJson({
    apiKey,
    // SCORER (Pro), not FAST. This was the last place the old spend split still applied to a
    // JUDGEMENT rather than a perception task: every new analysis was scored by Flash, so the
    // library would have drifted straight back toward the pre-rubric-3 calibration as
    // material was added — undoing the rescore one upload at a time. The Pass-A boundary map
    // and the motion micro-pass above still use FAST, correctly: those are mechanical
    // perception over video, not judgement.
    model: env.GEMINI_MODEL_SCORER || env.GEMINI_MODEL_FALLBACK || env.GEMINI_MODEL,
    systemInstruction: VIRALITY_SYSTEM_INSTRUCTION,
    parts: [{ text }],
    jsonSchema: VIRALITY_JSON_SCHEMA,
    temperature: 0.3,
    maxOutputTokens: 8192,
  });

  let raw = (await doCall(`FORMAT DNA:\n${JSON.stringify(lean, null, 1)}\n\nScore it now.`)).text;
  let parsed = ViralityScorecardSchema.safeParse(tryParse(raw));
  if (!parsed.success) {
    raw = (await doCall(buildRepairPrompt(zodIssuesToText(parsed.error), raw))).text;
    parsed = ViralityScorecardSchema.safeParse(tryParse(raw));
    if (!parsed.success) {
      throw new AnalysisInvalidError(
        'virality scorecard failed schema validation after one repair attempt',
        parsed.error.issues.slice(0, 20),
      );
    }
  }
  return parsed.data;
}
