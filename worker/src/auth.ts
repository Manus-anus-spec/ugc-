/**
 * X-API-Key auth. The API_TOKENS secret holds sha256 hashes (never the tokens):
 *   {"khian":"<sha256hex>","niko":"<sha256hex>"}
 * Incoming key is hashed, then compared constant-time against every entry.
 * Two tokens so either operator can be revoked alone (FABLE5-PLAN §6).
 */
import type { Env } from './env';

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Returns the operator name ('khian' | 'niko' | …) or null when unauthorized. */
export async function authenticate(req: Request, env: Env): Promise<string | null> {
  const key = req.headers.get('X-API-Key');
  if (!key) return null;
  let tokens: Record<string, string>;
  try {
    tokens = JSON.parse(env.API_TOKENS);
  } catch {
    return null; // secret misconfigured — fail closed
  }
  const hash = await sha256Hex(key);
  for (const [operator, expected] of Object.entries(tokens)) {
    if (constantTimeEqual(hash, expected.toLowerCase())) return operator;
  }
  return null;
}
