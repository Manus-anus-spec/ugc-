/**
 * POST /analyze — the heart (FABLE5-PLAN Phase 2).
 * multipart: videoUrl (string) OR video (file) — names from shared/fields.ts.
 * Flow: resolve source → Gemini File API → Pro-tier JSON-mode call against the
 * AnalyzerOutput schema → zod validate (ONE error-guided repair ask) → server-side
 * D1 save (client timeout can never orphan a paid analysis — fixes N5) → FormatDna.
 */
import { z } from 'zod';
import { AnalyzerOutputSchema } from '../../../shared/schemas';
import type { AnalyzeResponse, FormatDna } from '../../../shared/contract';
import { ANALYZE_FIELDS } from '../../../shared/fields';
import { API_VERSION, type Env } from '../env';
import { err, json, newId, nowIso } from '../http';
import { formatInsertStatements } from '../db';
import { ResolverError, fetchVideo, resolveVideoUrl } from '../resolvers';
import { callGeminiJson, deleteGeminiFile, extractJson, uploadToGemini, type GeminiPart } from '../gemini';
import { ANALYZER_SYSTEM_INSTRUCTION, buildRepairPrompt } from '../prompt';

const ANALYZER_JSON_SCHEMA = z.toJSONSchema(AnalyzerOutputSchema) as Record<string, unknown>;

const ANALYZE_USER_PROMPT =
  'Analyze this UGC video and return its complete FORMAT DNA as one JSON object following the system instructions exactly.';

function zodIssuesToText(error: z.ZodError): string {
  return error.issues
    .slice(0, 40)
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
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

  // ── 2. Resolve the video source ──
  let parts: GeminiPart[];
  let geminiFileName: string | null = null;
  let sourceUrl: string | undefined;
  let platform: FormatDna['source']['platform'] = 'upload';
  let thumbnailUrl: string | undefined;

  try {
    if (typeof videoUrl === 'string' && videoUrl.trim()) {
      sourceUrl = videoUrl.trim();
      const resolved = await resolveVideoUrl(sourceUrl, env.RAPIDAPI_KEY);
      platform = resolved.platform;
      thumbnailUrl = resolved.thumbnailUrl;
      if (resolved.isYouTube) {
        parts = [{ fileData: { mimeType: 'video/mp4', fileUri: sourceUrl } }];
      } else {
        const { buffer, mimeType } = await fetchVideo(resolved.directUrl!);
        const uploaded = await uploadToGemini(env.GEMINI_API_KEY, buffer, mimeType);
        geminiFileName = uploaded.name;
        parts = [{ fileData: { mimeType, fileUri: uploaded.uri } }];
      }
    } else if (videoFile instanceof File) {
      const uploaded = await uploadToGemini(
        env.GEMINI_API_KEY,
        await videoFile.arrayBuffer(),
        videoFile.type || 'video/mp4',
      );
      geminiFileName = uploaded.name;
      parts = [{ fileData: { mimeType: videoFile.type || 'video/mp4', fileUri: uploaded.uri } }];
    } else {
      return err('no_input', `provide "${ANALYZE_FIELDS.videoUrl}" (string) or "${ANALYZE_FIELDS.video}" (file)`, 400, req, env);
    }
  } catch (e) {
    if (e instanceof ResolverError) return err('resolve_failed', e.message, e.status, req, env);
    throw e;
  }

  const cleanup = () => {
    if (geminiFileName) ctx.waitUntil(deleteGeminiFile(env.GEMINI_API_KEY, geminiFileName));
  };

  try {
    // ── 3. Call Gemini Pro (config-driven model, fallback on unknown-model errors) ──
    let model = env.GEMINI_MODEL;
    let raw: string;
    try {
      raw = (await callGeminiJson({
        apiKey: env.GEMINI_API_KEY, model,
        systemInstruction: ANALYZER_SYSTEM_INSTRUCTION,
        parts: [...parts, { text: ANALYZE_USER_PROMPT }],
        jsonSchema: ANALYZER_JSON_SCHEMA,
        mediaResolution: 'MEDIA_RESOLUTION_HIGH',
      })).text;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const modelMissing = msg.includes(' 404') || /not found|NOT_FOUND/i.test(msg);
      if (!modelMissing || !env.GEMINI_MODEL_FALLBACK || env.GEMINI_MODEL_FALLBACK === model) throw e;
      model = env.GEMINI_MODEL_FALLBACK;
      raw = (await callGeminiJson({
        apiKey: env.GEMINI_API_KEY, model,
        systemInstruction: ANALYZER_SYSTEM_INSTRUCTION,
        parts: [...parts, { text: ANALYZE_USER_PROMPT }],
        jsonSchema: ANALYZER_JSON_SCHEMA,
        mediaResolution: 'MEDIA_RESOLUTION_HIGH',
      })).text;
    }

    // ── 4. Validate; on failure, ONE error-guided repair ask (no patch sections, ever) ──
    let parsed = AnalyzerOutputSchema.safeParse(tryParse(raw));
    if (!parsed.success) {
      const repair = await callGeminiJson({
        apiKey: env.GEMINI_API_KEY, model,
        systemInstruction: ANALYZER_SYSTEM_INSTRUCTION,
        parts: [...parts, { text: buildRepairPrompt(zodIssuesToText(parsed.error), raw) }],
        jsonSchema: ANALYZER_JSON_SCHEMA,
        mediaResolution: 'MEDIA_RESOLUTION_HIGH',
      });
      parsed = AnalyzerOutputSchema.safeParse(tryParse(repair.text));
      if (!parsed.success) {
        return err('analysis_invalid', 'analyzer output failed schema validation after one repair attempt', 502, req, env,
          parsed.error.issues.slice(0, 20));
      }
    }

    // ── 5. Assemble the full FormatDna (worker fills what the analyzer doesn't own) ──
    const dnaCore = parsed.data;
    const now = nowIso();
    const format: FormatDna = {
      ...dnaCore,
      schemaVersion: 1,
      id: newId(),
      version: 1,
      source: {
        url: sourceUrl,
        platform,
        thumbnailUrl,
        durationSec: dnaCore.pacing.totalDurationSec,
        clipCount: dnaCore.pacing.isOneShot ? 1 : dnaCore.pacing.cutCount + 1,
        isOneShot: dnaCore.pacing.isOneShot,
        analyzedAt: now,
        analyzerVersion: `${API_VERSION}/${model}`,
      },
    };

    // ── 6. Server-side save BEFORE responding — the durable asset is in D1 no matter
    //       what happens to this HTTP connection ──
    await env.DB.batch(formatInsertStatements(env, format, format.tags, now));

    const body: AnalyzeResponse = { format };
    return json(body, 200, req, env);
  } finally {
    cleanup();
  }
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(extractJson(text));
  } catch {
    return undefined; // fails schema validation → triggers the repair path
  }
}
