/**
 * GET /admin/library-insights — what the library ALREADY knows about hooks, retention
 * and payoff, mined from the 169 analysed formats.
 *
 * WHY THIS EXISTS. Ideation quality is bounded by how well we understand what actually
 * works, and every analysis already stores a hook mechanism, a payoff timestamp, a cut
 * cadence, named retention drivers and six calibrated virality dimensions — but nothing
 * ever read them back in aggregate. So the app has been sitting on a research corpus and
 * using it one row at a time. This turns it into the evidence base: which hook TYPES
 * actually score, WHEN the payoff lands in winners vs losers, what cadence correlates with
 * retention, and which retention drivers recur in the top quartile but not the bottom.
 *
 * COST: zero. No Gemini call — this is pure aggregation over data already paid for.
 *
 * CPU BUDGET: the aggregation runs in SQLite via json_extract/json_each, NOT by parsing
 * 169 DNA blobs in JS. That is deliberate — the free plan allows ~10ms CPU per invocation
 * (see the header of routes/generate.ts, where exactly that limit killed a paid run), and
 * JSON.parse over several MB of stored DNA would blow it. SQLite does the parsing in C and
 * hands back a few hundred small rows; the JS here only does arithmetic over numbers.
 */
import type { Env } from '../env';
import { json } from '../http';

/** One row per scored format, all heavy field access done by SQLite. */
const FACTS_SQL = `
  SELECT f.id,
         f.title,
         f.format_type,
         f.virality_score                                        AS overall,
         json_extract(f.dna, '$.hook.type')                      AS hook_type,
         json_extract(f.dna, '$.pacing.payoffSec')               AS payoff_sec,
         json_extract(f.dna, '$.pacing.cutCadenceSec')            AS cut_cadence,
         json_extract(f.dna, '$.pacing.isOneShot')                AS one_shot,
         json_extract(f.dna, '$.pacing.totalDurationSec')         AS duration_sec,
         json_extract(f.dna, '$.virality.dimensions.hook.score')       AS dim_hook,
         json_extract(f.dna, '$.virality.dimensions.retention.score')  AS dim_retention,
         json_extract(f.dna, '$.virality.dimensions.emotion.score')    AS dim_emotion,
         json_extract(f.dna, '$.virality.dimensions.share.score')      AS dim_share,
         json_extract(f.dna, '$.virality.dimensions.replay.score')     AS dim_replay,
         json_extract(f.dna, '$.virality.dimensions.algo.score')       AS dim_algo
    FROM formats f
   WHERE f.schema_version != '0-legacy' AND f.virality_score IS NOT NULL
`;

/** Text arrays worth counting, one query each: value → how often, and the avg score of the
 *  formats it appears on. `json_each` keeps the array walk in C. */
const arraySql = (path: string) => `
  SELECT j.value AS value,
         COUNT(*) AS n,
         AVG(f.virality_score) AS avg_score
    FROM formats f, json_each(json_extract(f.dna, '${path}')) j
   WHERE f.schema_version != '0-legacy' AND f.virality_score IS NOT NULL
   GROUP BY LOWER(TRIM(j.value))
   HAVING COUNT(*) >= 2
   ORDER BY n DESC
   LIMIT 25
`;

type Fact = {
  id: string; title: string; format_type: string | null; overall: number;
  hook_type: string | null; payoff_sec: number | null; cut_cadence: number | null;
  one_shot: number | null; duration_sec: number | null;
  dim_hook: number | null; dim_retention: number | null; dim_emotion: number | null;
  dim_share: number | null; dim_replay: number | null; dim_algo: number | null;
};
type ArrayRow = { value: string; n: number; avg_score: number };

const round = (n: number, dp = 1): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};
const mean = (xs: number[]): number | null => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Pearson r between two equal-length series. Reported so a weak signal reads as weak —
 *  n is small (≈169 and much less per bucket), so these are directional, not conclusive. */
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 8) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
    }
  if (dx === 0 || dy === 0) return null;
  return round(num / Math.sqrt(dx * dy), 3);
}

/** Bucket a numeric field and report the avg score per bucket — the shape that answers
 *  "when should the payoff land?" far better than a single correlation number. */
function buckets(
  facts: Fact[], pick: (f: Fact) => number | null, edges: number[], label: (lo: number, hi: number) => string,
): { bucket: string; formats: number; avgScore: number | null }[] {
  const out: { bucket: string; formats: number; avgScore: number | null }[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!, hi = edges[i + 1]!;
    const inBucket = facts.filter((f) => {
      const v = pick(f);
      return v !== null && v >= lo && v < hi;
    });
    out.push({
      bucket: label(lo, hi),
      formats: inBucket.length,
      avgScore: mean(inBucket.map((f) => f.overall)),
    });
  }
  return out;
}

export async function libraryInsights(req: Request, env: Env): Promise<Response> {
  const { results: facts } = await env.DB.prepare(FACTS_SQL).all<Fact>();
  const [drivers, strengths, weaknesses] = await Promise.all([
    env.DB.prepare(arraySql('$.whyItWorks.retentionDrivers')).all<ArrayRow>(),
    env.DB.prepare(arraySql('$.virality.strengths')).all<ArrayRow>(),
    env.DB.prepare(arraySql('$.virality.weaknesses')).all<ArrayRow>(),
  ]);

  const scored = facts.filter((f) => typeof f.overall === 'number');
  const sorted = scored.slice().sort((a, b) => b.overall - a.overall);
  const q = Math.max(1, Math.floor(sorted.length / 4));
  const topQuartile = sorted.slice(0, q);
  const bottomQuartile = sorted.slice(-q);

  // ── HOOK: which opening mechanism actually earns the thumb-stop? ──
  const byHookType = new Map<string, Fact[]>();
  for (const f of scored) {
    const k = f.hook_type ?? 'unclassified';
    byHookType.set(k, [...(byHookType.get(k) ?? []), f]);
  }

  // ── which dimension moves the overall score most? ──
  const dims = ['hook', 'retention', 'emotion', 'share', 'replay', 'algo'] as const;
  const dimKey = { hook: 'dim_hook', retention: 'dim_retention', emotion: 'dim_emotion',
    share: 'dim_share', replay: 'dim_replay', algo: 'dim_algo' } as const;

  const dimensionAnalysis = dims.map((d) => {
    const pairs = scored
      .map((f) => [f[dimKey[d]], f.overall] as const)
      .filter((p): p is readonly [number, number] => typeof p[0] === 'number');
    return {
      dimension: d,
      scoredFormats: pairs.length,
      avg: mean(pairs.map((p) => p[0])),
      avgInTopQuartile: mean(topQuartile.map((f) => f[dimKey[d]]).filter((v): v is number => typeof v === 'number')),
      avgInBottomQuartile: mean(bottomQuartile.map((f) => f[dimKey[d]]).filter((v): v is number => typeof v === 'number')),
      correlationWithOverall: pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1])),
    };
  }).sort((a, b) => (b.correlationWithOverall ?? -2) - (a.correlationWithOverall ?? -2));

  const inTop = new Set(topQuartile.map((f) => f.id));

  return json({
    measuredAt: new Date().toISOString(),
    corpus: {
      scoredFormats: scored.length,
      quartileSize: q,
      medianScore: sorted.length ? sorted[Math.floor(sorted.length / 2)]!.overall : null,
      topQuartileMinScore: topQuartile.length ? topQuartile[topQuartile.length - 1]!.overall : null,
      bottomQuartileMaxScore: bottomQuartile.length ? bottomQuartile[0]!.overall : null,
      caveat: 'Scores are this app\'s own Gemini scorecard, not platform analytics. Treat as a consistent internal yardstick, not ground-truth performance.',
    },

    // WHICH LEVER MATTERS MOST — ranked by correlation with the overall score.
    dimensionAnalysis,

    hook: {
      byType: [...byHookType.entries()]
        .map(([hookType, fs]) => ({
          hookType,
          formats: fs.length,
          avgScore: mean(fs.map((f) => f.overall)),
          avgHookDimension: mean(fs.map((f) => f.dim_hook).filter((v): v is number => typeof v === 'number')),
          shareOfTopQuartile: round((fs.filter((f) => inTop.has(f.id)).length / Math.max(1, fs.length)) * 100),
        }))
        .sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0)),
      note: 'avgScore ranks the hook TYPE; shareOfTopQuartile shows how reliably that type reaches the top — a high average on 2 formats is not a pattern.',
    },

    payoff: {
      // The single most actionable retention question: how long can the promise hang?
      byPayoffSecond: buckets(scored, (f) => f.payoff_sec, [0, 1, 2, 3, 5, 8, 15, 999],
        (lo, hi) => (hi === 999 ? `${lo}s+` : `${lo}-${hi}s`)),
      payoffVsScore: pearson(
        scored.filter((f) => typeof f.payoff_sec === 'number').map((f) => f.payoff_sec!),
        scored.filter((f) => typeof f.payoff_sec === 'number').map((f) => f.overall),
      ),
      avgPayoffTopQuartile: mean(topQuartile.map((f) => f.payoff_sec).filter((v): v is number => typeof v === 'number')),
      avgPayoffBottomQuartile: mean(bottomQuartile.map((f) => f.payoff_sec).filter((v): v is number => typeof v === 'number')),
    },

    pacing: {
      byCutCadence: buckets(scored, (f) => f.cut_cadence, [0, 1, 2, 3, 5, 999],
        (lo, hi) => (hi === 999 ? `${lo}s+ between cuts` : `${lo}-${hi}s between cuts`)),
      byDuration: buckets(scored, (f) => f.duration_sec, [0, 8, 15, 30, 60, 999],
        (lo, hi) => (hi === 999 ? `${lo}s+` : `${lo}-${hi}s`)),
      oneShotVsMultiClip: [true, false].map((isOne) => {
        const fs = scored.filter((f) => Boolean(f.one_shot) === isOne);
        return { shape: isOne ? 'one_shot' : 'multi_clip', formats: fs.length, avgScore: mean(fs.map((f) => f.overall)) };
      }),
    },

    // The teaching layer, counted. "Appears often AND on high scorers" is the useful cell.
    retentionDrivers: drivers.results.map((r) => ({ driver: r.value, formats: r.n, avgScore: round(r.avg_score) })),
    recurringStrengths: strengths.results.map((r) => ({ strength: r.value, formats: r.n, avgScore: round(r.avg_score) })),
    recurringWeaknesses: weaknesses.results.map((r) => ({ weakness: r.value, formats: r.n, avgScore: round(r.avg_score) })),

    exemplars: {
      best: sorted.slice(0, 10).map((f) => ({
        id: f.id, title: f.title, formatType: f.format_type, score: f.overall,
        hookType: f.hook_type, payoffSec: f.payoff_sec, cutCadenceSec: f.cut_cadence,
      })),
      worst: sorted.slice(-10).reverse().map((f) => ({
        id: f.id, title: f.title, formatType: f.format_type, score: f.overall,
        hookType: f.hook_type, payoffSec: f.payoff_sec, cutCadenceSec: f.cut_cadence,
      })),
    },
  }, 200, req, env);
}
