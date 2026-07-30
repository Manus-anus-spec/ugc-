export interface Env {
  DB: D1Database;
  /** 🔑 secrets — set via `wrangler secret put`, never committed */
  GEMINI_API_KEY: string;
  /** Optional second Gemini key on a DIFFERENT Google project — automatic failover
   *  when the primary project's monthly spending cap is exhausted (Jul 25 outage). */
  GEMINI_API_KEY_FALLBACK?: string;
  RAPIDAPI_KEY: string;
  /** JSON map of operator → sha256 hex of their token: {"khian":"<hex>","niko":"<hex>"} */
  API_TOKENS: string;
  /** vars (wrangler.toml) */
  GEMINI_MODEL: string;
  GEMINI_MODEL_FALLBACK: string;
  /** Flash-tier model for cheap perception passes (boundary map, micro-pass) and the
   *  text-only virality essay — Pro is reserved for the deep per-shot work. */
  GEMINI_MODEL_FAST: string;
  ALLOWED_ORIGINS: string;
  /** Self service binding (wrangler.toml [[services]]) — /generate fans each ideation
   *  variant out as its OWN worker invocation so each gets its own CPU budget. The
   *  free plan allows only 10ms CPU per invocation; all three variants' JSON+zod+lint
   *  work in one request blew that cap (live 1102 "exceededCpu", 2026-07-30). */
  SELF?: { fetch: typeof fetch };
}

export const API_VERSION = 'ugc-api@1.0.0';
