/**
 * Gemini endpoint override (AI Gateway) + the longer location-refusal retry ladder.
 *
 * THE PROBLEM, hit live on 2026-09-01: /analyze failed with
 *   "Gemini file upload failed: ... CALLER'S LOCATION"
 * Gemini geolocates the caller, a Worker's caller is whichever colo served the request, and
 * from the colo serving this account Google refuses. It had already been retried three times
 * through the existing ladder, so it is not a flake backoff can absorb — the colo is stuck.
 *
 * THREE RESPONSES, in increasing order of how structural they are:
 *  1. a longer retry ladder for this specific failure (tested here) — improves the odds
 *     within a request, because Cloudflare may pick a different egress on a later attempt.
 *     Honestly a lottery, but a free one.
 *  2. AI Gateway (tested here) — proxy the call from Cloudflare's own infrastructure, which
 *     changes the geography Google sees. Structural.
 *  3. Smart Placement (wrangler.toml, not testable here) — move Worker EXECUTION to a colo
 *     near the backend rather than near the user. Most structural, needs the paid plan.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callGeminiJson, configureGeminiEndpoint } from '../worker/src/gemini';

const SSE_OK = 'data: {"candidates":[{"content":{"parts":[{"text":"{}"}]},"finishReason":"STOP"}]}\n\n';

async function captureUrl(env: { AI_GATEWAY_BASE?: string }): Promise<string> {
  configureGeminiEndpoint(env);
  const seen: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL | Request) => {
    seen.push(String(u));
    return new Response(SSE_OK, { status: 200 });
  }) as typeof fetch;
  try {
    await callGeminiJson({
      apiKey: 'k', model: 'gemini-2.5-pro', systemInstruction: 's',
      parts: [{ text: 'x' }], jsonSchema: { type: 'object' },
    });
  } finally {
    globalThis.fetch = real;
    configureGeminiEndpoint({});   // never leak the override into another test
  }
  return seen[0]!;
}

test('unset AI_GATEWAY_BASE calls Google directly — no behaviour change', async () => {
  assert.match(await captureUrl({}), /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\//);
});

test('AI_GATEWAY_BASE reroutes the call through Cloudflare', async () => {
  const url = await captureUrl({
    AI_GATEWAY_BASE: 'https://gateway.ai.cloudflare.com/v1/acct/ugc/google-ai-studio',
  });
  assert.match(url, /^https:\/\/gateway\.ai\.cloudflare\.com\/v1\/acct\/ugc\/google-ai-studio\/v1beta\/models\//);
});

test('a trailing slash on the gateway base does not produce a double slash', async () => {
  // A "//v1beta" path 404s at the gateway, and the operator pasting a URL with a trailing
  // slash is the likeliest way to configure this.
  const url = await captureUrl({
    AI_GATEWAY_BASE: 'https://gateway.ai.cloudflare.com/v1/acct/ugc/google-ai-studio/',
  });
  assert.ok(!url.includes('//v1beta'), `double slash in gateway path: ${url}`);
});

test('a blank AI_GATEWAY_BASE is treated as unset, not as an empty prefix', async () => {
  // An empty var is the normal shape of "I removed this" and must not produce "/v1beta/...".
  assert.match(await captureUrl({ AI_GATEWAY_BASE: '   ' }), /^https:\/\/generativelanguage\.googleapis\.com\//);
});

test('a location refusal is retried MORE times than an ordinary failure', async () => {
  // Within one request the only lever is that Cloudflare may choose a different egress on a
  // later attempt. This asserts the longer ladder is genuinely engaged rather than declared.
  configureGeminiEndpoint({});
  let calls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ error: { code: 400, message: 'User location is not supported for the API use.' } }),
      { status: 400 },
    );
  }) as typeof fetch;
  try {
    await assert.rejects(callGeminiJson({
      apiKey: 'k', model: 'gemini-2.5-pro', systemInstruction: 's',
      parts: [{ text: 'x' }], jsonSchema: { type: 'object' },
    }));
  } finally { globalThis.fetch = real; }
  // Default ladder = 3 attempts; the location ladder = 5.
  assert.ok(calls >= 4, `only attempted ${calls}x — the longer location ladder is not engaged`);
});
