/**
 * POST /analyze — the heart (FABLE5-PLAN Phase 2 + Phase 5 long-form).
 * multipart: videoUrl (string) OR video (file) — names from shared/fields.ts.
 * Flow: resolve source → Gemini File API → Pro-tier JSON-mode call against the
 * AnalyzerOutput schema → zod validate (ONE error-guided repair ask) → server-side
 * D1 save → FormatDna.
 *
 * Long-form (Phase 5): duration from File API metadata drives
 *  - resolution tiering: ≤90s HIGH (frame-level fabric/crop detail), >90s MEDIUM
 *  - routing: >300s runs as an async JOB — 202 {job:{id}}, client polls /jobs/:id;
 *    the pipeline continues under waitUntil and lands in D1 either way.
 */
import { z } from 'zod';
import { AnalyzerOutputSchema } from '../../../shared/schemas';
import type { AnalyzeResponse, FormatDna, Platform } from '../../../shared/contract';
import { ANALYZE_FIELDS } from '../../../shared/fields';
import { API_VERSION, type Env } from '../env';
import { err, json, newId, nowIso } from '../http';
import { formatInsertStatements } from '../db';
import { ResolverError, fetchVideo, resolveVideoUrl } from '../resolvers';
import { callGeminiJson, deleteGeminiFile, extractJson, uploadToGemini, type GeminiPart } from '../gemini';
import { ANALYZER_SYSTEM_INSTRUCTION, buildRepairPrompt } from '../prompt';

const ANALYZER_JSON_SCHEMA = z.toJSONSchema(AnalyzerOutputSchema) as Record<string, unknown>;
const ASYNC_THRESHOLD_SEC = 300;
const HIGH_RES_MAX_SEC = 90;

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
        const uploaded = await uploadToGemini(env.GEMINI_API_KEY, buffer, mimeType);
        src = {
          parts: [{ fileData: { mimeType, fileUri: uploaded.uri } }],
          geminiFileName: uploaded.name, sourceUrl: url, platform: resolved.platform,
          thumbnailUrl: resolved.thumbnailUrl, durationSec: uploaded.durationSec,
        };
      }
    } else if (videoFile instanceof File) {
      const mimeType = videoFile.type || 'video/mp4';
      const uploaded = await uploadToGemini(env.GEMINI_API_KEY, await videoFile.arrayBuffer(), mimeType);
      src = {
        parts: [{ fileData: { mimeType, fileUri: uploaded.uri } }],
        geminiFileName: uploaded.name, platform: 'upload', durationSec: uploaded.durationSec,
      };
    } else {
      return err('no_input', `provide "${ANALYZE_FIELDS.videoUrl}" (string) or "${ANALYZE_FIELDS.video}" (file)`, 400, req, env);
    }
  } catch (e) {
    if (e instanceof ResolverError) return err('resolve_failed', e.message, e.status, req, env);
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
        const format = await performAnalysis(env, src);
        await env.DB.prepare('UPDATE jobs SET status = ?, result_format_id = ?, updated_at = ? WHERE id = ?')
          .bind('done', format.id, nowIso(), jobId).run();
      } catch (e) {
        await env.DB.prepare('UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?')
          .bind('error', e instanceof Error ? e.message : String(e), nowIso(), jobId).run();
      } finally {
        if (src.geminiFileName) await deleteGeminiFile(env.GEMINI_API_KEY, src.geminiFileName);
      }
    })());

    const body: AnalyzeResponse = { job: { id: jobId } };
    return json(body, 202, req, env);
  }

  // Sync path — still under waitUntil so a client disconnect can't orphan the run.
  const work = (async (): Promise<Response> => {
    try {
      const format = await performAnalysis(env, src);
      const body: AnalyzeResponse = { format };
      return json(body, 200, req, env);
    } catch (e) {
      if (e instanceof AnalysisInvalidError) {
        return err('analysis_invalid', e.message, 502, req, env, e.detail);
      }
      throw e;
    } finally {
      if (src.geminiFileName) ctx.waitUntil(deleteGeminiFile(env.GEMINI_API_KEY, src.geminiFileName));
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

/** The pipeline: Gemini call → validate (one repair) → assemble FormatDna → D1 save. */
async function performAnalysis(env: Env, src: SourceInfo): Promise<FormatDna> {
  const mediaResolution = (src.durationSec ?? 0) > HIGH_RES_MAX_SEC
    ? 'MEDIA_RESOLUTION_MEDIUM' as const   // long-form: keep attention dense, budget sane
    : 'MEDIA_RESOLUTION_HIGH' as const;    // short reels: frame-level fabric/crop detail

  const call = (extraText: string) => callGeminiJson({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    systemInstruction: ANALYZER_SYSTEM_INSTRUCTION,
    parts: [...src.parts, { text: extraText }],
    jsonSchema: ANALYZER_JSON_SCHEMA,
    mediaResolution,
  });

  let model = env.GEMINI_MODEL;
  let raw: string;
  try {
    raw = (await call(ANALYZE_USER_PROMPT)).text;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const modelMissing = msg.includes(' 404') || /not found|NOT_FOUND/i.test(msg);
    if (!modelMissing || !env.GEMINI_MODEL_FALLBACK || env.GEMINI_MODEL_FALLBACK === model) throw e;
    model = env.GEMINI_MODEL_FALLBACK;
    raw = (await callGeminiJson({
      apiKey: env.GEMINI_API_KEY, model,
      systemInstruction: ANALYZER_SYSTEM_INSTRUCTION,
      parts: [...src.parts, { text: ANALYZE_USER_PROMPT }],
      jsonSchema: ANALYZER_JSON_SCHEMA,
      mediaResolution,
    })).text;
  }

  let parsed = AnalyzerOutputSchema.safeParse(tryParse(raw));
  if (!parsed.success) {
    const repair = await call(buildRepairPrompt(zodIssuesToText(parsed.error), raw));
    parsed = AnalyzerOutputSchema.safeParse(tryParse(repair.text));
    if (!parsed.success) {
      throw new AnalysisInvalidError(
        'analyzer output failed schema validation after one repair attempt',
        parsed.error.issues.slice(0, 20),
      );
    }
  }

  const dnaCore = parsed.data;
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
      durationSec: src.durationSec ?? dnaCore.pacing.totalDurationSec,
      clipCount: dnaCore.pacing.isOneShot ? 1 : dnaCore.pacing.cutCount + 1,
      isOneShot: dnaCore.pacing.isOneShot,
      analyzedAt: now,
      analyzerVersion: `${API_VERSION}/${model}`,
    },
  };

  await env.DB.batch(formatInsertStatements(env, format, format.tags, now));
  return format;
}
