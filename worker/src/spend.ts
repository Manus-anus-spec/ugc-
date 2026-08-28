/**
 * Per-operator daily call caps on the endpoints that spend Gemini money (§P2 hardening).
 *
 * /analyze and /generate had no rate limiting at all — only quota ERROR handling, which
 * fires after the money is already gone. Both are auth-gated to two operators, so this is
 * not about abuse by strangers: it is that a leaked token means UNCAPPED spend, and that a
 * retry loop in an automation script can burn a month's budget before anyone opens a
 * dashboard.
 *
 * FAIL OPEN, DELIBERATELY. Every failure mode here — the api_usage table not existing
 * because migration 0005 has not been applied yet, a D1 blip, a malformed cap var — allows
 * the request and logs a warning. The reasoning: this is a SPEND GUARD on a two-operator
 * internal tool, not an authorization boundary (auth.ts is, and that fails closed). If the
 * counter breaks, the correct outcome is "Khian's paid run still works and there is a
 * warning in the logs", not "the app is bricked until a migration lands". Getting that
 * backwards would turn a cost optimisation into an outage — and code shipped ahead of its
 * migration is exactly the state this repo is in right now.
 */
import type { Env } from './env';

export type PaidEndpoint = 'analyze' | 'generate';

/** Generous defaults — high enough that normal operator work never notices, low enough that
 *  a runaway loop or a leaked token is bounded to a bearable number. Overridable per
 *  deployment via wrangler [vars] without a code change. */
const DEFAULT_CAPS: Record<PaidEndpoint, number> = {
  analyze: 60,
  generate: 60,
};

export interface CapResult {
  allowed: boolean;
  used: number;
  cap: number;
  /** True when the counter could not be read/written and the request was let through. */
  degraded: boolean;
}

/** UTC day key. UTC not local time, so the reset point does not move with the operator. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function capFor(env: Env, endpoint: PaidEndpoint): number {
  const raw = endpoint === 'analyze' ? env.DAILY_CAP_ANALYZE : env.DAILY_CAP_GENERATE;
  const n = Number(raw);
  // A typo'd or empty var must not silently mean "cap of 0" and block every paid call.
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CAPS[endpoint];
}

/**
 * Count one call against the operator's daily allowance and report whether it may proceed.
 *
 * The increment is a single atomic UPSERT, so two concurrent requests cannot both read the
 * same count and double-spend a slot — SQLite applies `calls = calls + 1` under the row
 * lock. The post-increment value is returned by the same statement, which is why this is
 * one round trip rather than a read followed by a write.
 */
export async function countPaidCall(
  env: Env, operator: string, endpoint: PaidEndpoint,
): Promise<CapResult> {
  const cap = capFor(env, endpoint);
  const day = utcDay();
  try {
    const row = await env.DB.prepare(
      `INSERT INTO api_usage (operator, day, endpoint, calls) VALUES (?, ?, ?, 1)
       ON CONFLICT (operator, day, endpoint) DO UPDATE SET calls = calls + 1
       RETURNING calls`,
    ).bind(operator, day, endpoint).first<{ calls: number }>();
    const used = row?.calls ?? 1;
    if (used > cap) {
      console.warn(`spend cap: ${operator} hit the ${endpoint} cap (${used}/${cap}) for ${day}`);
      return { allowed: false, used, cap, degraded: false };
    }
    // Log the approach to the cap so it is visible before it bites, not after.
    if (used >= Math.floor(cap * 0.8)) {
      console.warn(`spend cap: ${operator} at ${used}/${cap} ${endpoint} calls for ${day}`);
    }
    return { allowed: true, used, cap, degraded: false };
  } catch (e) {
    // Almost certainly "no such table: api_usage" — migration 0005 not applied yet.
    console.warn(
      `spend cap DEGRADED (allowing the call): ${e instanceof Error ? e.message : String(e)}`,
    );
    return { allowed: true, used: 0, cap, degraded: true };
  }
}

/** Operator-facing message. Names the cap and how to raise it — a bare 429 on a paid tool
 *  the operator owns is just confusing. */
export function capMessage(endpoint: PaidEndpoint, r: CapResult): string {
  return (
    `Daily ${endpoint} cap reached (${r.used - 1}/${r.cap} calls today, UTC). ` +
    `This is a spend guard, not a quota from Google. Raise it with ` +
    `DAILY_CAP_${endpoint.toUpperCase()} in worker/wrangler.toml [vars] and redeploy, ` +
    `or wait for the UTC day to roll over.`
  );
}
