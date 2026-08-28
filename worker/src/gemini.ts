/**
 * Gemini client. Ports the File API upload/poll helpers from worker-v4.2.0.js:502-553
 * with two fixes:
 *  - API key travels in the `x-goog-api-key` HEADER, never a query string (fixes N6)
 *  - file cleanup happens deterministically after analysis via ctx.waitUntil,
 *    not a setTimeout that dies with the isolate
 * Structured output: JSON-only responses, schema-enforced (FABLE5-PLAN §4).
 */
const BASE = 'https://generativelanguage.googleapis.com';

/**
 * Quota failures are the #1 real-world outage (Jul 25: Niko blocked all night on a
 * raw 429 "monthly spending cap" JSON). Two distinct kinds that need opposite handling:
 *  - spend_cap: the Google project's monthly spending cap is exhausted — retrying is
 *    pointless; fail over to GEMINI_API_KEY_FALLBACK (different project) if set,
 *    otherwise surface an actionable message.
 *  - rate_limit: transient per-minute quota — retry with backoff, never fail over.
 */
export class GeminiQuotaError extends Error {
  constructor(message: string, public readonly kind: 'spend_cap' | 'rate_limit') {
    super(message);
  }
}

export const SPEND_CAP_FIX =
  'The Gemini billing cap for this app is exhausted. Khian: open https://aistudio.google.com/ → Settings → Billing (ai.studio/spend) for project "UGC Reverse engineer" and raise the monthly spending cap / top up prepaid credits, then hit try again. Nothing is wrong with the video or the app.';

function classifyGeminiHttpError(status: number, body: string, context: string): Error {
  if (status === 429) {
    if (/spend(ing)?[ _-]?cap/i.test(body)) {
      return new GeminiQuotaError(`${context}: ${SPEND_CAP_FIX}`, 'spend_cap');
    }
    return new GeminiQuotaError(
      `${context}: Gemini per-minute rate limit hit and automatic retries were exhausted — wait ~60s and try again.`,
      'rate_limit',
    );
  }
  // Gemini geolocates the CALLER, and a Cloudflare Worker's caller is whichever colo served
  // the request — this account has been served from SIN. From some colos Gemini refuses
  // outright with a 400. Observed live: 64 formats scored fine, then an entire batch failed
  // with this, then it worked again minutes later on retry. It is transient and nothing is
  // wrong with the key, the model, the billing or the video — so say that, because the raw
  // 400 blob reads like a broken app on a paid run and sends you looking in the wrong place.
  if (status === 400 && /location is not supported/i.test(body)) {
    return new GeminiQuotaError(
      `${context}: Gemini refused this request based on the CALLER'S LOCATION. This is a ` +
      'Cloudflare edge-routing effect (the Worker egresses from whichever colo served the ' +
      'request), not a problem with the key, the model, the billing or the video. It is ' +
      'intermittent — retry in a minute and it usually succeeds from a different colo.',
      'rate_limit',   // treated as retryable, NOT as a spend cap: it must not burn the fallback key
    );
  }
  return new Error(`${context} ${status}: ${body.slice(0, 500)}`);
}

const RETRY_DELAYS_MS = [2000, 6000];

/** Issue a Gemini request; retry transient failures (5xx, rate-limit 429) with backoff. */
async function geminiRequest(doFetch: () => Promise<Response>, context: string): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    const res = await doFetch();
    if (res.ok) return res;
    const body = await res.text().catch(() => '');
    lastError = classifyGeminiHttpError(res.status, body, context);
    const transient = res.status >= 500
      || (lastError instanceof GeminiQuotaError && lastError.kind === 'rate_limit');
    if (!transient) throw lastError;
  }
  throw lastError!;
}

/** Primary key first, fallback (separate Google project) second — set via
 *  `wrangler secret put GEMINI_API_KEY_FALLBACK`; optional. */
export function geminiKeys(env: { GEMINI_API_KEY: string; GEMINI_API_KEY_FALLBACK?: string }): string[] {
  const keys = [env.GEMINI_API_KEY];
  if (env.GEMINI_API_KEY_FALLBACK && env.GEMINI_API_KEY_FALLBACK !== env.GEMINI_API_KEY) {
    keys.push(env.GEMINI_API_KEY_FALLBACK);
  }
  return keys;
}

/**
 * Run `fn` against each key in order, moving to the next ONLY on a spend-cap error.
 * Callers must keep using the key that succeeded for the rest of their pipeline —
 * a File API upload is bound to the project of the key that made it.
 */
export async function withGeminiKeyFailover<T>(keys: string[], fn: (apiKey: string) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const key of keys) {
    try {
      return await fn(key);
    } catch (e) {
      if (e instanceof GeminiQuotaError && e.kind === 'spend_cap') { lastError = e; continue; }
      throw e;
    }
  }
  throw lastError;
}

const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
];

export interface GeminiFile {
  uri: string;
  name: string;
  /** From File API videoMetadata once ACTIVE — drives resolution tiering + async routing. */
  durationSec?: number;
}

function parseDuration(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const n = parseFloat(v.replace(/s$/, ''));
  return Number.isFinite(n) ? n : undefined;
}

export async function uploadToGemini(apiKey: string, videoBuffer: ArrayBuffer, mimeType: string): Promise<GeminiFile> {
  const metadata = JSON.stringify({ file: { display_name: 'ugc_video' } });
  const enc = new TextEncoder();
  const metaPart = enc.encode(
    `--boundary123\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--boundary123\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const closing = enc.encode('\r\n--boundary123--');
  const combined = new Uint8Array(metaPart.length + videoBuffer.byteLength + closing.length);
  combined.set(metaPart, 0);
  combined.set(new Uint8Array(videoBuffer), metaPart.length);
  combined.set(closing, metaPart.length + videoBuffer.byteLength);

  const res = await geminiRequest(() => fetch(`${BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'multipart',
      'Content-Type': 'multipart/related; boundary=boundary123',
    },
    body: combined,
  }), 'Gemini file upload failed');
  const data = await res.json() as { file?: { uri?: string; name?: string; state?: string } };
  const file = data.file;
  if (!file?.uri || !file?.name) throw new Error('Gemini file upload returned no file uri');

  if (file.state === 'PROCESSING') {
    return pollUntilActive(apiKey, file.name, file.uri);
  }
  return fetchFileInfo(apiKey, file.name, file.uri);
}

async function fetchFileInfo(apiKey: string, fileName: string, fileUri: string): Promise<GeminiFile> {
  const res = await fetch(`${BASE}/v1beta/${fileName}`, { headers: { 'x-goog-api-key': apiKey } });
  const data = await res.json() as { uri?: string; videoMetadata?: { videoDuration?: string } };
  return { uri: data.uri ?? fileUri, name: fileName, durationSec: parseDuration(data.videoMetadata?.videoDuration) };
}

async function pollUntilActive(apiKey: string, fileName: string, fileUri: string): Promise<GeminiFile> {
  let state = 'PROCESSING';
  let uri = fileUri;
  let durationSec: number | undefined;
  for (let attempts = 0; state === 'PROCESSING' && attempts < 30; attempts++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${BASE}/v1beta/${fileName}`, { headers: { 'x-goog-api-key': apiKey } });
    const data = await res.json() as { state?: string; uri?: string; videoMetadata?: { videoDuration?: string } };
    state = data.state ?? state;
    uri = data.uri ?? uri;
    durationSec = parseDuration(data.videoMetadata?.videoDuration) ?? durationSec;
  }
  if (state === 'FAILED') throw new Error('Video processing failed on Google servers.');
  if (state === 'PROCESSING') throw new Error('Video processing timed out on Google servers.');
  return { uri, name: fileName, durationSec };
}

export async function deleteGeminiFile(apiKey: string, fileName: string): Promise<void> {
  await fetch(`${BASE}/v1beta/${fileName}`, {
    method: 'DELETE',
    headers: { 'x-goog-api-key': apiKey },
  }).catch(() => {});
}

export type MediaResolution = 'MEDIA_RESOLUTION_LOW' | 'MEDIA_RESOLUTION_MEDIUM' | 'MEDIA_RESOLUTION_HIGH';

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }   // base64 — small images (QA stills)
  | {
      fileData: { mimeType: string; fileUri: string };
      /** Per-part sampling control (v3): without fps Gemini samples at 1 frame/sec —
       *  it literally cannot see sub-second cuts or motion beats. fps valid range
       *  (0, 24]; offsets are "12.5s" strings and clip the video server-side. */
      videoMetadata?: { fps?: number; startOffset?: string; endOffset?: string };
    };

/** Offset string for videoMetadata: 12.375 → "12.375s". */
export const secs = (n: number): string => `${Math.max(0, Math.round(n * 1000) / 1000)}s`;

// ─────────────────────────────────────────────────────────────
// Token estimator (v3 spend safety): frames = duration × fps; cost per frame by
// media resolution (~70/140/280 tok — Google's published video tokenization), plus
// ~32 tok/s of audio. Used to auto-downshift fps/res BEFORE a call blows budget —
// the monthly spend cap is the #1 real outage (see SPEND_CAP_FIX).
// ─────────────────────────────────────────────────────────────
export const TOKENS_PER_FRAME: Record<MediaResolution, number> = {
  MEDIA_RESOLUTION_LOW: 70,
  MEDIA_RESOLUTION_MEDIUM: 140,
  MEDIA_RESOLUTION_HIGH: 280,
};
const AUDIO_TOKENS_PER_SEC = 32;

export function estimateVideoTokens(durationSec: number, fps: number, res: MediaResolution): number {
  return Math.ceil(durationSec * fps) * TOKENS_PER_FRAME[res] + Math.ceil(durationSec) * AUDIO_TOKENS_PER_SEC;
}

export interface VideoSampling { fps: number; mediaResolution: MediaResolution; estTokens: number }

/** Deterministic downshift ladder: halve fps to 1, then drop a resolution tier, then
 *  halve fps below 1 (floor 0.2). Returns the first combination inside budget. */
export function fitVideoSampling(
  durationSec: number, wantedFps: number, res: MediaResolution, budgetTokens: number,
): VideoSampling {
  const LADDER: MediaResolution[] = ['MEDIA_RESOLUTION_HIGH', 'MEDIA_RESOLUTION_MEDIUM', 'MEDIA_RESOLUTION_LOW'];
  let fps = wantedFps;
  let r = res;
  for (let guard = 0; guard < 24 && estimateVideoTokens(durationSec, fps, r) > budgetTokens; guard++) {
    if (fps > 1) fps = Math.max(1, Math.round((fps / 2) * 100) / 100);
    else if (r !== 'MEDIA_RESOLUTION_LOW') r = LADDER[LADDER.indexOf(r) + 1]!;
    else if (fps > 0.2) fps = Math.max(0.2, Math.round((fps / 2) * 100) / 100);
    else break;
  }
  return { fps, mediaResolution: r, estTokens: estimateVideoTokens(durationSec, fps, r) };
}

export interface GeminiJsonCallOptions {
  apiKey: string;
  model: string;
  systemInstruction: string;
  parts: GeminiPart[];
  /** Full JSON Schema (from z.toJSONSchema). Gemini 3 accepts it natively via
   *  responseJsonSchema; older models get it embedded in the prompt instead
   *  (server-side zod validation is the real gate either way — PLAN §4). */
  jsonSchema: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
  mediaResolution?: 'MEDIA_RESOLUTION_LOW' | 'MEDIA_RESOLUTION_MEDIUM' | 'MEDIA_RESOLUTION_HIGH';
}

export interface GeminiJsonResult {
  text: string;
  finishReason: string;
  /** Prompt token count from usageMetadata — the fps-honored detector reads this:
   *  8fps sampling ≈ 8× the prompt tokens of the 1fps default, so a 1fps-sized
   *  count means Gemini silently ignored our videoMetadata.fps. */
  promptTokenCount?: number;
}

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number };
}

/**
 * JSON-mode call via streamGenerateContent (SSE), accumulated server-side.
 * Streaming is load-bearing, not cosmetic: a non-streaming generateContent sends no
 * bytes until the full analysis is done, and Cloudflare kills silent worker
 * subrequests after ~100s with a 524 — long Pro video analyses routinely exceed that.
 * SSE delivers headers + chunks immediately, so the connection stays alive.
 */
/**
 * Gemini's constrained decoder rejects (400 INVALID_ARGUMENT) schemas that put
 * minItems/maxItems on arrays of large object items — verified empirically 2026-07-22.
 * Strip array bounds before sending; enforce counts in application code instead.
 */
export function geminiSafeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  const strip = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(strip); return; }
    if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      delete o.minItems;
      delete o.maxItems;
      Object.values(o).forEach(strip);
    }
  };
  strip(clone);
  return clone;
}

/** Transient transport failures DURING the SSE read — the request-level retry in
 *  geminiRequest can't see these (headers already arrived). Observed live Jul 26:
 *  "Network connection lost." killed a 3-minute generation at the last mile. */
const MID_STREAM_ERROR = /network connection lost|network error|connection (was )?(closed|reset)|terminated|fetch failed|stream.{0,20}(abort|reset)/i;

export async function callGeminiJson(opts: GeminiJsonCallOptions): Promise<GeminiJsonResult> {
  try {
    return await callGeminiJsonOnce(opts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!MID_STREAM_ERROR.test(msg)) throw e;
    console.warn(`Gemini stream dropped mid-read ("${msg.slice(0, 80)}") — retrying the call once`);
    await new Promise((r) => setTimeout(r, 2000));
    return callGeminiJsonOnce(opts);
  }
}

async function callGeminiJsonOnce(opts: GeminiJsonCallOptions): Promise<GeminiJsonResult> {
  const supportsJsonSchema = opts.model.startsWith('gemini-3');

  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.2,
    maxOutputTokens: opts.maxOutputTokens ?? 65536,
    responseMimeType: 'application/json',
    ...(opts.mediaResolution ? { mediaResolution: opts.mediaResolution } : {}),
    ...(supportsJsonSchema ? { responseJsonSchema: geminiSafeSchema(opts.jsonSchema) } : {}),
  };

  const parts: GeminiPart[] = supportsJsonSchema
    ? opts.parts
    : [...opts.parts, { text: `Your response MUST be a single JSON object that validates against this JSON Schema — no markdown fences, no commentary:\n${JSON.stringify(opts.jsonSchema)}` }];

  const res = await geminiRequest(() => fetch(`${BASE}/v1beta/models/${opts.model}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'x-goog-api-key': opts.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.systemInstruction }] },
      contents: [{ role: 'user', parts }],
      generationConfig,
      safetySettings: SAFETY_SETTINGS,
    }),
  }), `Gemini ${opts.model} returned`);

  if (!res.body) {
    throw new Error(`Gemini ${opts.model} returned an empty response body`);
  }

  let text = '';
  let finishReason = 'STOP';
  let promptTokenCount: number | undefined;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';           // keep the trailing partial line
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      let chunk: GeminiChunk;
      try { chunk = JSON.parse(payload); } catch { continue; }
      if (chunk.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked the input: ${chunk.promptFeedback.blockReason}`);
      }
      const candidate = chunk.candidates?.[0];
      if (candidate?.content?.parts) {
        // thinking models stream thought-summary parts (thought: true) — they are
        // NOT part of the answer and corrupt JSON output if concatenated
        for (const p of candidate.content.parts) {
          if (!p.thought) text += p.text ?? '';
        }
      }
      if (candidate?.finishReason) finishReason = candidate.finishReason;
      if (chunk.usageMetadata?.promptTokenCount) promptTokenCount = chunk.usageMetadata.promptTokenCount;
    }
  }

  if (!text) throw new Error(`Gemini returned an empty response (finishReason: ${finishReason})`);
  if (finishReason === 'MAX_TOKENS') {
    throw new Error(`Gemini response truncated at maxOutputTokens (${opts.maxOutputTokens ?? 65536}) — output incomplete`);
  }
  return { text, finishReason, promptTokenCount };
}

/** Strip accidental markdown fences before JSON.parse (belt-and-braces). */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1]! : trimmed;
}
