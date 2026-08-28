/**
 * Gemini location refusal — a live failure mode, found while sweeping the library.
 *
 * WHAT HAPPENED. Mid-rescore, an entire batch failed with
 *   400 "User location is not supported for the API use."
 * ...after 64 formats had scored fine, and it succeeded again minutes later on retry.
 *
 * WHY. Gemini geolocates the CALLER, and a Cloudflare Worker's caller is whichever colo
 * served the request (this account has been served from SIN). From some colos Gemini refuses
 * outright. So it is intermittent and depends on edge routing, not on the key, the model, the
 * billing or the video.
 *
 * WHY IT MATTERS BEYOND THE SWEEP: /analyze and /generate make the same calls. Left
 * unclassified this surfaces as a raw 400 blob in the middle of a PAID run and reads like a
 * broken app, sending the operator to check billing and keys — exactly the wrong place.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callGeminiJson, GeminiQuotaError, withGeminiKeyFailover } from '../worker/src/gemini';

test('a 400 "User location is not supported" is classified as RETRYABLE, not fatal', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: { code: 400, message: 'User location is not supported for the API use.' } }),
    { status: 400 },
  )) as typeof fetch;
  try {
    await assert.rejects(
      callGeminiJson({
        apiKey: 'k', model: 'gemini-2.5-pro', systemInstruction: 's',
        parts: [{ text: 'x' }], jsonSchema: { type: 'object' },
      }),
      (e: unknown) => {
        assert.ok(e instanceof GeminiQuotaError, `expected GeminiQuotaError, got ${String(e)}`);
        // rate_limit, NOT spend_cap — see the failover test below for why that distinction
        // is load-bearing rather than cosmetic.
        assert.equal((e as GeminiQuotaError).kind, 'rate_limit');
        assert.match((e as Error).message, /LOCATION/);
        assert.match((e as Error).message, /not a problem with the key/);
        return true;
      },
    );
  } finally { globalThis.fetch = real; }
});

test('a location refusal does NOT fail over to the fallback key', async () => {
  // withGeminiKeyFailover moves to the next key only on spend_cap. Classifying a location
  // refusal as spend_cap would look reasonable and would quietly burn the second project's
  // quota on a request that would fail there for the same reason.
  const tried: string[] = [];
  await assert.rejects(
    withGeminiKeyFailover(['k1', 'k2'], async (key) => {
      tried.push(key);
      throw new GeminiQuotaError('location refused', 'rate_limit');
    }),
    /location refused/,
  );
  assert.deepEqual(tried, ['k1'], 'a location refusal must not consume the fallback key');
});

test('an unrelated 400 is still a plain error, not swallowed as retryable', async () => {
  // The classifier must stay narrow: a genuine bad-request (malformed schema, bad model id)
  // is a bug to surface, not something to retry forever.
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: { code: 400, message: 'Invalid JSON payload received.' } }),
    { status: 400 },
  )) as typeof fetch;
  try {
    await assert.rejects(
      callGeminiJson({
        apiKey: 'k', model: 'gemini-2.5-pro', systemInstruction: 's',
        parts: [{ text: 'x' }], jsonSchema: { type: 'object' },
      }),
      (e: unknown) => {
        assert.ok(!(e instanceof GeminiQuotaError), 'an ordinary 400 must not be typed as a quota error');
        return true;
      },
    );
  } finally { globalThis.fetch = real; }
});
