/**
 * Golden-fixture contract harness.
 *
 * docs/goldens/*.json + docs/golden-test-*.json are real captured analyses. Before
 * this file the only assertion on them was "still parses"; nothing checked that a
 * stored DNA can actually be written to D1 and read back into the shape the
 * frontend renders. Every golden now goes through the full round trip. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatInsertStatements, rowToSummary, type FormatRow } from '../worker/src/db';
import { FormatDnaSchema, FormatSummarySchema, PerceptionOutputSchema } from '../shared/schemas';
import type { FormatDna } from '../shared/contract';

const REPO_ROOT = join(import.meta.dirname, '..');

function goldenPaths(): string[] {
  const top = ['docs/golden-test-1-formatdna.json', 'docs/golden-test-1-pro-formatdna.json'];
  const dir = readdirSync(join(REPO_ROOT, 'docs/goldens'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => `docs/goldens/${f}`);
  return [...top, ...dir];
}

function readGolden(rel: string): unknown {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8')) as { format?: unknown };
  return raw.format ?? raw;
}

const GOLDENS = goldenPaths();

test('the golden corpus is non-empty (fixtures did not silently vanish)', () => {
  assert.ok(GOLDENS.length >= 7, `expected >=7 goldens, found ${GOLDENS.length}`);
});

for (const rel of GOLDENS) {
  const dnaFor = (): FormatDna => {
    const parsed = FormatDnaSchema.safeParse(readGolden(rel));
    assert.ok(parsed.success, `parse failed: ${JSON.stringify(parsed.error?.issues.slice(0, 3))}`);
    return parsed.data;
  };

  test(`${rel} parses as a stored FormatDna`, () => {
    dnaFor();
  });

  test(`${rel} survives a JSON round trip unchanged`, () => {
    // The DNA is persisted as a JSON blob in formats.dna; a lossy round trip
    // (undefined-valued optionals, Dates, NaN) corrupts the library silently.
    const dna = dnaFor();
    const again = FormatDnaSchema.safeParse(JSON.parse(JSON.stringify(dna)));
    assert.ok(again.success, 'reparse after stringify must succeed');
    assert.deepEqual(again.data, dna);
  });

  test(`${rel} can be written through the real D1 insert path`, () => {
    const dna = dnaFor();
    const calls: { sql: string; bindings: unknown[] }[] = [];
    const env: any = {
      DB: {
        prepare(sql: string) {
          const rec = { sql, bindings: [] as unknown[] };
          calls.push(rec);
          const stmt = { bind: (...a: unknown[]) => { rec.bindings = a; return stmt; } };
          return stmt;
        },
      },
    };
    formatInsertStatements(env, dna, dna.tags ?? [], '2026-01-01T00:00:00Z');

    const insert = calls.find((c) => /INSERT INTO formats /.test(c.sql));
    assert.ok(insert, 'formats INSERT emitted');
    for (const c of calls) {
      assert.equal((c.sql.match(/\?/g) ?? []).length, c.bindings.length, `binding arity: ${c.sql.slice(0, 60)}`);
      // D1 only accepts null/number/string/ArrayBuffer — an object or undefined
      // binding is a runtime D1_TYPE_ERROR.
      for (const b of c.bindings) {
        assert.ok(
          b === null || typeof b === 'string' || typeof b === 'number' || typeof b === 'boolean',
          `unbindable value ${typeof b} in ${c.sql.slice(0, 60)}`,
        );
      }
    }
  });

  test(`${rel} reads back out of D1 as a valid FormatSummary`, () => {
    const dna = dnaFor();
    const row: FormatRow = {
      id: dna.id, title: dna.title, archetype: dna.archetype,
      format_type: dna.formatType ?? null,
      virality_score: dna.virality ? Math.round(dna.virality.overall) : null,
      hook_type: dna.hook.type, content_rating: dna.contentFlag.rating,
      duration_sec: dna.source.durationSec ?? null, clip_count: dna.source.clipCount ?? null,
      platform: dna.source.platform, source_url: dna.source.url ?? null,
      thumbnail_url: dna.source.thumbnailUrl ?? null,
      schema_version: String(dna.schemaVersion), current_version: dna.version,
      dna: JSON.stringify(dna), legacy_markdown: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      tags: (dna.tags ?? []).join(','),
    };
    const summary = rowToSummary(row);
    const parsed = FormatSummarySchema.safeParse(summary);
    assert.ok(parsed.success, `summary invalid: ${JSON.stringify(parsed.error?.issues.slice(0, 5))}`);
    assert.equal(summary.id, dna.id);
    assert.equal(summary.title, dna.title);
  });
}

// ─────────────────────────────────────────────────────────────
// Strict-vs-lenient contract split. FormatDnaSchema is deliberately lenient so
// pre-v3 rows keep parsing; PerceptionOutputSchema is what a NEW Gemini analysis
// must satisfy. These are different contracts and the goldens only exercise the
// lenient one — this test states which goldens (if any) cover the strict path so
// the gap is visible instead of assumed.
// ─────────────────────────────────────────────────────────────
test('the strict analyzer contract is documented as a separate, stricter shape', () => {
  const strictCapable = GOLDENS.filter((rel) => {
    const g = readGolden(rel) as Record<string, unknown>;
    const { virality: _v, schemaVersion: _s, id: _i, version: _ver, source: _src, ...rest } = g;
    return PerceptionOutputSchema.safeParse(rest).success;
  });
  // Strictly stronger: anything satisfying the strict schema must satisfy the lenient one.
  for (const rel of strictCapable) {
    assert.ok(FormatDnaSchema.safeParse(readGolden(rel)).success, `${rel} strict but not lenient — schemas diverged`);
  }
  assert.ok(strictCapable.length <= GOLDENS.length);
  console.log(
    `      note: ${strictCapable.length}/${GOLDENS.length} goldens satisfy PerceptionOutputSchema ` +
    `(the v3 analyzer contract). The rest are pre-v3 captures and only cover the lenient stored schema.`,
  );
});
