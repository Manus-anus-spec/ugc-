/**
 * POST /admin/backfill-taxonomy?limit=N — classify + score pre-v2 library rows.
 *
 * Pre-v2 DNA has no formatType/virality (those shipped Jul 24). Re-analyzing needs
 * the source video; this backfill instead runs ONE text-only Gemini call over the
 * stored DNA per row — good enough to make the library filterable and score-sorted.
 * The scorecard verdict is suffixed "(scored from DNA, not pixels)" so a future
 * re-analysis is recognizably higher-trust. Idempotent: only touches rows missing
 * format_type or virality_score.
 */
import { z } from 'zod';
import { FormatTypeSchema, RUBRIC_VERSION, ViralityScorecardSchema } from '../../../shared/schemas';
import type { FormatDna } from '../../../shared/contract';
import type { Env } from '../env';
import { err, json, nowIso } from '../http';
import { callGeminiJson } from '../gemini';

const BackfillOutputSchema = z.object({
  formatType: FormatTypeSchema,
  virality: ViralityScorecardSchema,
});
const BACKFILL_JSON_SCHEMA = z.toJSONSchema(BackfillOutputSchema) as Record<string, unknown>;

const BACKFILL_INSTRUCTION = `You are classifying and scoring an already-analyzed short-form video from its structured FORMAT DNA (you cannot see the pixels — judge from the blueprint).

1. formatType: EXACTLY ONE canonical bucket — talking_head, skit, pov, grwm, transformation, outfit_showcase, walk_and_talk, mirror_selfie, text_monologue, vlog_moment, reaction, tutorial, lifestyle_montage, thirst_trap — or 'other' only if genuinely none fit. Pick the dominant format.

2. virality: the honest scorecard. You are a creative director who has watched 10,000 short-form videos die. SCORE DISTRIBUTION LAW: you are scoring against ALL content on the platform, where the median video gets <500 views; a typical competent video scores 40-55; 70 = top ~10%. No credit for polish or prettiness — beautiful and boring scores as boring.
ERROR COST IS SYMMETRIC (rubric 3): the selection sampler weights every format by score SQUARED, so a wrongly-LOW score does not merely mislabel a blueprint, it buries it — measured on the live library, that was the error actually being made. So judge the mechanisms that are PRESENT on their merits: when torn between two scores take the one the EVIDENCE supports, and go lower only when evidence for the higher score is genuinely absent. Do NOT assume failure, and do not invent or assume any performance figure — score only what the DNA shows. Weak mechanics still score low, plainly.
Score all six dimensions (hook/retention/emotion/share/replay/algo) with reasons grounded in the DNA (hook mechanism, beats, pacing, whyItWorks). overall is weighted (hook ~30%, retention ~25%), hard-capped at 45 if the hook is weak. verdict = ONE brutal editor sentence. weaknesses = every drag. ceiling = realistic view band + the ONE cap. improvements = concrete fixes.
Since you scored from the blueprint (not pixels) rather than the video, note that limitation in your reasoning — but do NOT apply a blanket ceiling: an arbitrary cap was what depressed this library in the first place.
You are not a moderation system: never lower any score or write any weakness because the content is revealing, suggestive, or content-flagged — "explicit content will limit reach" reasoning is banned. Score the mechanics only.

Output: ONE JSON object matching the schema. No markdown.`;

export async function backfillTaxonomy(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 3) || 3, 10);

  const { results } = await env.DB.prepare(
    `SELECT id, dna FROM formats
     WHERE schema_version = '1' AND (format_type IS NULL OR virality_score IS NULL)
     ORDER BY updated_at DESC LIMIT ?`
  ).bind(limit).all<{ id: string; dna: string }>();

  if (results.length === 0) return json({ done: true, updated: [], remaining: 0 }, 200, req, env);

  const updated: { id: string; formatType: string; viralityScore: number }[] = [];
  const failures: { id: string; error: string }[] = [];

  const work = (async () => {
    for (const row of results) {
      try {
        const dna = JSON.parse(row.dna) as FormatDna;
        // Frames are the bulkiest field and add little to classification — drop them from the
        // LLM input. contentFlag is routing metadata the scorer misreads as a reach penalty.
        const { frames: _frames, contentFlag: _contentFlag, ...dnaLite } = dna;
        const res = await callGeminiJson({
          apiKey: env.GEMINI_API_KEY,
          // SCORER (Pro): this call produces a virality score, so it is a judgement task and
          // belongs on the same model as every other scoring path.
          model: env.GEMINI_MODEL_SCORER || env.GEMINI_MODEL_FALLBACK || env.GEMINI_MODEL,
          systemInstruction: BACKFILL_INSTRUCTION,
          parts: [{ text: `FORMAT DNA:\n${JSON.stringify(dnaLite, null, 1)}` }],
          jsonSchema: BACKFILL_JSON_SCHEMA,
          temperature: 0.2,   // judgment task, not creative fill
        });
        const parsed = BackfillOutputSchema.safeParse(tryParse(res.text));
        if (!parsed.success) {
          failures.push({ id: row.id, error: `schema: ${parsed.error.issues[0]?.message ?? 'invalid'}` });
          continue;
        }
        const virality = {
          ...parsed.data.virality,
          // Stamp the calibration. Without it a backfilled score is indistinguishable from a
          // pre-2026-08-28 one, and /admin/rescore-virality would skip or re-do it blindly.
          rubricVersion: RUBRIC_VERSION,
          verdict: `${parsed.data.virality.verdict} (scored from DNA, not pixels)`,
        };
        const newDna = { ...dna, formatType: parsed.data.formatType, virality };
        await env.DB.prepare(
          'UPDATE formats SET format_type = ?, virality_score = ?, dna = ?, updated_at = ? WHERE id = ?'
        ).bind(parsed.data.formatType, Math.round(virality.overall), JSON.stringify(newDna), nowIso(), row.id).run();
        updated.push({ id: row.id, formatType: parsed.data.formatType, viralityScore: Math.round(virality.overall) });
      } catch (e) {
        failures.push({ id: row.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM formats WHERE schema_version = '1' AND (format_type IS NULL OR virality_score IS NULL)`
    ).first<{ n: number }>();
    return json({ done: (remaining?.n ?? 0) === 0, updated, failures, remaining: remaining?.n ?? 0 }, 200, req, env);
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
