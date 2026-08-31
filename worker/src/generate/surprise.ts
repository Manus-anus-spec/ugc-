/**
 * §10 "surprise me" source sampling — pure logic, unit-tested in scripts/compiler-tests.ts.
 *
 * Rewritten 2026-08-17 (FABLE5-BRIEF-surprise-me-synthesis): the old selection was
 * `ORDER BY virality_score DESC` + greedy archetype dedupe — fully deterministic, so
 * every press fused the IDENTICAL 3 blueprints for every profile ("always feral"), and
 * the other ~37 formats in the library were dead weight. This replaces "always the top 3"
 * with a fresh score-WEIGHTED random draw on every press:
 *  - weight = score² → quality still biases the draw, but the COMBINATION changes every press
 *  - archetype spread kept: prefer an unseen format_type per pick (fuse different
 *    mechanisms, not near-duplicates); repeats only when archetypes run out
 *  - don't-repeat memory: callers pass the ids used by the profile's recent surprise
 *    runs as excludeIds — dropped from the pool unless that would starve the fusion
 *  - anchor rotation: the result is shuffled, because dnas[0] is the aesthetic anchor
 *    downstream and must not always be the highest-scoring pick
 */

export type SurpriseCandidate = {
  id: string;
  formatType: string | null;
  score: number;
  /** Operator feedback counts for this format (Phase 3). Absent = never judged. */
  ups?: number;
  downs?: number;
  /** Usage counts (Phase 4) driving the exploration bonus. Absent = never used. */
  timesFused?: number;
  timesSubject?: number;
  /** 0-100 buildability by a single AI character (2026-08-31). Absent = not yet assessed. */
  aiFeasibility?: number;
};

/** Laplace/Beta-smoothed success rate — the fusion-quality prior (Phase 3, brief §P1.1).
 *
 *  fitness(F) = (ups + β) / (ups + downs + 2β), β ≈ 2
 *
 *  β is a pseudo-count of 2 imaginary ups and 2 imaginary downs, which does the work here:
 *  an unjudged format sits at exactly 0.5 (neutral, so the 82% of the library that has
 *  never been used is not punished for it), and a single thumbs-down cannot crater a
 *  format on one data point — 0/1 gives 0.4, not 0. It takes sustained rejection to fall
 *  far, which is the correct behaviour when n is tiny.
 *
 *  SOFT WEIGHTING ONLY. The result is bounded strictly above 0 (a format with 0 ups and
 *  1000 downs still returns 2/1004), so fitness can never hard-exclude a format from the
 *  draw — consistent with the existing off-menu ×0.08 approach. A format the operator
 *  hates fades; it never disappears, because the library is the asset.
 */
export const FITNESS_BETA = 2;

export function fitness(ups = 0, downs = 0, beta: number = FITNESS_BETA): number {
  const u = Math.max(0, ups);
  const d = Math.max(0, downs);
  return (u + beta) / (u + d + 2 * beta);
}

/** Exploration bonus for the untouched tail (Phase 4, brief §P1.2).
 *
 *  Measured 2026-08-28: only 31 of 169 formats had ever been fused. score²-weighting alone
 *  cannot fix that — a 45-scoring format is ~4× less likely per draw than a 90-scoring one,
 *  so the low-scoring tail never gets sampled and never gets a chance to prove itself. The
 *  library is the asset and 82% of it was inert.
 *
 *  So a format that has NEVER been drawn gets a bounded multiplier, decaying to 1.0 as soon
 *  as it has been used:
 *      timesUsed 0 → ×EXPLORATION_BONUS_MAX
 *      timesUsed 1 → halfway back
 *      timesUsed ≥2 → ×1.0 (no bonus; it has had its shot)
 *
 *  BOUNDED ON PURPOSE. At ×2.5 the bonus is worth roughly the difference between a 57- and
 *  a 90-scoring format (90²/57² ≈ 2.5), so an untouched format competes with the top of the
 *  library WITHOUT displacing it — quality still leads. An unbounded or score-ignoring
 *  bonus would just invert the problem and start fusing the library's worst material.
 */
export const EXPLORATION_BONUS_MAX = 2.5;

/** Down-weight formats we cannot physically build (2026-08-31).
 *
 *  THE PROBLEM THIS SOLVES: the sampler weights by score², so a 62-scoring street prank that
 *  needs a prankster, an unwitting stranger and a public location BEATS a 55-scoring format
 *  we could actually shoot. A high score on an unbuildable format does not merely waste
 *  attention, it outcompetes buildable material. That is the same class of error as a
 *  miscalibrated score.
 *
 *  ABSENT = 1.0 (fully neutral), which matters: all 169 stored formats predate the
 *  assessment, and they must not be penalised for a field nobody has filled in yet. Only a
 *  format that has been ASSESSED and found hard to build is down-weighted.
 *
 *  SOFT, like every other weight here. Floors at 0.25 rather than 0 — a format we cannot
 *  build today may still be worth fusing a MECHANISM out of, and viralMechanics
 *  .production.singleCharacterRewrite exists precisely to salvage those. Never hard-exclude. */
export const FEASIBILITY_FLOOR = 0.25;

export function feasibilityWeight(aiFeasibility?: number): number {
  if (typeof aiFeasibility !== 'number' || Number.isNaN(aiFeasibility)) return 1;
  const pct = Math.min(100, Math.max(0, aiFeasibility)) / 100;
  return FEASIBILITY_FLOOR + (1 - FEASIBILITY_FLOOR) * pct;
}

export function explorationBonus(timesFused = 0, timesSubject = 0): number {
  const used = Math.max(0, timesFused) + Math.max(0, timesSubject);
  if (used === 0) return EXPLORATION_BONUS_MAX;
  if (used === 1) return 1 + (EXPLORATION_BONUS_MAX - 1) / 2;
  return 1;
}

/** Persona lane bias (Content Persona Framework, 2026-08-17): when the profile has a
 *  contentPersona.formatMenu, off-menu archetypes are down-weighted ×0.15 — they can
 *  still contribute a MECHANISM to a fusion occasionally (mechanisms are theme-neutral;
 *  the Theme Governor reshapes the surface), but they rarely enter the draw and NEVER
 *  take the anchor slot (dnas[0], the aesthetic spine) while an on-menu pick exists. */
const OFF_MENU_WEIGHT = 0.08;

export function sampleSurpriseSources(
  candidates: SurpriseCandidate[],
  n: number,
  excludeIds: ReadonlySet<string> = new Set(),
  rand: () => number = Math.random,
  menu?: ReadonlySet<string>,
): string[] {
  // Don't-repeat memory — but never at the cost of having too few sources to fuse.
  const fresh = candidates.filter((c) => !excludeIds.has(c.id));
  let pool = (fresh.length >= Math.max(2, n) ? fresh : candidates).slice();

  const laneBias = (c: SurpriseCandidate) =>
    menu && menu.size > 0 ? (menu.has(c.formatType ?? '?') ? 1 : OFF_MENU_WEIGHT) : 1;
  // score² × fitness × exploration × laneBias.
  //
  // Phase 3 (fitness): quality still leads the draw; the feedback prior nudges it. An
  // unjudged format scores fitness 0.5, so introducing the prior rescales every weight
  // uniformly and — on its own — changes NO relative probability; only actual thumbs move
  // a format relative to its peers.
  //
  // Phase 4 (exploration): a never-drawn format gets a bounded lift so the 82% tail can
  // enter the draw at all. Ordering matters conceptually — exploration decides who gets a
  // FIRST look, fitness decides who keeps getting looks. A brand-new format is boosted;
  // once it has been used twice its bonus is gone and only its record speaks for it.
  // 2026-08-31 (feasibility): buildability is the last multiplier because it is a VETO-ish
  // signal rather than a preference — a format we cannot shoot should fade regardless of how
  // well it scores, how loved it is, or how fresh it is.
  const weight = (c: SurpriseCandidate) =>
    Math.max(1, c.score) ** 2
    * fitness(c.ups, c.downs)
    * explorationBonus(c.timesFused, c.timesSubject)
    * feasibilityWeight(c.aiFeasibility)
    * laneBias(c);
  const picked: SurpriseCandidate[] = [];
  const seenType = new Set<string>();
  while (picked.length < n && pool.length > 0) {
    // Archetype spread: prefer candidates with an unseen format_type. LANE BIAS OUTRANKS
    // SPREAD — with a menu, in-menu candidates stay eligible even when their archetype is
    // already represented (a second skit beats a forced thirst_trap once the menu's
    // archetypes are exhausted); off-menu candidates still leak in via their 0.08 weight.
    const unseen = pool.filter((c) => !seenType.has(c.formatType ?? '?'));
    const inMenu = menu && menu.size > 0 ? pool.filter((c) => menu.has(c.formatType ?? '?')) : [];
    const merged = [...new Set([...unseen, ...inMenu])];
    const cands = merged.length > 0 ? merged : pool;
    const total = cands.reduce((s, c) => s + weight(c), 0);
    let roll = rand() * total;
    let chosen = cands[cands.length - 1]!;
    for (const c of cands) {
      roll -= weight(c);
      if (roll <= 0) { chosen = c; break; }
    }
    picked.push(chosen);
    seenType.add(chosen.formatType ?? '?');
    pool = pool.filter((c) => c !== chosen);
  }

  // Anchor rotation: shuffle so picked[0] (→ dnas[0], the aesthetic anchor) varies.
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [picked[i], picked[j]] = [picked[j]!, picked[i]!];
  }
  // Anchor lane guarantee: an off-menu format must never be the spine while an on-menu
  // pick exists — swap the first on-menu pick into slot 0 (a wholesome-theme model can
  // borrow a thirst_trap MECHANISM, but the anchor stays in her lane).
  if (menu && menu.size > 0 && picked.length > 0 && !menu.has(picked[0]!.formatType ?? '?')) {
    const k = picked.findIndex((c) => menu.has(c.formatType ?? '?'));
    if (k > 0) [picked[0], picked[k]] = [picked[k]!, picked[0]!];
  }
  return picked.map((c) => c.id);
}
