/**
 * D1 query-layer unit tests.
 *
 * worker/src/db.ts is the ONLY place a FormatDNA becomes rows, and the only place
 * rows become the shape the frontend renders. It is pure apart from `env.DB.prepare`,
 * so a tiny recording stub covers it with no wrangler/miniflare runtime. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatInsertStatements,
  ftsSyncStatements,
  rowToSummary,
  tagStatements,
  SUMMARY_SELECT,
  type FormatRow,
} from '../worker/src/db';
import { FormatDnaSchema } from '../shared/schemas';
import type { FormatDna } from '../shared/contract';

const REPO_ROOT = join(import.meta.dirname, '..');

// ── recording D1 stub: captures (sql, bindings) per prepared statement ──
interface Recorded { sql: string; bindings: unknown[] }

function fakeEnv(): { env: any; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        const rec: Recorded = { sql, bindings: [] };
        calls.push(rec);
        const stmt = { bind: (...args: unknown[]) => { rec.bindings = args; return stmt; } };
        return stmt;
      },
    },
  };
  return { env, calls };
}

function baseRow(over: Partial<FormatRow> = {}): FormatRow {
  return {
    id: 'fmt1', title: 'Elevator freeze', archetype: 'outfit check',
    format_type: 'outfit_showcase', virality_score: 58, hook_type: 'visual',
    content_rating: 'sfw', duration_sec: 8.2, clip_count: 1, platform: 'instagram',
    source_url: 'https://instagram.com/reel/x/', thumbnail_url: null,
    schema_version: '1', current_version: 3, dna: '{}', legacy_markdown: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
    tags: 'outfit,elevator', ...over,
  };
}

// ─────────────────────────────────────────────────────────────
// rowToSummary — snake_case row → camelCase contract
// ─────────────────────────────────────────────────────────────
test('rowToSummary maps every column to its contract field', () => {
  const s = rowToSummary(baseRow());
  assert.equal(s.id, 'fmt1');
  assert.equal(s.formatType, 'outfit_showcase');
  assert.equal(s.viralityScore, 58);
  assert.equal(s.hookType, 'visual');
  assert.equal(s.contentRating, 'sfw');
  assert.equal(s.durationSec, 8.2);
  assert.equal(s.clipCount, 1);
  assert.equal(s.sourceUrl, 'https://instagram.com/reel/x/');
  assert.equal(s.version, 3, 'version comes from current_version');
  assert.equal(s.schemaVersion, '1');
  assert.equal(s.createdAt, '2026-01-01T00:00:00Z');
  assert.equal(s.updatedAt, '2026-01-02T00:00:00Z');
});

test('rowToSummary splits group_concat tags into an array', () => {
  assert.deepEqual(rowToSummary(baseRow()).tags, ['outfit', 'elevator']);
});

test('rowToSummary returns [] for a NULL tags join (format with no tags)', () => {
  assert.deepEqual(rowToSummary(baseRow({ tags: null })).tags, []);
});

test('rowToSummary drops empty segments from a trailing-comma group_concat', () => {
  assert.deepEqual(rowToSummary(baseRow({ tags: 'a,,b,' })).tags, ['a', 'b']);
});

test('rowToSummary preserves NULLs as null rather than coercing to 0/""', () => {
  const s = rowToSummary(baseRow({
    format_type: null, virality_score: null, hook_type: null, content_rating: null,
    duration_sec: null, clip_count: null, platform: null, source_url: null,
  }));
  assert.equal(s.formatType, null);
  assert.equal(s.viralityScore, null);
  assert.equal(s.durationSec, null, 'a null duration must not become 0');
  assert.equal(s.clipCount, null);
  assert.equal(s.platform, null);
});

test('SUMMARY_SELECT exposes every column rowToSummary reads', () => {
  // Guard against the classic break: a new field added to rowToSummary but not to
  // the SELECT, which silently yields undefined at runtime.
  for (const col of [
    'f.id', 'f.title', 'f.archetype', 'f.format_type', 'f.virality_score', 'f.hook_type',
    'f.content_rating', 'f.duration_sec', 'f.clip_count', 'f.platform', 'f.source_url',
    'f.thumbnail_url', 'f.schema_version', 'f.current_version', 'f.created_at', 'f.updated_at',
  ]) {
    assert.ok(SUMMARY_SELECT.includes(col), `SUMMARY_SELECT is missing ${col}`);
  }
  assert.ok(/AS tags/.test(SUMMARY_SELECT), 'tags must be aliased for rowToSummary');
});

// ─────────────────────────────────────────────────────────────
// tagStatements — delete-then-insert, normalised and de-duplicated
// ─────────────────────────────────────────────────────────────
test('tagStatements deletes existing tags before inserting', () => {
  const { env, calls } = fakeEnv();
  tagStatements(env, 'fmt1', ['a']);
  assert.match(calls[0]!.sql, /DELETE FROM format_tags WHERE format_id = \?/);
  assert.deepEqual(calls[0]!.bindings, ['fmt1']);
});

test('tagStatements lowercases, trims and de-duplicates', () => {
  const { env, calls } = fakeEnv();
  tagStatements(env, 'fmt1', ['Outfit', ' outfit ', 'ELEVATOR']);
  const inserted = calls.slice(1).map((c) => c.bindings[1]);
  assert.deepEqual(inserted, ['outfit', 'elevator']);
});

test('tagStatements drops empty/whitespace-only tags', () => {
  const { env, calls } = fakeEnv();
  const stmts = tagStatements(env, 'fmt1', ['', '   ', 'real']);
  assert.equal(stmts.length, 2, 'one DELETE + one INSERT');
  assert.equal(calls[1]!.bindings[1], 'real');
});

test('tagStatements with no tags emits only the DELETE', () => {
  const { env } = fakeEnv();
  assert.equal(tagStatements(env, 'fmt1', []).length, 1);
});

// ─────────────────────────────────────────────────────────────
// insert + FTS sync — driven by a real golden fixture
// ─────────────────────────────────────────────────────────────
function loadGolden(rel: string): FormatDna {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8')) as { format?: unknown };
  const parsed = FormatDnaSchema.safeParse((raw as any).format ?? raw);
  assert.ok(parsed.success, `golden ${rel} must parse: ${JSON.stringify(parsed.error?.issues.slice(0, 3))}`);
  return parsed.data;
}

test('formatInsertStatements binds a real golden DNA into the formats row', () => {
  const dna = loadGolden('docs/golden-test-1-formatdna.json');
  const { env, calls } = fakeEnv();
  formatInsertStatements(env, dna, ['outfit'], '2026-01-01T00:00:00Z');

  const insert = calls.find((c) => /INSERT INTO formats /.test(c.sql));
  assert.ok(insert, 'a formats INSERT must be emitted');
  const [id, title, archetype] = insert!.bindings;
  assert.equal(id, dna.id);
  assert.equal(title, dna.title);
  assert.equal(archetype, dna.archetype);

  // The DNA is stored as the JSON blob and must round-trip through the schema.
  const blob = insert!.bindings.find((b) => typeof b === 'string' && b.startsWith('{')) as string;
  assert.ok(FormatDnaSchema.safeParse(JSON.parse(blob)).success, 'stored dna blob must re-parse');
});

test('formatInsertStatements placeholder count matches the bindings count', () => {
  // An off-by-one here is a D1_TYPE_ERROR at runtime and nowhere else.
  const dna = loadGolden('docs/golden-test-1-formatdna.json');
  const { env, calls } = fakeEnv();
  formatInsertStatements(env, dna, ['outfit'], '2026-01-01T00:00:00Z');
  for (const c of calls) {
    const placeholders = (c.sql.match(/\?/g) ?? []).length;
    assert.equal(placeholders, c.bindings.length, `placeholder/binding mismatch in: ${c.sql.slice(0, 80)}`);
  }
});

test('formatInsertStatements emits the insert, the tags and the FTS sync together', () => {
  const dna = loadGolden('docs/golden-test-1-formatdna.json');
  const { env, calls } = fakeEnv();
  formatInsertStatements(env, dna, ['a', 'b'], '2026-01-01T00:00:00Z');
  const sql = calls.map((c) => c.sql).join(' | ');
  assert.ok(/INSERT INTO formats /.test(sql));
  assert.ok(/format_tags/.test(sql));
  assert.ok(/formats_fts/.test(sql), 'FTS must stay in sync or search silently rots');
});

test('formatInsertStatements maps a null formatType to NULL, not the string "undefined"', () => {
  const dna = { ...loadGolden('docs/golden-test-1-formatdna.json') } as any;
  delete dna.formatType;
  const { env, calls } = fakeEnv();
  formatInsertStatements(env, dna, [], '2026-01-01T00:00:00Z');
  const insert = calls.find((c) => /INSERT INTO formats /.test(c.sql))!;
  assert.ok(insert.bindings.includes(null), 'absent formatType must bind as null');
  assert.ok(!insert.bindings.includes('undefined'));
});

test('ftsSyncStatements replaces the row and indexes hook + whyItWorks text', () => {
  const dna = loadGolden('docs/golden-test-1-formatdna.json');
  const { env, calls } = fakeEnv();
  ftsSyncStatements(env, dna, ['outfit']);
  assert.match(calls[0]!.sql, /DELETE FROM formats_fts WHERE id = \?/);
  const insert = calls[1]!;
  const joined = insert.bindings.join(' ');
  assert.ok(joined.includes(dna.hook.openingVisual), 'hook text must be indexed');
  assert.ok(joined.includes(dna.whyItWorks.mechanism), 'whyItWorks must be indexed');
  assert.ok(!joined.includes('undefined'), 'an absent optional must not leak "undefined" into the index');
});

test('ftsSyncStatements never leaks "undefined" when hook.firstLineOrText is absent', () => {
  const dna = { ...loadGolden('docs/golden-test-1-formatdna.json') } as any;
  delete dna.hook.firstLineOrText;
  const { env, calls } = fakeEnv();
  ftsSyncStatements(env, dna, []);
  assert.ok(!calls[1]!.bindings.join(' ').includes('undefined'));
});
