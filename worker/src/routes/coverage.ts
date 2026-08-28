/**
 * GET /admin/synthesis-coverage — how much of the brain is actually being used.
 *
 * Phase 4 (brief §P1.2). Measured on 2026-08-28: 31 of 169 formats had EVER been fused —
 * 82% of the library was dead weight. The Aug 17 sampler fix genuinely worked (3/40 = 7.5%
 * → 31/169 = 18%) but the library grew faster than exploration did, so the ratio needs to
 * be watchable rather than rediscovered by hand every few weeks.
 *
 * Pure SQL aggregation — no Gemini call, no cost, safe to poll.
 */
import type { Env } from '../env';
import { json } from '../http';
import { explorationBonus, EXPLORATION_BONUS_MAX } from '../generate/surprise';

/** A format is "used" if it was ever a fusion source OR the subject of a run. Counting only
 *  sourceFormatIds (as the original 18% measurement did) understates real usage, because
 *  every reproduce/adapt run reaches its format through format_id instead. Both are
 *  reported so the 18% baseline stays comparable. */
const USAGE_SQL = `
  WITH used AS (
    SELECT j.value AS format_id, 'fused' AS how
      FROM generations g, json_each(json_extract(g.output, '$.sourceFormatIds')) j
    UNION ALL
    SELECT g.format_id AS format_id, 'subject' AS how
      FROM generations g
     WHERE json_extract(g.output, '$.sourceFormatIds') IS NULL
  )
  SELECT f.id,
         f.title,
         f.format_type,
         f.virality_score,
         SUM(CASE WHEN u.how = 'fused'   THEN 1 ELSE 0 END) AS times_fused,
         SUM(CASE WHEN u.how = 'subject' THEN 1 ELSE 0 END) AS times_subject
    FROM formats f
    LEFT JOIN used u ON u.format_id = f.id
   WHERE f.schema_version != '0-legacy'
   GROUP BY f.id
   ORDER BY (times_fused + times_subject) ASC, f.virality_score DESC
`;

type UsageRow = {
  id: string; title: string; format_type: string | null; virality_score: number | null;
  times_fused: number; times_subject: number;
};

export async function synthesisCoverage(req: Request, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(USAGE_SQL).all<UsageRow>();

  const total = results.length;
  const everFused = results.filter((r) => r.times_fused > 0).length;
  const everUsed = results.filter((r) => r.times_fused + r.times_subject > 0).length;

  // Per-archetype coverage: which whole categories of the brain are being ignored. The
  // library is 39% thirst_trap (avg virality 50) while skit (62) and pov (61) are only 25%
  // combined, so per-archetype numbers are what actually drive the ingestion decision.
  const byArchetype = new Map<string, { total: number; fused: number; used: number; scoreSum: number; scored: number }>();
  for (const r of results) {
    const key = r.format_type ?? 'unclassified';
    const a = byArchetype.get(key) ?? { total: 0, fused: 0, used: 0, scoreSum: 0, scored: 0 };
    a.total += 1;
    if (r.times_fused > 0) a.fused += 1;
    if (r.times_fused + r.times_subject > 0) a.used += 1;
    if (r.virality_score !== null) { a.scoreSum += r.virality_score; a.scored += 1; }
    byArchetype.set(key, a);
  }

  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

  const neverUsed = results.filter((r) => r.times_fused + r.times_subject === 0);

  return json({
    measuredAt: new Date().toISOString(),
    totals: {
      formats: total,
      everFused,
      everUsed,
      neverUsed: neverUsed.length,
      fusedPct: pct(everFused, total),
      usedPct: pct(everUsed, total),
      // The number to beat, recorded so a future reader knows which direction is progress.
      baseline: { measuredOn: '2026-08-28', everFused: 31, formats: 169, fusedPct: 18.3 },
    },
    exploration: {
      // What the sampler is currently doing about the tail (see explorationBonus).
      bonusMax: EXPLORATION_BONUS_MAX,
      neverUsedWeightMultiplier: explorationBonus(0, 0),
      note: 'Applied as a bounded multiplier on a never-drawn format\'s weight; decays to 1.0 once used.',
    },
    byArchetype: [...byArchetype.entries()]
      .map(([formatType, a]) => ({
        formatType,
        formats: a.total,
        everFused: a.fused,
        everUsed: a.used,
        fusedPct: pct(a.fused, a.total),
        avgVirality: a.scored === 0 ? null : Math.round((a.scoreSum / a.scored) * 10) / 10,
      }))
      .sort((x, y) => y.formats - x.formats),
    // The actionable list: highest-scoring untouched formats first, so the operator can see
    // what good material is sitting unused. Capped — the full list can be 138 rows.
    neverUsedTop: neverUsed
      .slice()
      .sort((a, b) => (b.virality_score ?? 0) - (a.virality_score ?? 0))
      .slice(0, 40)
      .map((r) => ({
        id: r.id, title: r.title, formatType: r.format_type, viralityScore: r.virality_score,
      })),
    mostUsed: results
      .slice()
      .sort((a, b) => (b.times_fused + b.times_subject) - (a.times_fused + a.times_subject))
      .slice(0, 15)
      .map((r) => ({
        id: r.id, title: r.title, formatType: r.format_type,
        timesFused: r.times_fused, timesSubject: r.times_subject,
      })),
  }, 200, req, env);
}
