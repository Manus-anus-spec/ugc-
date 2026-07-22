/**
 * Gemini client. Ports the File API upload/poll helpers from worker-v4.2.0.js:502-553
 * with two fixes:
 *  - API key travels in the `x-goog-api-key` HEADER, never a query string (fixes N6)
 *  - file cleanup happens deterministically after analysis via ctx.waitUntil,
 *    not a setTimeout that dies with the isolate
 * Structured output: JSON-only responses, schema-enforced (FABLE5-PLAN §4).
 */
const BASE = 'https://generativelanguage.googleapis.com';

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

  const res = await fetch(`${BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'multipart',
      'Content-Type': 'multipart/related; boundary=boundary123',
    },
    body: combined,
  });
  if (!res.ok) throw new Error(`Gemini file upload failed (${res.status}): ${await res.text()}`);
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

export type GeminiPart =
  | { text: string }
  | { fileData: { mimeType: string; fileUri: string } };

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
}

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
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

export async function callGeminiJson(opts: GeminiJsonCallOptions): Promise<GeminiJsonResult> {
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

  const res = await fetch(`${BASE}/v1beta/models/${opts.model}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'x-goog-api-key': opts.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.systemInstruction }] },
      contents: [{ role: 'user', parts }],
      generationConfig,
      safetySettings: SAFETY_SETTINGS,
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text();
    throw new Error(`Gemini ${opts.model} returned ${res.status}: ${body.slice(0, 500)}`);
  }

  let text = '';
  let finishReason = 'STOP';
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
    }
  }

  if (!text) throw new Error(`Gemini returned an empty response (finishReason: ${finishReason})`);
  if (finishReason === 'MAX_TOKENS') {
    throw new Error(`Gemini response truncated at maxOutputTokens (${opts.maxOutputTokens ?? 65536}) — output incomplete`);
  }
  return { text, finishReason };
}

/** Strip accidental markdown fences before JSON.parse (belt-and-braces). */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1]! : trimmed;
}
