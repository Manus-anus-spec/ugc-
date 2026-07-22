import { z } from 'zod';
import { FormatDnaSchema } from '../../../shared/schemas';
import type { Env } from '../env';
import { err, json, newId, nowIso } from '../http';
import { SUMMARY_SELECT, formatInsertStatements, rowToSummary, tagStatements, type FormatRow } from '../db';

/** POST/PUT body: the DNA plus optional tag list (tags default to dna.tags). */
const UpsertBodySchema = z.object({
  dna: FormatDnaSchema,
  tags: z.array(z.string()).optional(),
});

export async function listFormats(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const clauses: string[] = [];
  const binds: unknown[] = [];

  const archetype = url.searchParams.get('archetype');
  if (archetype) { clauses.push('f.archetype = ?'); binds.push(archetype); }
  const rating = url.searchParams.get('rating');
  if (rating) { clauses.push('f.content_rating = ?'); binds.push(rating); }
  const platform = url.searchParams.get('platform');
  if (platform) { clauses.push('f.platform = ?'); binds.push(platform); }
  const tag = url.searchParams.get('tag');
  if (tag) {
    clauses.push('EXISTS (SELECT 1 FROM format_tags t2 WHERE t2.format_id = f.id AND t2.tag = ?)');
    binds.push(tag.trim().toLowerCase());
  }
  const q = url.searchParams.get('q');
  if (q) {
    clauses.push('(f.title LIKE ? OR f.archetype LIKE ?)');
    const like = `%${q}%`;
    binds.push(like, like);
  }

  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `${SUMMARY_SELECT} ${where} ORDER BY f.updated_at DESC LIMIT ? OFFSET ?`;
  const { results } = await env.DB.prepare(sql).bind(...binds, limit, offset).all<FormatRow>();

  const countSql = `SELECT COUNT(*) AS n FROM formats f ${where}`;
  const count = await env.DB.prepare(countSql).bind(...binds).first<{ n: number }>();

  return json({ total: count?.n ?? results.length, items: results.map(rowToSummary) }, 200, req, env);
}

export async function getFormat(req: Request, env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare(`${SUMMARY_SELECT} WHERE f.id = ?`).bind(id).first<FormatRow>();
  if (!row) return err('not_found', `format ${id} not found`, 404, req, env);
  return json({
    summary: rowToSummary(row),
    dna: JSON.parse(row.dna),
    legacyMarkdown: row.legacy_markdown ?? undefined,
  }, 200, req, env);
}

export async function createFormat(req: Request, env: Env): Promise<Response> {
  const parsed = UpsertBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return err('invalid_body', 'body must be { dna: FormatDNA, tags?: string[] }', 400, req, env, parsed.error.issues);
  }
  const { dna, tags } = parsed.data;
  const id = dna.id || newId();
  const now = nowIso();
  const stored = { ...dna, id, version: 1 };

  const existing = await env.DB.prepare('SELECT id FROM formats WHERE id = ?').bind(id).first();
  if (existing) return err('conflict', `format ${id} already exists — use PUT /formats/${id}`, 409, req, env);

  await env.DB.batch(formatInsertStatements(env, stored, tags ?? stored.tags, now));
  return json({ id, version: 1 }, 201, req, env);
}

export async function updateFormat(req: Request, env: Env, id: string): Promise<Response> {
  const parsed = UpsertBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return err('invalid_body', 'body must be { dna: FormatDNA, tags?: string[] }', 400, req, env, parsed.error.issues);
  }
  const existing = await env.DB.prepare('SELECT current_version, dna FROM formats WHERE id = ?')
    .bind(id).first<{ current_version: number; dna: string }>();
  if (!existing) return err('not_found', `format ${id} not found`, 404, req, env);

  const { dna, tags } = parsed.data;
  const nextVersion = existing.current_version + 1;
  const now = nowIso();
  const stored = { ...dna, id, version: nextVersion };

  await env.DB.batch([
    // snapshot the outgoing version (the teaching loop: manual corrections are expected)
    env.DB.prepare(
      'INSERT OR REPLACE INTO format_versions (format_id, version, dna, created_at) VALUES (?, ?, ?, ?)'
    ).bind(id, existing.current_version, existing.dna, now),
    env.DB.prepare(
      `UPDATE formats SET title = ?, archetype = ?, hook_type = ?, content_rating = ?,
         duration_sec = ?, clip_count = ?, platform = ?, source_url = ?, thumbnail_url = ?,
         current_version = ?, dna = ?, updated_at = ? WHERE id = ?`
    ).bind(
      stored.title, stored.archetype, stored.hook.type, stored.contentFlag.rating,
      stored.source.durationSec, stored.source.clipCount, stored.source.platform,
      stored.source.url ?? null, stored.source.thumbnailUrl ?? null,
      nextVersion, JSON.stringify(stored), now, id,
    ),
    ...(tags ? tagStatements(env, id, tags) : []),
  ]);
  return json({ id, version: nextVersion }, 200, req, env);
}

export async function deleteFormat(req: Request, env: Env, id: string): Promise<Response> {
  const result = await env.DB.prepare('DELETE FROM formats WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return err('not_found', `format ${id} not found`, 404, req, env);
  return json({ deleted: id }, 200, req, env);
}

export async function listVersions(req: Request, env: Env, id: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT version, created_at FROM format_versions WHERE format_id = ? ORDER BY version DESC'
  ).bind(id).all<{ version: number; created_at: string }>();
  return json({ formatId: id, versions: results }, 200, req, env);
}

export async function getVersion(req: Request, env: Env, id: string, version: number): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT dna, created_at FROM format_versions WHERE format_id = ? AND version = ?'
  ).bind(id, version).first<{ dna: string; created_at: string }>();
  if (!row) return err('not_found', `format ${id} v${version} not found`, 404, req, env);
  return json({ formatId: id, version, dna: JSON.parse(row.dna), snapshotAt: row.created_at }, 200, req, env);
}
