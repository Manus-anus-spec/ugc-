import type { FormatDna, FormatSummary, Platform, ContentRating } from '../../shared/contract';
import type { Env } from './env';

/** Raw shape of a formats row joined with its group_concat'd tags. */
export interface FormatRow {
  id: string;
  title: string;
  archetype: string;
  hook_type: string | null;
  content_rating: string | null;
  duration_sec: number | null;
  clip_count: number | null;
  platform: string | null;
  source_url: string | null;
  thumbnail_url: string | null;
  schema_version: string;
  current_version: number;
  dna: string;
  legacy_markdown: string | null;
  created_at: string;
  updated_at: string;
  tags: string | null;
}

export function rowToSummary(row: FormatRow): FormatSummary {
  return {
    id: row.id,
    title: row.title,
    archetype: row.archetype,
    hookType: row.hook_type,
    contentRating: (row.content_rating as ContentRating | null),
    durationSec: row.duration_sec,
    clipCount: row.clip_count,
    platform: (row.platform as Platform | null),
    sourceUrl: row.source_url,
    thumbnailUrl: row.thumbnail_url,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    version: row.current_version,
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function tagStatements(env: Env, formatId: string, tags: string[]): D1PreparedStatement[] {
  const stmts = [env.DB.prepare('DELETE FROM format_tags WHERE format_id = ?').bind(formatId)];
  const unique = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  for (const tag of unique) {
    stmts.push(env.DB.prepare('INSERT INTO format_tags (format_id, tag) VALUES (?, ?)').bind(formatId, tag));
  }
  return stmts;
}

/** The one way a FormatDNA becomes a row — used by /analyze and POST /formats alike. */
export function formatInsertStatements(env: Env, stored: FormatDna, tags: string[], now: string): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      `INSERT INTO formats (id, title, archetype, hook_type, content_rating, duration_sec, clip_count,
         platform, source_url, thumbnail_url, schema_version, current_version, dna, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '1', 1, ?, ?, ?)`
    ).bind(
      stored.id, stored.title, stored.archetype, stored.hook.type, stored.contentFlag.rating,
      stored.source.durationSec, stored.source.clipCount, stored.source.platform,
      stored.source.url ?? null, stored.source.thumbnailUrl ?? null,
      JSON.stringify(stored), now, now,
    ),
    ...tagStatements(env, stored.id, tags),
  ];
}

export const SUMMARY_SELECT = `
  SELECT f.id, f.title, f.archetype, f.hook_type, f.content_rating, f.duration_sec,
         f.clip_count, f.platform, f.source_url, f.thumbnail_url, f.schema_version,
         f.current_version, f.dna, f.legacy_markdown, f.created_at, f.updated_at,
         (SELECT group_concat(t.tag, ',') FROM format_tags t WHERE t.format_id = f.id) AS tags
  FROM formats f
`;
