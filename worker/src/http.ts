import type { ApiError } from '../../shared/contract';
import type { Env } from './env';

const AUTH_HEADER = 'X-API-Key';

export function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, ${AUTH_HEADER}`,
    'Access-Control-Max-Age': '86400',
  };
  if (allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export function json(data: unknown, status: number, req: Request, env: Env): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(req, env) },
  });
}

/** Typed error response — errors are never smuggled inside a 200 (fixes N2). */
export function err(code: string, message: string, status: number, req: Request, env: Env, detail?: unknown): Response {
  const body: ApiError = { error: message, code, ...(detail !== undefined ? { detail } : {}) };
  return json(body, status, req, env);
}

export function handleOptions(req: Request, env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req, env) });
}

export const nowIso = (): string => new Date().toISOString();
export const newId = (): string => crypto.randomUUID();
