/**
 * The /generate attempt ladder — regression tests for the 0/3-variants outage.
 *
 * WHAT BROKE (2026-08-29). Every /generate call returned 502 "only 0/3 ideation variants
 * survived", with the detail array carrying, three times identically:
 *   400 FAILED_PRECONDITION "User location is not supported for the API use."
 *
 * TWO SEPARATE BUGS, and the second is the one that mattered:
 *  1. The primary model was a PREVIEW id (gemini-3.1-pro-preview). Previews carry narrower
 *     regional availability, and Google refused it from the Cloudflare colo serving this
 *     account.
 *  2. The ladder's catch was `if (!isInputBlock(e)) throw e`, so any error that was not an
 *     input block rethrew on tier 1. Tiers 2 and 3 were unreachable for every other error
 *     class — and tier 3 is where the fallback MODEL lives. The configured fallback had
 *     therefore never once run. Fixing only the model id would have left the ladder just as
 *     dead for the next model-scoped failure.
 *
 * These tests exercise the ladder's control flow directly rather than through the route,
 * because the behaviour that regressed is the loop, not the Gemini call. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiQuotaError } from '../worker/src/gemini';

/** A faithful copy of the ladder's control flow (worker/src/routes/generate.ts).
 *  Kept in sync by the assertions below plus the source-level guard at the end. */
class InputBlocked extends Error {}

const isInputBlock = (e: unknown): boolean =>
  e instanceof Error && /blocked the input/i.test(e.message);

async function runLadder(attempts: Array<() => Promise<string>>): Promise<string> {
  let raw: string | null = null;
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      raw = await attempt();
      break;
    } catch (e) {
      lastError = e;
      if (e instanceof GeminiQuotaError && e.kind === 'spend_cap') throw e;
    }
  }
  if (raw === null) {
    if (lastError instanceof GeminiQuotaError) throw lastError;
    if (isInputBlock(lastError)) throw new InputBlocked();
    if (lastError) throw lastError;
    throw new InputBlocked();
  }
  return raw;
}

const geoError = () => new Error(
  'Gemini gemini-3.1-pro-preview returned 400: {"error":{"code":400,'
  + '"message":"User location is not supported for the API use.","status":"FAILED_PRECONDITION"}}',
);

// ─────────────────────────────────────────────────────────────
// THE OUTAGE ITSELF
// ─────────────────────────────────────────────────────────────

test('a geo rejection on tier 1 now FALLS THROUGH to the fallback model', async () => {
  // This is the exact regression: before the fix, tier 1 rethrew and tiers 2-3 never ran.
  const tried: string[] = [];
  const out = await runLadder([
    async () => { tried.push('tier1-primary'); throw geoError(); },
    async () => { tried.push('tier2-hardstrip'); throw geoError(); },
    async () => { tried.push('tier3-fallback-model'); return '{"ok":true}'; },
  ]);
  assert.equal(out, '{"ok":true}');
  assert.deepEqual(tried, ['tier1-primary', 'tier2-hardstrip', 'tier3-fallback-model']);
});

test('the fallback model tier is reached for a generic 500 too, not just geo', async () => {
  const out = await runLadder([
    async () => { throw new Error('Gemini returned 503: upstream unavailable'); },
    async () => { throw new Error('Gemini returned 503: upstream unavailable'); },
    async () => 'recovered',
  ]);
  assert.equal(out, 'recovered');
});

test('when EVERY tier fails, the LAST error propagates (not the first)', async () => {
  // The detail array must name the cause that actually ended the run.
  await assert.rejects(
    runLadder([
      async () => { throw new Error('first: input was blocked the input'); },
      async () => { throw new Error('second failure'); },
      async () => { throw new Error('third and final failure'); },
    ]),
    /third and final failure/,
  );
});

// ─────────────────────────────────────────────────────────────
// TYPED ERRORS MUST SURVIVE — the classifier downstream depends on them
// ─────────────────────────────────────────────────────────────

test('a spend cap is TERMINAL — it does not walk the rest of the ladder', async () => {
  // Every tier uses the same keys and withGeminiKeyFailover already tried them all, so
  // continuing would burn wall-clock on a paid endpoint to reach the same answer.
  const tried: string[] = [];
  await assert.rejects(
    runLadder([
      async () => { tried.push('t1'); throw new GeminiQuotaError('cap exhausted', 'spend_cap'); },
      async () => { tried.push('t2'); return 'should never run'; },
    ]),
    (e: unknown) => e instanceof GeminiQuotaError && e.kind === 'spend_cap',
  );
  assert.deepEqual(tried, ['t1'], 'the ladder kept going after a spend cap');
});

test('a rate limit DOES walk the ladder but keeps its type if all tiers fail', async () => {
  // Rate-limit is how the geo refusal is classified (retryable), so it must escalate —
  // and still surface as gemini_rate_limited rather than a generic 502.
  await assert.rejects(
    runLadder([
      async () => { throw new GeminiQuotaError('slow down', 'rate_limit'); },
      async () => { throw new GeminiQuotaError('slow down', 'rate_limit'); },
      async () => { throw new GeminiQuotaError('slow down', 'rate_limit'); },
    ]),
    (e: unknown) => e instanceof GeminiQuotaError && e.kind === 'rate_limit',
  );
});

test('an input block on every tier still surfaces as InputBlocked', async () => {
  // The original behaviour, preserved: gemini_input_blocked, not a generic 502.
  await assert.rejects(
    runLadder([
      async () => { throw new Error('Gemini blocked the input: PROHIBITED_CONTENT'); },
      async () => { throw new Error('Gemini blocked the input: PROHIBITED_CONTENT'); },
      async () => { throw new Error('Gemini blocked the input: PROHIBITED_CONTENT'); },
    ]),
    (e: unknown) => e instanceof InputBlocked,
  );
});

test('a tier that succeeds short-circuits the rest', async () => {
  const tried: string[] = [];
  const out = await runLadder([
    async () => { tried.push('t1'); return 'ok'; },
    async () => { tried.push('t2'); return 'should not run'; },
  ]);
  assert.equal(out, 'ok');
  assert.deepEqual(tried, ['t1']);
});

// ─────────────────────────────────────────────────────────────
// Source-level guards — the model shape and the removed rethrow
// ─────────────────────────────────────────────────────────────

test('the real route no longer rethrows non-input-block errors on tier 1', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const src = readFileSync(
    join(import.meta.dirname, '..', 'worker', 'src', 'routes', 'generate.ts'), 'utf8',
  );
  assert.ok(
    !/if \(!isInputBlock\(e\)\) throw e;/.test(src),
    'the tier-1 rethrow is back — the fallback model is dead code again',
  );
  assert.ok(/kind === 'spend_cap'\) throw e/.test(src), 'spend cap must stay terminal');
});

test('the primary model is a GA id, not a preview', async () => {
  // A preview id as PRIMARY is what caused the outage: narrower regional availability,
  // refused from this egress. Evidence it is model-scoped and not country-scoped: all 169
  // library formats were rescored through gemini-2.5-pro from the same egress.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const toml = readFileSync(join(import.meta.dirname, '..', 'worker', 'wrangler.toml'), 'utf8');
  const primary = toml.match(/^GEMINI_MODEL\s*=\s*"([^"]+)"/m)?.[1];
  assert.ok(primary, 'GEMINI_MODEL not found');
  assert.ok(!/preview/i.test(primary!), `primary model is a preview id: ${primary}`);
});

test('the fallback is a DIFFERENT model from the primary, or it is not a fallback', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const toml = readFileSync(join(import.meta.dirname, '..', 'worker', 'wrangler.toml'), 'utf8');
  const primary = toml.match(/^GEMINI_MODEL\s*=\s*"([^"]+)"/m)?.[1];
  const fallback = toml.match(/^GEMINI_MODEL_FALLBACK\s*=\s*"([^"]+)"/m)?.[1];
  assert.ok(fallback, 'GEMINI_MODEL_FALLBACK not found');
  assert.notEqual(fallback, primary, 'tier 3 would retry the same model that just failed');
  assert.ok(!/preview/i.test(fallback!), `fallback is a preview id: ${fallback}`);
});
