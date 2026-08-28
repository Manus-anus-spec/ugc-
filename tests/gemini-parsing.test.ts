/**
 * Gemini response-parsing + spend-safety unit tests.
 *
 * This is the layer that breaks SILENTLY: a malformed fence, a thinking-model
 * "thought" part concatenated into the answer, or a schema Gemini's constrained
 * decoder rejects all surface as a vague 400 / "empty response" in production,
 * never as a type error. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  callGeminiJson,
  estimateVideoTokens,
  extractJson,
  fitVideoSampling,
  geminiKeys,
  geminiSafeSchema,
  GeminiQuotaError,
  secs,
  withGeminiKeyFailover,
  TOKENS_PER_FRAME,
} from '../worker/src/gemini';
import { PerceptionOutputSchema } from '../shared/schemas';

// ─────────────────────────────────────────────────────────────
// extractJson — the last line of defence before JSON.parse
// ─────────────────────────────────────────────────────────────
test('extractJson returns bare JSON unchanged', () => {
  assert.equal(extractJson('{"a":1}'), '{"a":1}');
});

test('extractJson strips a ```json fence', () => {
  assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
});

test('extractJson strips an unlabelled ``` fence', () => {
  assert.equal(extractJson('```\n{"a":1}\n```'), '{"a":1}');
});

test('extractJson trims surrounding whitespace before fence matching', () => {
  assert.equal(extractJson('  \n```json\n{"a":1}\n```  \n'), '{"a":1}');
});

test('extractJson leaves an inner ``` inside a string body intact', () => {
  // A fence must wrap the WHOLE payload; a stray fence mid-JSON is not stripped.
  const s = '{"note":"use ```json in docs"}';
  assert.equal(extractJson(s), s);
});

test('extractJson output is always JSON.parse-able for the fenced happy path', () => {
  assert.deepEqual(JSON.parse(extractJson('```json\n{"beats":[]}\n```')), { beats: [] });
});

// ─────────────────────────────────────────────────────────────
// geminiSafeSchema — Gemini's decoder 400s on array minItems/maxItems
// ─────────────────────────────────────────────────────────────
test('geminiSafeSchema strips minItems/maxItems at every depth', () => {
  const schema = {
    type: 'object',
    properties: {
      beats: { type: 'array', minItems: 3, maxItems: 10, items: { type: 'object' } },
      nested: {
        type: 'object',
        properties: { tags: { type: 'array', minItems: 1, items: { type: 'string' } } },
      },
    },
  };
  const safe = JSON.stringify(geminiSafeSchema(schema));
  assert.ok(!safe.includes('minItems'), 'minItems must be gone');
  assert.ok(!safe.includes('maxItems'), 'maxItems must be gone');
});

test('geminiSafeSchema preserves everything else', () => {
  const safe = geminiSafeSchema({
    type: 'object',
    required: ['a'],
    properties: { a: { type: 'string', description: 'keep me' } },
  }) as any;
  assert.deepEqual(safe.required, ['a']);
  assert.equal(safe.properties.a.description, 'keep me');
});

test('geminiSafeSchema does not mutate the input schema', () => {
  const input = { type: 'array', minItems: 2, items: { type: 'string' } };
  geminiSafeSchema(input);
  assert.equal((input as any).minItems, 2, 'caller schema must be untouched');
});

test('the real PerceptionOutput JSON Schema survives the Gemini decoder rules', () => {
  // Regression guard: adding a .min(n)/.max(n) on any array in shared/schemas.ts
  // reintroduces the empirically-verified 400 INVALID_ARGUMENT.
  const safe = JSON.stringify(geminiSafeSchema(z.toJSONSchema(PerceptionOutputSchema) as Record<string, unknown>));
  assert.ok(!safe.includes('minItems'));
  assert.ok(!safe.includes('maxItems'));
});

// ─────────────────────────────────────────────────────────────
// Spend safety — the #1 real outage is the monthly cap
// ─────────────────────────────────────────────────────────────
test('secs formats offsets to at most 3dp and floors at 0', () => {
  assert.equal(secs(12.375), '12.375s');
  assert.equal(secs(12.3754), '12.375s');
  assert.equal(secs(-5), '0s');
  assert.equal(secs(0), '0s');
});

test('estimateVideoTokens = frames x per-frame + audio per second', () => {
  // 10s @ 2fps @ LOW = ceil(20) * 70 + ceil(10) * 32 = 1400 + 320
  assert.equal(estimateVideoTokens(10, 2, 'MEDIA_RESOLUTION_LOW'), 1720);
  assert.ok(
    TOKENS_PER_FRAME.MEDIA_RESOLUTION_HIGH > TOKENS_PER_FRAME.MEDIA_RESOLUTION_LOW,
    'resolution tiers must be ordered',
  );
});

test('fitVideoSampling leaves a request that already fits untouched', () => {
  const fit = fitVideoSampling(8, 8, 'MEDIA_RESOLUTION_HIGH', 10_000_000);
  assert.equal(fit.fps, 8);
  assert.equal(fit.mediaResolution, 'MEDIA_RESOLUTION_HIGH');
});

test('fitVideoSampling downshifts fps before dropping resolution', () => {
  // 30s @ 8fps HIGH = 68,160 tok; @ 4fps HIGH = 34,560. A 50k budget must be met by
  // halving fps, NOT by giving up image detail.
  const fit = fitVideoSampling(30, 8, 'MEDIA_RESOLUTION_HIGH', 50_000);
  assert.equal(fit.fps, 4, 'fps should halve once');
  assert.equal(fit.mediaResolution, 'MEDIA_RESOLUTION_HIGH', 'fps halves before resolution drops');
  assert.ok(fit.estTokens <= 50_000);
});

test('fitVideoSampling exhausts the fps ladder down to 1 before touching resolution', () => {
  // 12k budget: fps walks 8→4→2→1 (9,360 tok) and resolution stays HIGH.
  const fit = fitVideoSampling(30, 8, 'MEDIA_RESOLUTION_HIGH', 12_000);
  assert.equal(fit.fps, 1);
  assert.equal(fit.mediaResolution, 'MEDIA_RESOLUTION_HIGH');
});

test('fitVideoSampling drops resolution once fps has bottomed out at 1', () => {
  // Below the 1fps-HIGH floor (9,360) the only lever left is the resolution tier.
  const fit = fitVideoSampling(30, 8, 'MEDIA_RESOLUTION_HIGH', 6_000);
  assert.equal(fit.fps, 1);
  assert.notEqual(fit.mediaResolution, 'MEDIA_RESOLUTION_HIGH');
  assert.ok(fit.estTokens <= 6_000);
});

test('fitVideoSampling always returns a result inside budget when one exists', () => {
  const fit = fitVideoSampling(60, 8, 'MEDIA_RESOLUTION_HIGH', 200_000);
  assert.ok(fit.estTokens <= 200_000, `estTokens ${fit.estTokens} exceeds budget`);
});

test('fitVideoSampling never returns fps below the 0.2 floor even on an absurd budget', () => {
  const fit = fitVideoSampling(600, 8, 'MEDIA_RESOLUTION_HIGH', 1);
  assert.ok(fit.fps >= 0.2, `fps floor breached: ${fit.fps}`);
  assert.equal(fit.mediaResolution, 'MEDIA_RESOLUTION_LOW', 'must have exhausted the ladder');
});

test('fitVideoSampling estTokens agrees with estimateVideoTokens', () => {
  const fit = fitVideoSampling(30, 8, 'MEDIA_RESOLUTION_HIGH', 700_000);
  assert.equal(fit.estTokens, estimateVideoTokens(30, fit.fps, fit.mediaResolution));
});

// ─────────────────────────────────────────────────────────────
// Key failover — moves on for spend_cap ONLY, never a rate limit
// ─────────────────────────────────────────────────────────────
test('geminiKeys returns the primary key alone when no fallback is set', () => {
  assert.deepEqual(geminiKeys({ GEMINI_API_KEY: 'k1' }), ['k1']);
});

test('geminiKeys appends a distinct fallback key', () => {
  assert.deepEqual(geminiKeys({ GEMINI_API_KEY: 'k1', GEMINI_API_KEY_FALLBACK: 'k2' }), ['k1', 'k2']);
});

test('geminiKeys de-duplicates an identical fallback', () => {
  assert.deepEqual(geminiKeys({ GEMINI_API_KEY: 'k1', GEMINI_API_KEY_FALLBACK: 'k1' }), ['k1']);
});

test('withGeminiKeyFailover fails over to the next key on spend_cap', async () => {
  const tried: string[] = [];
  const out = await withGeminiKeyFailover(['k1', 'k2'], async (key) => {
    tried.push(key);
    if (key === 'k1') throw new GeminiQuotaError('cap', 'spend_cap');
    return 'ok';
  });
  assert.equal(out, 'ok');
  assert.deepEqual(tried, ['k1', 'k2']);
});

test('withGeminiKeyFailover does NOT fail over on a rate limit', async () => {
  const tried: string[] = [];
  await assert.rejects(
    withGeminiKeyFailover(['k1', 'k2'], async (key) => {
      tried.push(key);
      throw new GeminiQuotaError('slow down', 'rate_limit');
    }),
    /slow down/,
  );
  assert.deepEqual(tried, ['k1'], 'a rate limit must not burn the fallback project');
});

test('withGeminiKeyFailover rethrows the last spend_cap error when all keys are capped', async () => {
  await assert.rejects(
    withGeminiKeyFailover(['k1', 'k2'], async () => {
      throw new GeminiQuotaError('all capped', 'spend_cap');
    }),
    /all capped/,
  );
});

// ─────────────────────────────────────────────────────────────
// SSE accumulation — thinking-model "thought" parts corrupt the JSON if kept
// ─────────────────────────────────────────────────────────────
function sseResponse(chunks: unknown[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(`data: ${JSON.stringify(c)}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

function withStubbedFetch(res: () => Response, fn: () => Promise<void>): Promise<void> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => res()) as typeof fetch;
  return fn().finally(() => { globalThis.fetch = real; });
}

const baseOpts = {
  apiKey: 'k', model: 'gemini-3-pro-preview', systemInstruction: 'sys',
  parts: [{ text: 'hi' }], jsonSchema: { type: 'object' },
};

test('callGeminiJson concatenates streamed text parts in order', async () => {
  await withStubbedFetch(
    () => sseResponse([
      { candidates: [{ content: { parts: [{ text: '{"a":' }] } }] },
      { candidates: [{ content: { parts: [{ text: '1}' }] }, finishReason: 'STOP' }] },
    ]),
    async () => {
      const r = await callGeminiJson(baseOpts);
      assert.equal(r.text, '{"a":1}');
      assert.equal(r.finishReason, 'STOP');
    },
  );
});

test('callGeminiJson DROPS thought parts (they corrupt the JSON answer)', async () => {
  await withStubbedFetch(
    () => sseResponse([
      { candidates: [{ content: { parts: [{ text: 'let me think about the beats', thought: true }] } }] },
      { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }] },
    ]),
    async () => {
      const r = await callGeminiJson(baseOpts);
      assert.equal(r.text, '{"ok":true}');
      assert.deepEqual(JSON.parse(extractJson(r.text)), { ok: true });
    },
  );
});

test('callGeminiJson surfaces promptFeedback.blockReason as an error', async () => {
  await withStubbedFetch(
    () => sseResponse([{ promptFeedback: { blockReason: 'SAFETY' } }]),
    async () => { await assert.rejects(callGeminiJson(baseOpts), /blocked the input: SAFETY/); },
  );
});

test('callGeminiJson throws a truncation error on MAX_TOKENS rather than returning half a DNA', async () => {
  await withStubbedFetch(
    () => sseResponse([{ candidates: [{ content: { parts: [{ text: '{"partial":' }] }, finishReason: 'MAX_TOKENS' }] }]),
    async () => { await assert.rejects(callGeminiJson(baseOpts), /truncated at maxOutputTokens/); },
  );
});

test('callGeminiJson throws when the stream yields no text at all', async () => {
  await withStubbedFetch(
    () => sseResponse([{ candidates: [{ finishReason: 'STOP' }] }]),
    async () => { await assert.rejects(callGeminiJson(baseOpts), /empty response/); },
  );
});

test('callGeminiJson reports promptTokenCount (the fps-honored detector reads it)', async () => {
  await withStubbedFetch(
    () => sseResponse([
      { candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 123456 } },
    ]),
    async () => {
      const r = await callGeminiJson(baseOpts);
      assert.equal(r.promptTokenCount, 123456);
    },
  );
});

test('callGeminiJson tolerates keep-alive and non-JSON SSE lines', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(enc.encode(': keep-alive\n\ndata: not-json\n\n'));
        c.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] }, finishReason: 'STOP' }] })}\n\n`));
        c.enqueue(enc.encode('data: [DONE]\n\n'));
        c.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  try {
    const r = await callGeminiJson(baseOpts);
    assert.equal(r.text, '{"a":1}');
  } finally { globalThis.fetch = real; }
});

test('callGeminiJson reassembles a JSON payload split across chunk boundaries', async () => {
  const real = globalThis.fetch;
  const payload = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] }, finishReason: 'STOP' }] })}\n\n`;
  const cut = Math.floor(payload.length / 2);
  globalThis.fetch = (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(enc.encode(payload.slice(0, cut)));   // partial line held in buffer
        c.enqueue(enc.encode(payload.slice(cut)));
        c.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  try {
    const r = await callGeminiJson(baseOpts);
    assert.equal(r.text, '{"a":1}', 'trailing partial line must be buffered, not dropped');
  } finally { globalThis.fetch = real; }
});
