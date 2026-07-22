import { ModelProfileSchema } from '../../../shared/schemas';
import type { Env } from '../env';
import { err, json, nowIso } from '../http';

export async function listProfiles(req: Request, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, version, updated_at FROM profiles ORDER BY name'
  ).all<{ id: string; name: string; version: number; updated_at: string }>();
  return json({ items: results.map((r) => ({ id: r.id, name: r.name, version: r.version, updatedAt: r.updated_at })) }, 200, req, env);
}

export async function getProfile(req: Request, env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT profile FROM profiles WHERE id = ?').bind(id).first<{ profile: string }>();
  if (!row) return err('not_found', `profile ${id} not found`, 404, req, env);
  return json(JSON.parse(row.profile), 200, req, env);
}

/** PUT /profiles/:id — validated upsert; server bumps version on every write. */
export async function putProfile(req: Request, env: Env, id: string): Promise<Response> {
  const parsed = ModelProfileSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return err('invalid_body', 'body must be a ModelProfile', 400, req, env, parsed.error.issues);
  }
  if (parsed.data.id !== id) {
    return err('id_mismatch', `body id "${parsed.data.id}" != path id "${id}"`, 400, req, env);
  }
  const existing = await env.DB.prepare('SELECT version FROM profiles WHERE id = ?').bind(id).first<{ version: number }>();
  const version = (existing?.version ?? 0) + 1;
  const profile = { ...parsed.data, version };
  await env.DB.prepare(
    `INSERT INTO profiles (id, name, version, profile, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, version = excluded.version,
       profile = excluded.profile, updated_at = excluded.updated_at`
  ).bind(id, profile.name, version, JSON.stringify(profile), nowIso()).run();
  return json({ id, version }, 200, req, env);
}

export async function deleteProfile(req: Request, env: Env, id: string): Promise<Response> {
  const result = await env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return err('not_found', `profile ${id} not found`, 404, req, env);
  return json({ deleted: id }, 200, req, env);
}
