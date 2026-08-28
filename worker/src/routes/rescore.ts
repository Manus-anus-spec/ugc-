/**
 * POST /admin/rescore-virality?limit=N — re-score stored formats under the current rubric.
 *
 * WHY. Measured on the live library, rubrics 1/2 scored 41% of a hand-curated set of proven
 * performers under 40 (169 formats, mean 50.7, only 4 at 80+). The cause was the rubric's
 * prior, not the videos: it told the scorer to assume failure and to break every tie
 * downward. That is the wrong question for a library of winners, and it is expensive in a
 * way that is easy to miss — the surprise sampler weights by score SQUARED, so a wrongly-low
 * score doesn't just mis-label a blueprint, it buries it.
 *
 * Rubric 3 fixes the prior. This route brings existing rows onto it.
 *
 * TEXT-ONLY, ON PURPOSE. It re-scores from the STORED DNA, not from the video — most of the
 * library was uploaded rather than linked, so the source videos are simply gone and
 * re-perception is impossible for them. The DNA is a full timestamped perception record, so
 * scoring from it is exactly what the existing backfill path already does. Measured cost:
 * ~2.5k input tokens per format (169 formats ≈ 0.43M tokens), a few dollars for the lot.
 *
 * IDEMPOTENT AND BATCHED. Only rows whose stored rubricVersion differs from the current one
 * are candidates, so re-running converges and never double-charges for the same row. `limit`
 * caps each invocation (default 10, max 25) because a Worker has a wall-clock and CPU budget
 * and because the operator should be able to spend in small increments and inspect the
 * result before committing to all 169.
 *
 * NEVER AUTOMATIC. Nothing calls this on a schedule. Rescoring overwrites scores the operator
 * may want to compare against, and it spends money — both are decisions, not side effects.
 */
import { z } from 'zod';
import { ViralityScorecardSchema, RUBRIC_VERSION } from '../../../shared/schemas';
import type { FormatDna } from '../../../shared/contract';
import type { Env } from '../env';
import { json, nowIso } from '../http';
import { callGeminiJson, geminiKeys, withGeminiKeyFailover } from '../gemini';
import { VIRALITY_SYSTEM_INSTRUCTION } from '../prompt';

// The real derived schema — same one /analyze scores with, so a rescored row is
// structurally identical to a freshly-analysed one. callGeminiJson runs it through
// geminiSafeSchema internally, so array bounds are stripped for us.
const VIRALITY_JSON_SCHEMA = z.toJSONSchema(ViralityScorecardSchema) as Record<string, unknown>;

type Row = { id: string; title: string; dna: string; virality_score: number | null };

export async function rescoreVirality(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 10) || 10, 1), 25);
  const dryRun = url.searchParams.get('dryRun') === '1';
  // force=1 ignores the rubricVersion stamp. Needed when the SCORER MODEL changes without
  // the rubric text changing: 14 rows were already stamped rubric 3 by Flash, and the
  // idempotency filter would otherwise skip exactly the rows that most need redoing.
  const force = url.searchParams.get('force') === '1';

  // Candidates: anything not already on the current rubric. json_extract returns NULL for
  // rows predating the field, which is exactly the set that needs rescoring.
  const { results } = await env.DB.prepare(
    `SELECT id, title, dna, virality_score FROM formats
      WHERE schema_version != '0-legacy'
        AND (?1 = 1
             OR json_extract(dna, '$.virality.rubricVersion') IS NULL
             OR json_extract(dna, '$.virality.rubricVersion') != ?2)
      -- ORDER BY updated_at, NOT by score. Rescoring sets updated_at = now, so a finished
      -- row moves to the BACK of the queue and a batched backfill sweeps every row exactly
      -- once. Ordering by score looks friendlier (worst first) but breaks under force=1:
      -- the remaining count never decreases, the lowest-scored rows are re-selected on every
      -- batch, and the loop pays Gemini repeatedly for the same formats.
      ORDER BY updated_at ASC
      LIMIT ?3`,
  ).bind(force ? 1 : 0, RUBRIC_VERSION, limit).all<Row>();

  const remainingRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM formats
      WHERE schema_version != '0-legacy'
        AND (?1 = 1
             OR json_extract(dna, '$.virality.rubricVersion') IS NULL
             OR json_extract(dna, '$.virality.rubricVersion') != ?2)`,
  ).bind(force ? 1 : 0, RUBRIC_VERSION).first<{ n: number }>();
  const remaining = remainingRow?.n ?? 0;

  if (dryRun) {
    // Lets the operator see the bill and the batch before spending anything.
    return json({
      dryRun: true, force, rubricVersion: RUBRIC_VERSION,
      scorerModel: env.GEMINI_MODEL_SCORER || env.GEMINI_MODEL_FALLBACK || env.GEMINI_MODEL,
      wouldRescore: results.length, remaining,
      estimatedInputTokensThisBatch: results.reduce((n, r) => n + Math.round(r.dna.length / 4), 0),
      batch: results.map((r) => ({ id: r.id, title: r.title, currentScore: r.virality_score })),
    }, 200, req, env);
  }

  if (results.length === 0) {
    return json({ done: true, rubricVersion: RUBRIC_VERSION, rescored: [], remaining: 0 }, 200, req, env);
  }

  const rescored: { id: string; title: string; before: number | null; after: number }[] = [];
  const failures: { id: string; error: string }[] = [];

  const work = (async () => {
    for (const row of results) {
      try {
        const dna = JSON.parse(row.dna) as FormatDna;
        // Frames are the bulkiest field and add nothing to a mechanics judgement; contentFlag
        // is routing metadata the scorer misreads as a reach penalty (see the standing rule
        // that content rating is never a scoring input).
        const { frames: _frames, contentFlag: _contentFlag, virality: _old, ...dnaLite } = dna;
        const res = await withGeminiKeyFailover(geminiKeys(env), (apiKey) => callGeminiJson({
          apiKey,
          // PRO, not FAST. The analyze path scores on GEMINI_MODEL_FAST as a deliberate
          // spend split (keep Pro for grounded video perception), but this number decides
          // which blueprints get REUSED for every downstream generation — it is the last
          // place to economise. ~$3-6 to score the whole library on Pro.
          model: env.GEMINI_MODEL_SCORER || env.GEMINI_MODEL_FALLBACK || env.GEMINI_MODEL,
          systemInstruction: VIRALITY_SYSTEM_INSTRUCTION,
          parts: [{ text: `FORMAT DNA:\n${JSON.stringify(dnaLite, null, 1)}` }],
          jsonSchema: VIRALITY_JSON_SCHEMA,
          temperature: 0.2,   // judgement, not creativity
        }));
        const parsed = ViralityScorecardSchema.safeParse(tryParse(res.text));
        if (!parsed.success) {
          failures.push({ id: row.id, error: `schema: ${parsed.error.issues[0]?.message ?? 'invalid'}` });
          continue;
        }
        const virality = { ...parsed.data, rubricVersion: RUBRIC_VERSION };
        const newDna = { ...dna, virality };
        await env.DB.prepare(
          'UPDATE formats SET virality_score = ?, dna = ?, updated_at = ? WHERE id = ?',
        ).bind(Math.round(virality.overall), JSON.stringify(newDna), nowIso(), row.id).run();
        rescored.push({
          id: row.id, title: row.title, before: row.virality_score, after: Math.round(virality.overall),
        });
        console.log(`rescore ${row.id}: ${row.virality_score} → ${Math.round(virality.overall)} (rubric ${RUBRIC_VERSION})`);
      } catch (e) {
        failures.push({ id: row.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const delta = rescored.length
      ? Math.round((rescored.reduce((n, r) => n + (r.after - (r.before ?? r.after)), 0) / rescored.length) * 10) / 10
      : 0;
    return json({
      done: remaining - rescored.length <= 0,
      rubricVersion: RUBRIC_VERSION,
      rescored, failures,
      avgScoreDelta: delta,
      remaining: Math.max(0, remaining - rescored.length),
      note: 'Re-run to continue. Only rows not already on the current rubric are candidates, so this converges and never double-charges.',
    }, 200, req, env);
  })();

  ctx.waitUntil(work.then(() => undefined, () => undefined));
  return work;
}

function tryParse(text: string): unknown {
  try {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    return JSON.parse(fenced ? fenced[1]! : trimmed);
  } catch {
    return undefined;
  }
}
