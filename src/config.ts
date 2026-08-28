/** One API, one URL (replaces the old triple-endpoint config).
 *
 *  The production value is the FALLBACK, so a plain `npm run build` needs no env file and
 *  cannot silently build against the wrong host — but local dev (or a future Cloudflare
 *  Pages move) can point elsewhere with VITE_API_BASE without editing source.
 *
 *  This replaces the deleted `.env.production`, which was a pure trap: it set
 *  VITE_PROXY_URL to the LEGACY ugc-worker host, nothing read that variable, and it sat
 *  tracked in the repo looking authoritative. */
const ENV_BASE = import.meta.env.VITE_API_BASE as string | undefined;

export const API_BASE = ENV_BASE?.replace(/\/+$/, '') || 'https://ugc-api.khian-moclou.workers.dev';
export const TOKEN_STORAGE_KEY = 'ugc-api-token';
