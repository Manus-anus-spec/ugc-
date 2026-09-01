/**
 * Phase 4 — the bounded exploration bonus (brief §P1.2).
 *
 * The problem in one number: on 2026-08-28 only 31 of 169 formats had EVER been fused.
 * score²-weighting alone cannot reach the tail — a 45-scoring format is ~4× less likely per
 * draw than a 90-scoring one, so low-scoring material never gets sampled and never gets a
 * chance to prove itself. 82% of the library was inert.
 *
 * The bonus has to thread a needle: lift the untouched tail enough that it actually gets
 * drawn, WITHOUT inverting into "now we fuse the library's worst material". Both directions
 * are asserted here. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  explorationBonus, EXPLORATION_BONUS_MAX, fitness, sampleSurpriseSources,
  type SurpriseCandidate,
} from '../worker/src/generate/surprise';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Draw n sources `trials` times and count how often each id appears.
 *
 *  ONE rng for the whole loop, deliberately. Re-seeding per trial with lcg(seed + i) looks
 *  more deterministic but is statistically broken: an LCG's FIRST output moves by only
 *  1664525/2³² ≈ 0.0004 per seed step, so 400 consecutive seeds sample a ~0.15-wide slice
 *  of [0,1) instead of the whole range — which silently skews every draw. Consuming one
 *  stream is still fully deterministic for a given seed. */
function drawCounts(
  candidates: SurpriseCandidate[], trials: number, seed = 42, n = 3,
): Map<string, number> {
  const rand = lcg(seed);
  const counts = new Map<string, number>();
  for (let i = 0; i < trials; i++) {
    for (const id of sampleSurpriseSources(candidates, n, new Set(), rand)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

// ── the bonus function itself ──

test('explorationBonus is maximal for a never-used format and decays to 1', () => {
  assert.equal(explorationBonus(0, 0), EXPLORATION_BONUS_MAX);
  assert.equal(explorationBonus(), EXPLORATION_BONUS_MAX);
  assert.ok(explorationBonus(1, 0) < EXPLORATION_BONUS_MAX);
  assert.ok(explorationBonus(1, 0) > 1);
  assert.equal(explorationBonus(2, 0), 1, 'after two uses a format has had its shot');
  assert.equal(explorationBonus(0, 5), 1);
});

test('explorationBonus counts BOTH ways a format gets used', () => {
  // Fused as a synthesis source, or the subject of a reproduce/adapt run.
  assert.equal(explorationBonus(1, 1), 1);
  assert.equal(explorationBonus(0, 1), explorationBonus(1, 0));
});

test('explorationBonus is bounded — it cannot swamp the score term', () => {
  assert.ok(EXPLORATION_BONUS_MAX <= 3, `bonus ${EXPLORATION_BONUS_MAX} is too aggressive`);
});

test('explorationBonus clamps negative counts', () => {
  assert.equal(explorationBonus(-3, -3), EXPLORATION_BONUS_MAX);
});

// ── behaviour in the real sampler, seeded ──

test('ACCEPTANCE: a never-used format is measurably more likely to be drawn', () => {
  const counts = drawCounts([
    { id: 'used', formatType: 'skit', score: 70, timesFused: 4 },
    { id: 'untouched', formatType: 'skit', score: 70, timesFused: 0 },
  ], 400, 11, 1);
  assert.ok(
    (counts.get('untouched') ?? 0) > (counts.get('used') ?? 0),
    `untouched ${counts.get('untouched')} vs used ${counts.get('used')} — the tail must get a look`,
  );
});

test('exploration does NOT let a WEAK untouched format outdraw a STRONG proven one', () => {
  // 90² × 1.0 = 8100 vs 40² × 2.5 = 4000. The bonus buys a look, not a promotion. This is
  // the guard against exploration inverting library quality.
  const counts = drawCounts([
    { id: 'strong-used', formatType: 'skit', score: 90, timesFused: 5 },
    { id: 'weak-untouched', formatType: 'skit', score: 40, timesFused: 0 },
  ], 400, 13, 1);
  assert.ok(
    (counts.get('strong-used') ?? 0) > (counts.get('weak-untouched') ?? 0),
    'the exploration bonus must not promote weak material over proven material',
  );
});

test('exploration DOES lift a mid-scoring untouched format past a proven one (intended reach)', () => {
  // 57² × 2.5 ≈ 8123 vs 62² × 1.0 = 3844 — exactly the case the bonus exists for: decent
  // material that score²-weighting alone would never surface.
  const counts = drawCounts([
    { id: 'proven-mid', formatType: 'skit', score: 62, timesFused: 3 },
    { id: 'untouched-mid', formatType: 'skit', score: 57, timesFused: 0 },
  ], 400, 17, 1);
  assert.ok((counts.get('untouched-mid') ?? 0) > (counts.get('proven-mid') ?? 0));
});

test('exploration and fitness compose — a downvoted untouched format is lifted, but less', () => {
  const clean = explorationBonus(0, 0) * fitness(0, 0);
  const downed = explorationBonus(0, 0) * fitness(0, 4);
  assert.ok(downed < clean, 'a bad record must still cost something');
  assert.ok(downed > fitness(0, 4), 'but exploration should still be helping it');
});

test('exploration respects the persona lane — untouched off-menu never takes the anchor', () => {
  const menu = new Set(['skit']);
  for (let i = 0; i < 50; i++) {
    const ids = sampleSurpriseSources([
      { id: 'on-menu-used', formatType: 'skit', score: 60, timesFused: 9 },
      { id: 'off-menu-fresh', formatType: 'thirst_trap', score: 95, timesFused: 0 },
    ], 2, new Set(), lcg(900 + i), menu);
    assert.equal(ids[0], 'on-menu-used', 'anchor must stay in the persona lane');
  }
});

test('an all-untouched library behaves exactly as before the bonus existed', () => {
  // Every candidate getting the same multiplier must not perturb relative odds — otherwise
  // the bonus would have silently changed behaviour for a fresh library.
  const lib: SurpriseCandidate[] = [
    { id: 'a', formatType: 'skit', score: 70 },
    { id: 'b', formatType: 'pov', score: 70 },
    { id: 'c', formatType: 'vlog_moment', score: 70 },
  ];
  const untouched = drawCounts(lib, 200);
  const allUsedTwice = drawCounts(lib.map((c) => ({ ...c, timesFused: 2 })), 200);
  assert.deepEqual([...untouched.entries()].sort(), [...allUsedTwice.entries()].sort());
});
