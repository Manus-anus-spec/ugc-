/**
 * Phase 3 feedback loop — the fitness prior on the surprise-me sampler.
 *
 * Acceptance criterion from the brief (§P1.1): "a thumbs-down on a run measurably lowers
 * its source formats' draw weight on the next surprise call, proven by a unit test with a
 * seeded RNG. Never let fitness hard-exclude a format — soft weighting only."
 *
 * Both halves are asserted here: the measurable drop, AND that it stays soft. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fitness, FITNESS_BETA, sampleSurpriseSources, type SurpriseCandidate,
} from '../worker/src/generate/surprise';

/** The same tiny LCG the compiler tests use — deterministic, so draw counts are exact. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Draw n sources `trials` times and count how often each id appears. */
function drawCounts(
  candidates: SurpriseCandidate[], trials: number, seed = 42, n = 3,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < trials; i++) {
    for (const id of sampleSurpriseSources(candidates, n, new Set(), lcg(seed + i))) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

// ─────────────────────────────────────────────────────────────
// fitness() — the Beta-smoothed prior itself
// ─────────────────────────────────────────────────────────────

test('fitness of a never-judged format is exactly neutral (0.5)', () => {
  // Critical: 82% of the library has never been used. Unjudged must not mean punished.
  assert.equal(fitness(), 0.5);
  assert.equal(fitness(0, 0), 0.5);
});

test('fitness rises with ups and falls with downs', () => {
  assert.ok(fitness(5, 0) > fitness(0, 0));
  assert.ok(fitness(0, 5) < fitness(0, 0));
  assert.ok(fitness(10, 1) > fitness(1, 1));
});

test('fitness matches the specified formula (ups + β) / (ups + downs + 2β), β = 2', () => {
  assert.equal(FITNESS_BETA, 2);
  assert.equal(fitness(3, 1), (3 + 2) / (3 + 1 + 4));
  assert.equal(fitness(0, 1), 2 / 5);   // one thumbs-down → 0.4, not 0
});

test('β smoothing stops a single thumbs-down from cratering a format', () => {
  // The whole point of the pseudo-count: n=1 is not evidence. 0.4 is a nudge, not a verdict.
  assert.ok(fitness(0, 1) > 0.35, `one down gave ${fitness(0, 1)}`);
});

test('fitness is bounded strictly above 0 — it can NEVER hard-exclude a format', () => {
  // Soft weighting only. Even absurd sustained rejection leaves the format drawable.
  assert.ok(fitness(0, 1000) > 0, 'fitness hit zero — that is a hard exclusion');
  assert.equal(fitness(0, 1000), 2 / 1004);
});

test('fitness is bounded below 1 — a loved format never becomes the only choice', () => {
  assert.ok(fitness(1000, 0) < 1);
});

test('fitness clamps negative counts rather than producing nonsense', () => {
  assert.equal(fitness(-5, -5), 0.5);
});

// ─────────────────────────────────────────────────────────────
// THE ACCEPTANCE TEST — a thumbs-down measurably lowers the draw weight
// ─────────────────────────────────────────────────────────────

/** Four equal-scoring formats of distinct archetypes, so score and archetype spread are
 *  controlled for and the ONLY difference between runs is the feedback. */
const EVEN_LIBRARY: SurpriseCandidate[] = [
  { id: 'fmt-a', formatType: 'skit', score: 70 },
  { id: 'fmt-b', formatType: 'pov', score: 70 },
  { id: 'fmt-c', formatType: 'vlog_moment', score: 70 },
  { id: 'fmt-d', formatType: 'reaction', score: 70 },
];

test('ACCEPTANCE: a thumbs-down measurably lowers that format’s draw rate (seeded RNG)', () => {
  const before = drawCounts(EVEN_LIBRARY, 400);
  const after = drawCounts(
    EVEN_LIBRARY.map((c) => (c.id === 'fmt-a' ? { ...c, ups: 0, downs: 6 } : c)),
    400,
  );
  const b = before.get('fmt-a') ?? 0;
  const a = after.get('fmt-a') ?? 0;
  assert.ok(a < b, `fmt-a drew ${a} after 6 downs vs ${b} before — expected a drop`);
  // Not just noise: 6 downs is fitness 0.2 vs 0.5, so the drop should be substantial.
  assert.ok(a < b * 0.85, `drop too small to be meaningful: ${b} → ${a}`);
});

test('ACCEPTANCE: thumbs-UP raises that format’s draw rate (seeded RNG)', () => {
  const before = drawCounts(EVEN_LIBRARY, 400);
  const after = drawCounts(
    EVEN_LIBRARY.map((c) => (c.id === 'fmt-a' ? { ...c, ups: 8, downs: 0 } : c)),
    400,
  );
  assert.ok((after.get('fmt-a') ?? 0) > (before.get('fmt-a') ?? 0));
});

test('SOFT: a heavily down-voted format is still drawn sometimes, never excluded', () => {
  // The library is the asset — a format the operator dislikes fades, it does not vanish.
  const counts = drawCounts(
    EVEN_LIBRARY.map((c) => (c.id === 'fmt-a' ? { ...c, ups: 0, downs: 500 } : c)),
    600,
  );
  assert.ok((counts.get('fmt-a') ?? 0) > 0, 'fmt-a was hard-excluded by feedback — not allowed');
});

test('the prior does not disturb relative odds when nothing has been judged', () => {
  // Every unjudged candidate gets fitness 0.5, which rescales all weights by the same
  // constant — so introducing the prior must leave an unjudged library's draws IDENTICAL.
  const withPrior = drawCounts(EVEN_LIBRARY, 200);
  const asIfNoPrior = drawCounts(EVEN_LIBRARY.map((c) => ({ ...c, ups: 3, downs: 3 })), 200);
  assert.deepEqual([...withPrior.entries()].sort(), [...asIfNoPrior.entries()].sort());
});

test('a down-voted HIGH scorer can still outdraw an unjudged LOW scorer (score still leads)', () => {
  // Feedback nudges; it does not override quality. 90² × 0.2 > 40² × 0.5.
  const counts = drawCounts([
    { id: 'high-down', formatType: 'skit', score: 90, ups: 0, downs: 6 },
    { id: 'low-fresh', formatType: 'skit', score: 40 },
  ], 400, 7, 1);
  assert.ok(
    (counts.get('high-down') ?? 0) > (counts.get('low-fresh') ?? 0),
    'a single bad review should not sink a strong format below a weak one',
  );
});

test('feedback still respects the persona lane bias (off-menu stays off the anchor)', () => {
  // The two soft weights compose; neither is allowed to cancel the other out.
  const menu = new Set(['skit']);
  for (let i = 0; i < 50; i++) {
    const ids = sampleSurpriseSources([
      { id: 'on-menu', formatType: 'skit', score: 60, ups: 0, downs: 4 },
      { id: 'off-menu', formatType: 'thirst_trap', score: 95, ups: 10, downs: 0 },
    ], 2, new Set(), lcg(500 + i), menu);
    assert.equal(ids[0], 'on-menu', 'anchor must stay in the persona lane regardless of feedback');
  }
});

test('unchanged behaviour: sampler is still deterministic for a given seed', () => {
  const a = sampleSurpriseSources(EVEN_LIBRARY, 3, new Set(), lcg(1234));
  const b = sampleSurpriseSources(EVEN_LIBRARY, 3, new Set(), lcg(1234));
  assert.deepEqual(a, b);
});
