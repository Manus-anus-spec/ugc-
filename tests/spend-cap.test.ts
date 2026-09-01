/**
 * §P2 — per-operator daily spend caps on /analyze and /generate.
 *
 * Neither endpoint had any rate limiting: only Gemini quota ERROR handling, which fires
 * after the money is gone. Both are auth-gated to two operators, so this is not about
 * strangers — it is that a leaked token means uncapped spend and a retry loop in an
 * automation script can burn a month's budget before anyone opens a dashboard.
 *
 * The FAIL-OPEN behaviour is the most important thing tested here. This is a spend guard on
 * a two-operator internal tool, not an authorization boundary (auth.ts is that, and it fails
 * closed). If the counter breaks — most likely because migration 0005 has not been applied
 * yet, which is exactly the state this code ships in — the right outcome is "the paid run
 * still works and there is a warning in the logs", not "the app is bricked". Getting that
 * backwards turns a cost optimisation into an outage. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capMessage, countPaidCall, utcDay } from '../worker/src/spend';
import type { Env } from '../worker/src/env';

/** In-memory stand-in for the api_usage table, honouring the UPSERT's increment semantics. */
function fakeEnv(opts: { throws?: boolean; caps?: Partial<Record<string, string>> } = {}) {
  const rows = new Map<string, number>();
  const env = {
    ...opts.caps,
    DB: {
      prepare(_sql: string) {
        return {
          bind(operator: string, day: string, endpoint: string) {
            return {
              async first<T>(): Promise<T> {
                if (opts.throws) throw new Error('no such table: api_usage');
                const key = `${operator}|${day}|${endpoint}`;
                const next = (rows.get(key) ?? 0) + 1;
                rows.set(key, next);
                return { calls: next } as T;
              },
            };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, rows };
}

test('a call under the cap is allowed and counted', async () => {
  const { env } = fakeEnv({ caps: { DAILY_CAP_ANALYZE: '3' } });
  const r = await countPaidCall(env, 'khian', 'analyze');
  assert.equal(r.allowed, true);
  assert.equal(r.used, 1);
  assert.equal(r.cap, 3);
  assert.equal(r.degraded, false);
});

test('the cap blocks only AFTER the allowance is spent, not on the last allowed call', async () => {
  const { env } = fakeEnv({ caps: { DAILY_CAP_ANALYZE: '3' } });
  for (let i = 1; i <= 3; i++) {
    const r = await countPaidCall(env, 'khian', 'analyze');
    assert.equal(r.allowed, true, `call ${i} of 3 should be allowed (used ${r.used})`);
  }
  const fourth = await countPaidCall(env, 'khian', 'analyze');
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.used, 4);
});

test('caps are PER OPERATOR — one operator cannot starve the other', async () => {
  const { env } = fakeEnv({ caps: { DAILY_CAP_ANALYZE: '1' } });
  assert.equal((await countPaidCall(env, 'khian', 'analyze')).allowed, true);
  assert.equal((await countPaidCall(env, 'khian', 'analyze')).allowed, false);
  // niko's allowance is untouched by khian burning his.
  assert.equal((await countPaidCall(env, 'niko', 'analyze')).allowed, true);
});

test('caps are PER ENDPOINT — analyze and generate cost differently', async () => {
  const { env } = fakeEnv({ caps: { DAILY_CAP_ANALYZE: '1', DAILY_CAP_GENERATE: '1' } });
  assert.equal((await countPaidCall(env, 'khian', 'analyze')).allowed, true);
  assert.equal((await countPaidCall(env, 'khian', 'analyze')).allowed, false);
  assert.equal((await countPaidCall(env, 'khian', 'generate')).allowed, true);
});

// ── fail-open: the half that must never regress ──

test('FAIL OPEN: a missing api_usage table allows the call and reports degraded', async () => {
  // This is the state the code ships in — 0005 is written but not yet applied to live D1.
  const { env } = fakeEnv({ throws: true });
  const r = await countPaidCall(env, 'khian', 'analyze');
  assert.equal(r.allowed, true, 'a broken counter must NEVER block a paid run');
  assert.equal(r.degraded, true);
});

test('FAIL OPEN: repeated failures keep allowing (no accidental lockout)', async () => {
  const { env } = fakeEnv({ throws: true });
  for (let i = 0; i < 5; i++) {
    assert.equal((await countPaidCall(env, 'khian', 'generate')).allowed, true);
  }
});

// ── cap parsing: a typo must not mean "block everything" ──

test('an absent cap var falls back to the default, not to zero', async () => {
  const { env } = fakeEnv();
  const r = await countPaidCall(env, 'khian', 'analyze');
  assert.ok(r.cap >= 10, `default cap looks wrong: ${r.cap}`);
  assert.equal(r.allowed, true);
});

for (const bad of ['', 'sixty', '0', '-5', 'NaN']) {
  test(`a malformed cap var (${JSON.stringify(bad)}) falls back to the default, never 0`, async () => {
    const { env } = fakeEnv({ caps: { DAILY_CAP_ANALYZE: bad } });
    const r = await countPaidCall(env, 'khian', 'analyze');
    assert.ok(r.cap > 0, 'a typo must not silently block every paid call');
    assert.equal(r.allowed, true);
  });
}

test('a fractional cap is floored rather than rejected', async () => {
  const { env } = fakeEnv({ caps: { DAILY_CAP_GENERATE: '2.7' } });
  assert.equal((await countPaidCall(env, 'khian', 'generate')).cap, 2);
});

// ── day key ──

test('utcDay is a UTC YYYY-MM-DD key', () => {
  assert.equal(utcDay(new Date('2026-08-28T23:30:00Z')), '2026-08-28');
  assert.match(utcDay(), /^\d{4}-\d{2}-\d{2}$/);
});

test('utcDay uses UTC, so the reset point does not move with the operator’s timezone', () => {
  // 23:30 UTC on the 28th is already the 29th in Sydney; the key must stay the 28th.
  assert.equal(utcDay(new Date('2026-08-28T23:30:00Z')), '2026-08-28');
  assert.equal(utcDay(new Date('2026-08-29T00:30:00Z')), '2026-08-29');
});

test('the cap message tells the operator what happened and how to raise it', () => {
  const msg = capMessage('analyze', { allowed: false, used: 61, cap: 60, degraded: false });
  assert.match(msg, /60/);
  assert.match(msg, /spend guard, not a quota from Google/, 'must not read as a Google quota error');
  assert.match(msg, /DAILY_CAP_ANALYZE/, 'must name the var to change');
});
