/**
 * Guard: no SECOND, divergent copy of the virality rubric anywhere in the worker.
 *
 * WHY THIS EXISTS. The recalibration (rubric 3) fixed worker/src/prompt.ts — and missed that
 * routes/admin.ts carried its own inline copy of the OLD rubric: "a wrong HIGH score is more
 * expensive than a wrong low one", "90+ almost never", "when torn take the LOWER", "do not
 * award any dimension above 80". It also stamped no rubricVersion. So running the backfill
 * would have quietly re-injected pre-recalibration scores, unstamped and indistinguishable
 * from real ones — undoing the fix from a route nobody was looking at.
 *
 * The same trap applies to models: a scoring call left on GEMINI_MODEL_FAST re-introduces the
 * cheap-judgement problem one code path at a time. Perception calls (boundary map, motion
 * micro-pass) legitimately use FAST and are excluded by name.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WORKER_SRC = join(import.meta.dirname, '..', 'worker', 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const FILES = sourceFiles(WORKER_SRC).map((f) => ({ path: f, text: readFileSync(f, 'utf8') }));

/** Phrases that only ever appeared in the pre-recalibration rubric. */
const STALE_RUBRIC_PHRASES = [
  'take the LOWER',
  'ALWAYS take the lower',
  'almost never award',
  'do not award any dimension above',
  'Assume this video will flop',
  'a wrong HIGH score is more expensive than a wrong low one',
  'a wrong HIGH score is far more expensive',
];

for (const phrase of STALE_RUBRIC_PHRASES) {
  test(`no stale rubric phrase anywhere in worker/src: "${phrase}"`, () => {
    const offenders = FILES.filter((f) => f.text.includes(phrase)).map((f) => f.path);
    assert.deepEqual(
      offenders, [],
      `pre-recalibration rubric language found in: ${offenders.join(', ')}`,
    );
  });
}

test('every path that scores virality stamps rubricVersion', () => {
  // An unstamped score is indistinguishable from a pre-2026-08-28 one, which makes the
  // rescore endpoint's idempotency filter act on wrong information.
  // The producing sites are those that VALIDATE a scorecard coming back from the model.
  // Deliberately not "any file that persists a score": db.ts writes whatever it is handed
  // and never produces one, so stamping there would be wrong — it would stamp scores that
  // came from anywhere, including old ones being re-saved.
  const scorers = FILES.filter((f) => /ViralityScorecardSchema\.safeParse/.test(f.text));
  assert.ok(scorers.length > 0, 'expected to find at least one scorecard-producing path');
  for (const f of scorers) {
    assert.ok(
      f.text.includes('RUBRIC_VERSION'),
      `${f.path} persists a virality score without stamping RUBRIC_VERSION`,
    );
  }
});

test('no JUDGEMENT call is left on the FAST model', () => {
  // FAST is correct for mechanical perception over video and wrong for scoring. Any file
  // that carries a scoring instruction must not reach for GEMINI_MODEL_FAST.
  for (const f of FILES) {
    const isScoringFile = /VIRALITY_SYSTEM_INSTRUCTION|the brutal scorecard|the honest scorecard/.test(f.text);
    if (!isScoringFile) continue;
    // Mentions inside comments explaining the split are fine; an actual `model:` line is not.
    const badModelLine = f.text
      .split('\n')
      .find((l) => /^\s*model:\s*env\.GEMINI_MODEL_FAST/.test(l));
    assert.equal(
      badModelLine, undefined,
      `${f.path} scores on the FAST model: ${badModelLine?.trim()}`,
    );
  }
});

test('the canonical rubric lives in exactly one place', () => {
  // VIRALITY_SYSTEM_INSTRUCTION is the single source of truth; anything else scoring should
  // import it rather than paraphrase it. admin.ts is the known exception (it does a combined
  // classify+score call) and is kept aligned by the stale-phrase tests above.
  const defs = FILES.filter((f) => /export const VIRALITY_SYSTEM_INSTRUCTION/.test(f.text));
  assert.equal(defs.length, 1, `rubric defined in ${defs.length} places: ${defs.map((f) => f.path).join(', ')}`);
});
