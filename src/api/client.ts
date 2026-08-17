/**
 * Typed fetch wrapper: auth header on every call, typed ApiError on every failure.
 * Errors are real errors — no {error} smuggled inside success payloads.
 */
import type { ApiError } from '@shared/contract';
import { AUTH_HEADER } from '@shared/fields';
import { API_BASE, TOKEN_STORAGE_KEY } from '../config';

export class ApiRequestError extends Error {
  constructor(public readonly status: number, public readonly api: ApiError) {
    super(api.error);
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

interface RequestOptions {
  method?: string;
  body?: BodyInit;
  timeoutMs?: number;
  json?: unknown;
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { [AUTH_HEADER]: getToken() ?? '' };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  if (!res.ok) {
    let api: ApiError;
    try {
      api = await res.json() as ApiError;
    } catch {
      api = { error: `HTTP ${res.status}`, code: 'http_error' };
    }
    throw new ApiRequestError(res.status, api);
  }
  return res.json() as Promise<T>;
}
