/// <reference types="vite/client" />

/** Typed build-time config. Only VITE_-prefixed vars reach the client bundle.
 *  VITE_API_BASE overrides the production API host in src/config.ts (optional — the
 *  production URL is the fallback, so no env file is required to build). */
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
