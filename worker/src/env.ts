export interface Env {
  DB: D1Database;
  /** 🔑 secrets — set via `wrangler secret put`, never committed */
  GEMINI_API_KEY: string;
  RAPIDAPI_KEY: string;
  /** JSON map of operator → sha256 hex of their token: {"khian":"<hex>","niko":"<hex>"} */
  API_TOKENS: string;
  /** vars (wrangler.toml) */
  GEMINI_MODEL: string;
  GEMINI_MODEL_FALLBACK: string;
  ALLOWED_ORIGINS: string;
}

export const API_VERSION = 'ugc-api@1.0.0';
