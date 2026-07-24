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
import { FormatTypeSchema, ViralityScorecardSchema } from '../../../shared/schemas';
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

2. virality: the brutal scorecard. You are a creative director who has watched 10,000 short-form videos die; a wrong HIGH score is more expensive than a wrong low one. SCORE DISTRIBUTION LAW: median posted video gets <500 views; a typical competent video scores 40-55; 70 = top ~10%; 90+ almost never. When torn between two scores take the LOWER. No credit for polish or prettiness.
Score all six dimensions (hook/retention/emotion/share/replay/algo) with reasons grounded in the DNA (hook mechanism, beats, pacing, whyItWorks). overall is weighted (hook ~30%, retention ~25%), hard-capped at 45 if the hook is weak. verdict = ONE brutal editor sentence. weaknesses = every drag. ceiling = realistic view band + the ONE cap. improvements = concrete fixes.
Since you scored from the blueprint (not pixels), keep confidence honest: do not award any dimension above 80.

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
        // Frames are the bulkiest field and add little to classification — drop them from the LLM input.
        const { frames: _frames, ...dnaLite } = dna;
        const res = await callGeminiJson({
          apiKey: env.GEMINI_API_KEY,
          model: env.GEMINI_MODEL,
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
