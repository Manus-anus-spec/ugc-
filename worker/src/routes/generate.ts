/**
 * POST /generate — FormatDNA × ModelProfile → GenerationRun (~3 ideations).
 * Two layers (FABLE5-PLAN §5): deterministic TS frame (rules.ts) around ONE creative
 * Gemini call. /generate REQUIRES profileId — there is no default identity to fall
 * back to, which is what killed the old Naomi→Sav bug.
 */
import { z } from 'zod';
import { EditPlanSchema, GenerationRunSchema, IdeationSchema, LipSyncPlanSchema, ModelProfileSchema, VariationStrengthSchema, ViralityForecastSchema } from '../../../shared/schemas';
import type { FormatDna, GenerationRun, ModelProfile } from '../../../shared/contract';
import { API_VERSION, type Env } from '../env';
import { err, json, newId, nowIso } from '../http';
import { callGeminiJson } from '../gemini';
import { applySanitizeMap, enforceIdeation, type LintViolation } from '../generate/rules';
import { NEUTRAL_PROFILE } from '../generate/neutral';
import {
  buildGeneratorInstruction, buildGeneratorRepairPrompt, buildGeneratorUserMessage, buildLintRepairPrompt,
} from '../generate/prompt';

const IDEATION_COUNT = 3;

const RequestSchema = z.object({
  formatId: z.string(),
  /** Omit for the default character-neutral run; pass a profile id to bind identity (optional layer). */
  profileId: z.string().default('neutral'),
  variationStrength: VariationStrengthSchema.default('close'),
});

/** What the LLM owns: formula + ideations. Ids/versions/timestamps are ours.
 *  No .min/.max on the array — Gemini's decoder rejects array bounds on large
 *  item schemas (see geminiSafeSchema); the count is enforced below instead. */
const LlmOutputSchema = z.object({
  formulaExtracted: z.string(),
  // virality forecast, edit plan, and lip-sync plan are REQUIRED on new runs
  // (optional in the stored IdeationSchema only so old rows keep parsing)
  ideations: z.array(IdeationSchema.extend({
    virality: ViralityForecastSchema,
    editPlan: EditPlanSchema,
    lipSyncPlan: LipSyncPlanSchema,
  })),
});
const LLM_JSON_SCHEMA = z.toJSONSchema(LlmOutputSchema) as Record<string, unknown>;

function violationsToText(violations: LintViolation[]): string {
  return violations.map((v) => `- ideation beat/clip ${v.beatIndex}, ${v.field}: ${v.problem}`).join('\n');
}

export async function generate(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return err('invalid_body', 'body must be { formatId, profileId, variationStrength? }', 400, req, env, parsed.error.issues);
  }
  const { formatId, profileId, variationStrength } = parsed.data;
  // The whole pipeline runs inside waitUntil: a client disconnect (tab closed,
  // page reloaded) can no longer cancel the invocation and orphan a paid Gemini
  // call — the run still completes and lands in D1, recoverable via history.
  const work = runGeneration(req, env, formatId, profileId, variationStrength);
  ctx.waitUntil(work.then(() => undefined, () => undefined));
  return work;
}

async function runGeneration(
  req: Request, env: Env, formatId: string, profileId: string,
  variationStrength: z.infer<typeof VariationStrengthSchema>,
): Promise<Response> {

  // ── Load format + profile ──
  const formatRow = await env.DB.prepare('SELECT dna, current_version, schema_version FROM formats WHERE id = ?')
    .bind(formatId).first<{ dna: string; current_version: number; schema_version: string }>();
  if (!formatRow) return err('not_found', `format ${formatId} not found`, 404, req, env);
  if (formatRow.schema_version === '0-legacy') {
    return err('legacy_format', 'this is a migrated legacy entry with no clean DNA — re-analyze the source video first', 422, req, env);
  }
  let profile: ModelProfile;
  if (profileId === 'neutral') {
    profile = NEUTRAL_PROFILE;   // built-in, never from D1 — cannot be edited into carrying identity
  } else {
    const profileRow = await env.DB.prepare('SELECT profile FROM profiles WHERE id = ?')
      .bind(profileId).first<{ profile: string }>();
    if (!profileRow) return err('not_found', `profile ${profileId} not found`, 404, req, env);
    profile = ModelProfileSchema.parse(JSON.parse(profileRow.profile)) as ModelProfile;
  }
  const dna = JSON.parse(formatRow.dna) as FormatDna;

  // ── Layer 1 (pre): sanitize the LLM input; stored DNA keeps raw observations ──
  const dnaForLlm = applySanitizeMap(JSON.stringify(dna, null, 1), profile);
  const systemInstruction = buildGeneratorInstruction(profile, variationStrength, IDEATION_COUNT);
  const userMessage = buildGeneratorUserMessage(dnaForLlm, JSON.stringify(profile, null, 1));

  const call = (text: string) => callGeminiJson({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    systemInstruction,
    parts: [{ text }],
    jsonSchema: LLM_JSON_SCHEMA,
    temperature: 0.7,   // creative fill — matches the old generator's temperature
  });

  // ── Layer 2: one creative call, one schema-guided repair ──
  let raw = (await call(userMessage)).text;
  let output = LlmOutputSchema.safeParse(tryParse(raw));
  if (!output.success) {
    raw = (await call(buildGeneratorRepairPrompt(zodText(output.error), raw))).text;
    output = LlmOutputSchema.safeParse(tryParse(raw));
    if (!output.success) {
      return err('generation_invalid', 'generator output failed schema validation after one repair attempt', 502, req, env,
        output.error.issues.slice(0, 20));
    }
  }

  if (output.data.ideations.length < 2) {
    return err('generation_invalid', `generator returned ${output.data.ideations.length} ideation(s), need ${IDEATION_COUNT}`, 502, req, env);
  }

  // ── Layer 1 (post): enforce every deterministic rule; one targeted rewrite, then hard-fail ──
  let violations = output.data.ideations.flatMap((i) => enforceIdeation(i, profile, dna));
  if (violations.length > 0) {
    raw = (await call(buildLintRepairPrompt(violationsToText(violations), JSON.stringify(output.data)))).text;
    const repaired = LlmOutputSchema.safeParse(tryParse(raw));
    if (repaired.success) {
      output = repaired;
      violations = output.data.ideations.flatMap((i) => enforceIdeation(i, profile, dna));
    }
  }
  if (violations.length > 0) {
    return err('lint_failed', 'generated prompts violate hard production rules after one rewrite attempt — nothing was saved', 502, req, env,
      violations.slice(0, 30));
  }

  // ── Assemble + persist ──
  const now = nowIso();
  const run: GenerationRun = {
    schemaVersion: 1,
    id: newId(),
    formatId,
    formatVersion: formatRow.current_version,
    profileId,
    profileVersion: profile.version,
    variationStrength,
    formulaExtracted: output.data.formulaExtracted,
    ideations: output.data.ideations.map((i, idx) => ({ ...i, index: idx })),
    createdAt: now,
    generatorVersion: `${API_VERSION}/${env.GEMINI_MODEL}`,
  };
  GenerationRunSchema.parse(run);   // belt-and-braces before persisting

  await env.DB.prepare(
    `INSERT INTO generations (id, format_id, format_version, profile_id, profile_version,
       variation_strength, status, output, created_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
  ).bind(run.id, formatId, run.formatVersion, profileId, run.profileVersion, variationStrength,
    JSON.stringify(run), now).run();

  return json(run, 200, req, env);
}

export async function listGenerations(req: Request, env: Env, formatId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, profile_id, profile_version, variation_strength, status, created_at
     FROM generations WHERE format_id = ? ORDER BY created_at DESC LIMIT 50`
  ).bind(formatId).all<{ id: string; profile_id: string; profile_version: number; variation_strength: string; status: string; created_at: string }>();
  return json({
    formatId,
    items: results.map((r) => ({
      id: r.id, profileId: r.profile_id, profileVersion: r.profile_version,
      variationStrength: r.variation_strength, status: r.status, createdAt: r.created_at,
    })),
  }, 200, req, env);
}

export async function getGeneration(req: Request, env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT output FROM generations WHERE id = ?').bind(id).first<{ output: string }>();
  if (!row) return err('not_found', `generation ${id} not found`, 404, req, env);
  return json(JSON.parse(row.output), 200, req, env);
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

function zodText(error: z.ZodError): string {
  return error.issues.slice(0, 40).map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}
