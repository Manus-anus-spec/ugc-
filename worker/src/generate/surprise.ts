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

export type SurpriseCandidate = { id: string; formatType: string | null; score: number };

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
  const weight = (c: SurpriseCandidate) => Math.max(1, c.score) ** 2 * laneBias(c);
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
