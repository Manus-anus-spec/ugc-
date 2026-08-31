/**
 * POST /generate — FormatDNA × ModelProfile → GenerationRun (~3 ideations).
 * Two layers (FABLE5-PLAN §5): deterministic TS frame (rules.ts) around ONE creative
 * Gemini call per ideation variant. /generate REQUIRES profileId — there is no default
 * identity to fall back to, which is what killed the old Naomi→Sav bug.
 *
 * CPU-budget architecture (Jul 30): the free plan allows ~10ms CPU per invocation, and
 * running all three variants' SSE parsing + zod validation + lint enforcement inside
 * one request tripped Cloudflare 1102 "exceededCpu" live (generation died after ~60s).
 * The parent /generate now only validates + fans out + assembles; each variant runs as
 * its OWN invocation via the SELF service binding (POST /generate/variant) with its own
 * CPU budget. Without the binding (local dev), variants fall back to running inline.
 */
import { z } from 'zod';
import {
  AttentionPlanSchema, BeatGenerationSchema, TransplantPlanSchema, CameraAngleSchema, ContinuityLockSchema,
  CutTransitionSchema,
  EditPlanSchema, FidelityModeSchema, FirstFrameSourceSchema, GenerationRunSchema,
  GenerationVerdictPatchSchema, IdeationSchema,
  LipSyncPlanSchema, ModelProfileSchema, SecondaryMotionSchema, ShotSizeSchema,
  VariationStrengthSchema, ViralityForecastSchema,
} from '../../../shared/schemas';
import type { FidelityMode, FormatDna, GenerationRun, ModelProfile } from '../../../shared/contract';
import { API_VERSION, type Env } from '../env';
import { err, json, newId, nowIso } from '../http';
import { callGeminiJson, GeminiQuotaError, geminiKeys, withGeminiKeyFailover } from '../gemini';
import {
  applySanitizeMap, applyUniversalSanitize, buildSegmentPlanText, enforceIdeation,
  hardStripNsfwForLlm, planSegments, type LintViolation,
} from '../generate/rules';
import { NEUTRAL_PROFILE } from '../generate/neutral';
import { EXPLORATION_BONUS_MAX, sampleSurpriseSources } from '../generate/surprise';
import {
  buildGeneratorInstruction, buildGeneratorRepairPrompt, buildGeneratorUserMessage, buildLintRepairPrompt,
  buildSynthesisDigest, buildSynthesisUserMessage,
} from '../generate/prompt';

const IDEATION_COUNT = 3;

const RequestBase = z.object({
  /** Required for reproduce/adapt (single source). For synthesize it's the ANCHOR source —
   *  optional there; defaults to the first resolved fusion source. */
  formatId: z.string().optional(),
  /** synthesize (§10) only: 2–4 library blueprints to fuse. Omit for "surprise me" — the
   *  server draws a fresh weighted-random, archetype-diverse set from the whole
   *  high-scoring library on every press (see selectSurpriseFormatIds). */
  formatIds: z.array(z.string()).min(2).max(4).optional(),
  /** Omit for the default character-neutral run; pass a profile id to bind identity (optional layer). */
  profileId: z.string().default('neutral'),
  variationStrength: VariationStrengthSchema.default('close'),
  /** v3: 'reproduce' (default) transplants one source's FILMING 1:1; 'adapt' reinvents one
   *  source's surface; 'synthesize' fuses N blueprints' mechanisms into a NEW format. */
  fidelityMode: FidelityModeSchema.default('reproduce'),
});
const requireFormatIdUnlessSynthesize = (d: z.infer<typeof RequestBase>) =>
  d.fidelityMode === 'synthesize' || !!d.formatId;
const REQUIRE_MSG = { message: 'formatId is required unless fidelityMode is "synthesize"' };
const RequestSchema = RequestBase.refine(requireFormatIdUnlessSynthesize, REQUIRE_MSG);

/** Internal per-variant dispatch (SELF binding) — same params plus which variant.
 *  Trusted internal caller, so the refine isn't re-applied. */
const VariantRequestSchema = RequestBase.extend({
  variant: z.number().int().min(0).max(IDEATION_COUNT - 1),
  /** synthesize: the resolved source set (parent already auto-selected if needed). */
  resolvedSourceIds: z.array(z.string()).optional(),
});
const SYNTHESIS_SOURCE_COUNT = 3;

/** v3: the generator is ASKED for the filming-fidelity fields (prompt), but the
 *  schema stays LENIENT — every omission has a deterministic fill in enforceIdeation
 *  (reproduce pins from the source; adapt gets derived defaults), so a dropped field
 *  can never 502 a paid run (Jul 26 outage: strict schema + strict lint bricked
 *  /generate). productionRoute is omitted — built deterministically, never LLM'd. */
const GeneratedBeatSchema = BeatGenerationSchema.extend({
  shotSize: ShotSizeSchema.optional(),
  cameraAngle: CameraAngleSchema.optional(),
  durationSec: z.number().optional(),
  cutType: CutTransitionSchema.optional(),
  motionBeat: z.string().optional(),
  secondaryMotion: SecondaryMotionSchema.optional(),
  microExpression: z.string().optional(),
  startsOnCut: z.boolean().optional(),
  sourceBeatIndex: z.number().int().optional(),
  firstFrameSource: FirstFrameSourceSchema.optional(),
}).omit({ productionRoute: true, challengeLog: true });   // both built/filled server-side, never LLM'd

/** What the LLM owns: formula + ideations. Ids/versions/timestamps are ours.
 *  No .min/.max on the array — Gemini's decoder rejects array bounds on large
 *  item schemas (see geminiSafeSchema); the count is enforced below instead. */
// virality forecast, edit plan, lip-sync plan, continuity lock, and per-beat
// filming fields are REQUIRED on new runs (optional in the stored IdeationSchema
// only so old rows keep parsing)
const LlmIdeationExtension = {
  // Attention plan is REQUIRED of the LLM (Gemini's constrained decoder enforces it) while
  // the stored IdeationSchema keeps it optional — the standing rule here is that a dropped
  // field must never 502 a paid run, and every run stored before 2026-08-28 lacks it.
  attentionPlan: AttentionPlanSchema,
  transplantPlan: TransplantPlanSchema,
  virality: ViralityForecastSchema,
  editPlan: EditPlanSchema,
  lipSyncPlan: LipSyncPlanSchema,
  continuityLock: ContinuityLockSchema.optional(),   // omission → DNA-derived default (rules.ts)
  beats: z.array(GeneratedBeatSchema),
};
const LlmOutputSchema = z.object({
  formulaExtracted: z.string(),
  ideations: z.array(IdeationSchema.extend(LlmIdeationExtension)),
});
const LLM_JSON_SCHEMA = z.toJSONSchema(LlmOutputSchema) as Record<string, unknown>;
// Persona runs (Theme Governor): Gemini's constrained decoding REQUIRES themeFit; zod
// validation stays on the lenient base schema — a dropped optional field must never
// 502 a paid run (Jul 26 outage rule).
const LLM_JSON_SCHEMA_PERSONA = z.toJSONSchema(z.object({
  formulaExtracted: z.string(),
  ideations: z.array(IdeationSchema.extend({ ...LlmIdeationExtension, themeFit: z.string() })),
})) as Record<string, unknown>;

type LlmIdeation = z.infer<typeof LlmOutputSchema>['ideations'][number];
type VariantResult = { formula: string; ideation: LlmIdeation };

class InputBlocked extends Error {}
/** A SELF-dispatched variant failed — carries the child's typed ApiError code. */
class VariantHttpError extends Error {
  constructor(message: string, public readonly code: string) { super(message); }
}

const INPUT_BLOCKED_MESSAGE =
  "Google's content filter refused this format's DNA even after sanitization (this filter cannot be disabled and fires probabilistically). Try again in a minute, re-analyze the source with tamer wording, or generate from a different format.";

// Diversity across variants comes from explicit per-variant hints — each variant is
// one Gemini call (a single 3-ideation mega-call streamed 3-6 min and died mid-read).
const VARIANT_HINTS = [
  'This run produces VARIANT 1 of 3: take the most natural, highest-probability scenario mapping for this profile (her most-used location + default wardrobe key).',
  'This run produces VARIANT 2 of 3: take a clearly DIFFERENT location and wardrobe mapping than the most obvious choice — same filming, a different room of her world.',
  'This run produces VARIANT 3 of 3: take the boldest natural in-world mapping (an unexpected but plausible location/prop pairing) — same filming, maximum freshness.',
];
// Synthesize-mode hints rotate which source's HOOK becomes the fusion's spine — the
// location/wardrobe hints above let all 3 fusions converge on the same (strongest)
// hook, which compounded the "always the same idea" feeling (Aug 17 brief).
const SYNTH_VARIANT_HINTS = [
  'This run produces VARIANT 1 of 3: build the fusion around the single STRONGEST scroll-stop hook mechanism in the source set, mapped to her most natural location + wardrobe.',
  "This run produces VARIANT 2 of 3: pick a DIFFERENT source's hook mechanism as the spine — NOT the strongest/most obvious one — and set it in a different part of her world.",
  'This run produces VARIANT 3 of 3: build around the most UNEXPECTED mechanism combination in the set that still plausibly stops the scroll for her audience — maximum freshness.',
];

function violationsToText(violations: LintViolation[]): string {
  return violations.map((v) => `- ideation beat/clip ${v.beatIndex}, ${v.field}: ${v.problem}`).join('\n');
}

export async function generate(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return err('invalid_body', 'body must be { formatId, profileId, variationStrength? }', 400, req, env, parsed.error.issues);
  }
  const { formatId, formatIds, profileId, variationStrength, fidelityMode } = parsed.data;
  // The whole pipeline runs inside waitUntil: a client disconnect (tab closed,
  // page reloaded) can no longer cancel the invocation and orphan a paid Gemini
  // call — the run still completes and lands in D1, recoverable via history.
  const work = runGeneration(req, env, formatId, profileId, variationStrength, fidelityMode, formatIds);
  ctx.waitUntil(work.then(() => undefined, () => undefined));
  return work;
}

/** POST /generate/variant — internal SELF dispatch: ONE ideation variant in its own
 *  invocation (own CPU budget). Authed like every route (the parent forwards the
 *  operator's X-API-Key), so external calls are harmless. */
export async function generateVariant(req: Request, env: Env): Promise<Response> {
  const parsed = VariantRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return err('invalid_body', 'body must be { formatId, profileId, variationStrength, fidelityMode, variant }', 400, req, env, parsed.error.issues);
  }
  const { formatId, profileId, variationStrength, fidelityMode, variant, resolvedSourceIds, formatIds } = parsed.data;
  try {
    if (fidelityMode === 'synthesize') {
      const ids = resolvedSourceIds ?? formatIds ?? [];
      const loaded = await loadSynthesisSources(req, env, ids, profileId);
      if (loaded instanceof Response) return loaded;
      const result = await runSingleVariant(env, loaded.dnas[0]!, loaded.profile, variationStrength, fidelityMode, variant, loaded.dnas);
      return json(result, 200, req, env);
    }
    if (!formatId) return err('invalid_body', 'formatId is required for reproduce/adapt', 400, req, env);
    const loaded = await loadFormatAndProfile(req, env, formatId, profileId);
    if (loaded instanceof Response) return loaded;
    const result = await runSingleVariant(env, loaded.dna, loaded.profile, variationStrength, fidelityMode, variant);
    return json(result, 200, req, env);
  } catch (e) {
    if (e instanceof InputBlocked) return err('gemini_input_blocked', INPUT_BLOCKED_MESSAGE, 502, req, env);
    throw e;   // GeminiQuotaError → typed 503 in index.ts; anything else → 500 internal
  }
}

type Loaded = { dna: FormatDna; profile: ModelProfile; formatVersion: number };

async function loadFormatAndProfile(
  req: Request, env: Env, formatId: string, profileId: string,
): Promise<Loaded | Response> {
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
  return { dna: JSON.parse(formatRow.dna) as FormatDna, profile, formatVersion: formatRow.current_version };
}

/** Load just the profile (shared by the single-source and synthesis loaders). */
async function loadProfile(req: Request, env: Env, profileId: string): Promise<ModelProfile | Response> {
  if (profileId === 'neutral') return NEUTRAL_PROFILE;
  const row = await env.DB.prepare('SELECT profile FROM profiles WHERE id = ?').bind(profileId).first<{ profile: string }>();
  if (!row) return err('not_found', `profile ${profileId} not found`, 404, req, env);
  return ModelProfileSchema.parse(JSON.parse(row.profile)) as ModelProfile;
}

/** §10 "surprise me" retrieval (rewritten Aug 17 — the sameness bug): the old version
 *  was ORDER BY score + greedy dedupe with NO randomness and NO profileId — every press
 *  fused the identical 3 blueprints for every model ("always feral"), leaving the rest
 *  of the library unused. Now: candidate pool = ALL scored formats → score-weighted
 *  random sample with archetype spread (sampleSurpriseSources), excluding the source
 *  sets of THIS profile's last 2 surprise runs (sourceFormatIds is already persisted
 *  in the run output), shuffled so the aesthetic anchor (dnas[0]) rotates too. */
async function selectSurpriseFormatIds(
  env: Env, n: number, profileId: string,
  formatMenu?: string[],   // contentPersona.formatMenu → lane bias (undefined = unbiased, pre-framework behavior)
): Promise<string[]> {
  const { results } = await env.DB.prepare(
    // No LIMIT: a top-N cut left 4 whole archetypes (all sub-60 scores) permanently
    // outside the pool. score²-weighting in the sampler is the quality bias instead.
    `SELECT id, format_type, virality_score,
            json_extract(dna, '$.viralMechanics.production.aiFeasibility') AS ai_feasibility
       FROM formats
     WHERE schema_version != '0-legacy' AND virality_score IS NOT NULL
     ORDER BY virality_score DESC`,
  ).all<{ id: string; format_type: string | null; virality_score: number; ai_feasibility: number | null }>();
  // Don't-repeat memory: the exact ids fused by the last 2 surprise-me runs for this profile.
  const recent = await env.DB.prepare(
    `SELECT json_extract(output, '$.sourceFormatIds') AS ids FROM generations
     WHERE profile_id = ? AND json_extract(output, '$.fidelityMode') = 'synthesize'
     ORDER BY created_at DESC LIMIT 2`,
  ).bind(profileId).all<{ ids: string | null }>();
  const exclude = new Set<string>();
  for (const r of recent.results) {
    try { for (const id of JSON.parse(r.ids ?? '[]') as string[]) exclude.add(id); } catch { /* tolerate old rows */ }
  }
  // Fusion-quality prior (Phase 3): per-format up/down counts from judged runs.
  // A format earns credit two ways, because a run reaches it two ways: as one of the
  // fused sources of a synthesize run (sourceFormatIds), or as the single subject of a
  // reproduce/adapt run (format_id). Counting only the first would leave every
  // non-synthesis thumb on the floor. 'shipped' counts as a strong up — the operator
  // actually published it, which is the best signal available.
  const verdicts = await env.DB.prepare(
    `WITH judged AS (
       SELECT g.verdict AS verdict, j.value AS format_id
         FROM generations g, json_each(json_extract(g.output, '$.sourceFormatIds')) j
        WHERE g.verdict IS NOT NULL
       UNION ALL
       SELECT g.verdict AS verdict, g.format_id AS format_id
         FROM generations g
        WHERE g.verdict IS NOT NULL
          AND json_extract(g.output, '$.sourceFormatIds') IS NULL
     )
     SELECT format_id,
            SUM(CASE WHEN verdict IN ('up', 'shipped') THEN 1 ELSE 0 END) AS ups,
            SUM(CASE WHEN verdict = 'down' THEN 1 ELSE 0 END) AS downs
       FROM judged GROUP BY format_id`,
  ).all<{ format_id: string; ups: number; downs: number }>();
  const feedback = new Map(verdicts.results.map((r) => [r.format_id, { ups: r.ups, downs: r.downs }]));
  if (feedback.size > 0) {
    const shaped = [...feedback.entries()].map(([id, f]) => `${id.slice(0, 8)}:+${f.ups}/-${f.downs}`);
    console.log(`surprise ${profileId}: fitness prior active on ${feedback.size} format(s) — ${shaped.join(' ')}`);
  }

  // Usage counts for the exploration bonus (Phase 4). Only 31 of 169 formats had ever been
  // fused; score²-weighting alone cannot reach the tail, so a never-drawn format gets a
  // bounded lift. Same two-ways-in accounting as the fitness query above.
  const usage = await env.DB.prepare(
    `WITH used AS (
       SELECT j.value AS format_id, 'fused' AS how
         FROM generations g, json_each(json_extract(g.output, '$.sourceFormatIds')) j
       UNION ALL
       SELECT g.format_id AS format_id, 'subject' AS how
         FROM generations g
        WHERE json_extract(g.output, '$.sourceFormatIds') IS NULL
     )
     SELECT format_id,
            SUM(CASE WHEN how = 'fused'   THEN 1 ELSE 0 END) AS times_fused,
            SUM(CASE WHEN how = 'subject' THEN 1 ELSE 0 END) AS times_subject
       FROM used GROUP BY format_id`,
  ).all<{ format_id: string; times_fused: number; times_subject: number }>();
  const usageBy = new Map(usage.results.map((r) => [r.format_id, r]));
  const neverUsed = results.filter((r) => !usageBy.has(r.id)).length;
  console.log(
    `surprise ${profileId}: coverage ${results.length - neverUsed}/${results.length} used — ` +
    `exploration bonus ×${EXPLORATION_BONUS_MAX} on ${neverUsed} never-drawn format(s)`,
  );

  const menu = formatMenu && formatMenu.length > 0 ? new Set(formatMenu) : undefined;
  if (menu) {
    // Persona lane bias — log the split, never silently drop (types stay drawable at ×0.15).
    const types = [...new Set(results.map((r) => r.format_type ?? '?'))];
    console.log(`surprise ${profileId}: persona lane bias — up-weighted [${types.filter((t) => menu.has(t)).join(', ')}], down-weighted ×0.15 [${types.filter((t) => !menu.has(t)).join(', ')}]`);
  }
  const ids = sampleSurpriseSources(
    results.map((r) => ({
      id: r.id, formatType: r.format_type, score: r.virality_score,
      ...feedback.get(r.id),   // absent = never judged = neutral fitness 0.5
      timesFused: usageBy.get(r.id)?.times_fused ?? 0,
      timesSubject: usageBy.get(r.id)?.times_subject ?? 0,
      // null (never assessed) stays undefined -> neutral weight, so the 169 pre-existing
      // formats are not penalised for a field that did not exist when they were analysed.
      ...(r.ai_feasibility !== null ? { aiFeasibility: r.ai_feasibility } : {}),
    })), n, exclude,
    Math.random, menu,
  );
  console.log(`surprise ${profileId}: drew [${ids.join(', ')}]`);
  return ids;
}

type SynthesisLoaded = { dnas: FormatDna[]; profile: ModelProfile; sourceIds: string[]; anchorVersion: number };

/** §10 synthesis loader: N source DNAs + profile. dnas[0] is the anchor (supplies aesthetic
 *  defaults downstream). Skips missing/legacy sources; needs ≥2 valid to fuse. */
async function loadSynthesisSources(
  req: Request, env: Env, sourceIds: string[], profileId: string,
): Promise<SynthesisLoaded | Response> {
  const profile = await loadProfile(req, env, profileId);
  if (profile instanceof Response) return profile;
  const dnas: FormatDna[] = [];
  const kept: string[] = [];
  let anchorVersion = 1;
  for (const id of sourceIds) {
    const row = await env.DB.prepare('SELECT dna, current_version, schema_version FROM formats WHERE id = ?')
      .bind(id).first<{ dna: string; current_version: number; schema_version: string }>();
    if (!row || row.schema_version === '0-legacy') continue;
    dnas.push(JSON.parse(row.dna) as FormatDna);
    kept.push(id);
    if (kept.length === 1) anchorVersion = row.current_version;
  }
  if (dnas.length < 2) {
    return err('synthesis_insufficient_sources', 'need at least 2 valid (non-legacy) source formats to synthesize', 422, req, env);
  }
  return { dnas, profile, sourceIds: kept, anchorVersion };
}

/** One ideation variant: sanitize inputs, one creative call (with input-block
 *  escalation + key failover), one schema repair, deterministic enforcement + one
 *  targeted rewrite. Throws InputBlocked / GeminiQuotaError / Error. */
async function runSingleVariant(
  env: Env, dna: FormatDna, profile: ModelProfile,
  variationStrength: z.infer<typeof VariationStrengthSchema>,
  fidelityMode: FidelityMode, variant: number,
  sources?: FormatDna[],   // §10 synthesize: the N fusion sources (dna is the anchor = sources[0])
): Promise<VariantResult> {
  // ── Layer 1 (pre): sanitize the LLM input; stored DNA keeps raw observations.
  // Universal map runs AFTER the profile map as the safety net — Gemini's input
  // filter (PROHIBITED_CONTENT) is not disableable and trips on raw observations.
  const dnaForLlm = applyUniversalSanitize(applySanitizeMap(JSON.stringify(dna, null, 1), profile));
  // The profile ships WITHOUT its enforcement config: contentPolicy.sanitizeMap is
  // literally a list of NSFW words and strippedDescriptors is identity regexes —
  // both are server-side machinery the LLM never needs, and both feed the filter.
  const profileForLlm = {
    ...profile,
    contentPolicy: undefined,
    identityLock: { ...profile.identityLock, strippedDescriptors: [] },
  };
  const profileJson = applyUniversalSanitize(JSON.stringify(profileForLlm, null, 1));
  // §10 synthesize: the LLM sees a MECHANISM DIGEST of the N sources (no concrete detail),
  // not one full DNA — so it must invent all surface. Both escalation tiers use the same
  // (already tame) digest; the model-fallback tier still applies.
  const synth = fidelityMode === 'synthesize' && !!sources && sources.length >= 2;
  const synthMessage = synth
    ? buildSynthesisUserMessage(applyUniversalSanitize(applySanitizeMap(buildSynthesisDigest(sources!), profile)), profileJson)
    : '';
  const userMessage = synth ? synthMessage : buildGeneratorUserMessage(dnaForLlm, profileJson);
  const hardDnaJson = applyUniversalSanitize(
    applySanitizeMap(JSON.stringify(hardStripNsfwForLlm(dna), null, 1), profile),
  );
  const hardUserMessage = synth ? synthMessage : buildGeneratorUserMessage(hardDnaJson, profileJson);

  // v3.3: precompute the segment plan — the LLM follows it, never invents grouping.
  const segments = fidelityMode === 'reproduce' ? planSegments(dna.beats) : null;
  const segmentPlan = segments ? buildSegmentPlanText(dna.beats, segments) : undefined;
  const unitCount = segments ? segments.length : dna.beats.length;

  // Text-only calls: free to fail over to the fallback key when the primary
  // project's spend cap is exhausted. Repairs stick to whichever key succeeded.
  let activeKey = env.GEMINI_API_KEY;

  const isInputBlock = (e: unknown): boolean =>
    e instanceof Error && /blocked the input/i.test(e.message);

  const systemInstruction =
    `${buildGeneratorInstruction(profile, variationStrength, 1, fidelityMode, unitCount, segmentPlan)}\n\n# VARIANT DIRECTIVE\n${(synth ? SYNTH_VARIANT_HINTS : VARIANT_HINTS)[variant]}`;
  const call = (text: string, model = env.GEMINI_MODEL) => callGeminiJson({
    apiKey: activeKey,
    model,
    systemInstruction,
    parts: [{ text }],
    // Theme Governor: persona profiles get the schema variant with themeFit REQUIRED.
    jsonSchema: profile.world.contentPersona ? LLM_JSON_SCHEMA_PERSONA : LLM_JSON_SCHEMA,
    temperature: 0.7,   // creative fill — matches the old generator's temperature
  });

  // Input-block escalation: sanitized payload → hard-strip payload → hard-strip on
  // the fallback model (filter behavior differs per model). Blocks cost no tokens.
  const attempts: Array<() => Promise<string>> = [
    async () => (await withGeminiKeyFailover(geminiKeys(env), (k) => {
      activeKey = k;
      return call(userMessage);
    })).text,
    async () => (await call(hardUserMessage)).text,
    ...(env.GEMINI_MODEL_FALLBACK && env.GEMINI_MODEL_FALLBACK !== env.GEMINI_MODEL
      ? [async () => (await call(hardUserMessage, env.GEMINI_MODEL_FALLBACK)).text]
      : []),
  ];
  let raw: string | null = null;
  let lastError: unknown = null;
  for (const [tier, attempt] of attempts.entries()) {
    try {
      raw = await attempt();
      break;
    } catch (e) {
      lastError = e;
      // BUG FIX (2026-08-29): this used to be `if (!isInputBlock(e)) throw e`, which made
      // tiers 2 and 3 dead code for every error class EXCEPT an input block. The fallback
      // MODEL lives in tier 3, so a model-scoped failure — precisely the Gemini geo
      // rejection that returned 0/3 variants — rethrew before the fallback was ever tried.
      // Now every tier gets its turn and only the LAST error propagates.
      //
      // Spend cap is the one terminal case: every tier uses the same keys and
      // withGeminiKeyFailover has already walked all of them, so continuing just burns
      // wall-clock on a paid endpoint to arrive at the same answer.
      if (e instanceof GeminiQuotaError && e.kind === 'spend_cap') throw e;
      const why = isInputBlock(e) ? 'input blocked'
        : e instanceof Error ? e.message.replace(/\s+/g, ' ').slice(0, 140) : String(e);
      console.warn(`variant ${variant}: tier ${tier + 1}/${attempts.length} failed (${why}) — escalating`);
    }
  }
  if (raw === null) {
    // Preserve the typed errors the route's classifier depends on: a quota/rate-limit
    // error keeps its own code, an input block still surfaces as gemini_input_blocked,
    // and anything else propagates verbatim so the detail array names the real cause.
    if (lastError instanceof GeminiQuotaError) throw lastError;
    if (isInputBlock(lastError)) throw new InputBlocked();
    if (lastError) throw lastError;
    throw new InputBlocked();
  }

  // Repair calls embed the model's own output, which can itself trip the filter —
  // always sanitize what goes back in.
  const repairCall = async (text: string): Promise<string> => {
    try {
      return (await call(applyUniversalSanitize(text))).text;
    } catch (e) {
      if (isInputBlock(e)) throw new InputBlocked();
      throw e;
    }
  };

  let output = LlmOutputSchema.safeParse(tryParse(raw));
  if (!output.success) {
    raw = await repairCall(buildGeneratorRepairPrompt(zodText(output.error), raw));
    output = LlmOutputSchema.safeParse(tryParse(raw));
    if (!output.success) {
      throw new Error(`variant ${variant}: output failed schema validation after one repair: ${zodText(output.error).slice(0, 400)}`);
    }
  }
  const ideation = output.data.ideations[0];
  if (!ideation) throw new Error(`variant ${variant}: generator returned no ideation`);

  // Deterministic enforcement + ONE targeted rewrite, scoped to THIS ideation only.
  let violations = enforceIdeation(ideation, profile, dna, fidelityMode);
  if (violations.length > 0) {
    try {
      const rewritten = await repairCall(buildLintRepairPrompt(
        violationsToText(violations),
        JSON.stringify({ formulaExtracted: output.data.formulaExtracted, ideations: [ideation] }),
      ));
      const reparsed = LlmOutputSchema.safeParse(tryParse(rewritten));
      if (reparsed.success && reparsed.data.ideations[0]) {
        const fixed = reparsed.data.ideations[0];
        const remaining = enforceIdeation(fixed, profile, dna, fidelityMode);
        if (remaining.length === 0) return { formula: output.data.formulaExtracted, ideation: fixed };
        violations = remaining;
      }
    } catch (e) {
      if (!(e instanceof InputBlocked)) throw e;   // blocked rewrite: fall through to hard-fail below
    }
    throw new Error(`variant ${variant}: lint violations survived one rewrite: ${violationsToText(violations).slice(0, 400)}`);
  }
  return { formula: output.data.formulaExtracted, ideation };
}

async function runGeneration(
  req: Request, env: Env, formatId: string | undefined, profileId: string,
  variationStrength: z.infer<typeof VariationStrengthSchema>,
  fidelityMode: FidelityMode, formatIds?: string[],
): Promise<Response> {

  // ── Load + validate up front (cheap): 404/422 before any variant is dispatched ──
  let dna: FormatDna;
  let profile: ModelProfile;
  let formatVersion: number;
  let effectiveFormatId: string;
  let sourceIds: string[] | undefined;      // synthesize only — the fused blueprint set
  let sources: FormatDna[] | undefined;     // synthesize only — inline-fallback fusion sources
  if (fidelityMode === 'synthesize') {
    // "surprise me" = no explicit sources → fresh weighted-random, archetype-diverse draw
    // (3 or 4 sources per press so fusion richness varies too — schema max is 4),
    // lane-biased by the profile's contentPersona.formatMenu when present.
    let ids = formatIds;
    if (!ids) {
      const p = await loadProfile(req, env, profileId);
      if (p instanceof Response) return p;
      ids = await selectSurpriseFormatIds(
        env, SYNTHESIS_SOURCE_COUNT + (Math.random() < 0.5 ? 1 : 0), profileId,
        p.world.contentPersona?.formatMenu);
    }
    const s = await loadSynthesisSources(req, env, ids, profileId);
    if (s instanceof Response) return s;
    dna = s.dnas[0]!; profile = s.profile; formatVersion = s.anchorVersion;
    effectiveFormatId = s.sourceIds[0]!; sourceIds = s.sourceIds; sources = s.dnas;
  } else {
    if (!formatId) return err('invalid_body', 'formatId is required for reproduce/adapt', 400, req, env);
    const loaded = await loadFormatAndProfile(req, env, formatId, profileId);
    if (loaded instanceof Response) return loaded;
    dna = loaded.dna; profile = loaded.profile; formatVersion = loaded.formatVersion;
    effectiveFormatId = formatId;
  }

  // ── Layer 2: one call per ideation, run in PARALLEL — each in its OWN invocation
  // via the SELF binding (own CPU budget; see header comment). Inline fallback keeps
  // `wrangler dev` working without the binding.
  const dispatchVariant = async (variant: number): Promise<VariantResult> => {
    if (!env.SELF) return runSingleVariant(env, dna, profile, variationStrength, fidelityMode, variant, sources);
    const res = await env.SELF.fetch('https://ugc-api.internal/generate/variant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': req.headers.get('X-API-Key') ?? '',
      },
      body: JSON.stringify({ formatId: effectiveFormatId, profileId, variationStrength, fidelityMode, variant, resolvedSourceIds: sourceIds }),
    });
    const body = await res.json().catch(() => null) as
      | (VariantResult & { error?: undefined; code?: undefined })
      | { error: string; code: string } | null;
    if (res.ok && body && 'ideation' in body && body.ideation) {
      return { formula: body.formula, ideation: body.ideation };
    }
    throw new VariantHttpError(
      body?.error ?? `variant ${variant} dispatch failed (HTTP ${res.status})`,
      body?.code ?? 'internal',
    );
  };

  const settled = await Promise.allSettled([0, 1, 2].map((v) => dispatchVariant(v)));
  const good = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  const failures = settled.flatMap((s) => (s.status === 'rejected' ? [s.reason] : []));
  const failureCode = (f: unknown): string | null =>
    f instanceof VariantHttpError ? f.code
      : f instanceof InputBlocked ? 'gemini_input_blocked'
        : f instanceof GeminiQuotaError ? (f.kind === 'spend_cap' ? 'gemini_billing_cap' : 'gemini_rate_limited')
          : null;
  if (good.length < 2) {
    if (failures.length && failures.every((f) => failureCode(f) === 'gemini_input_blocked')) {
      return err('gemini_input_blocked', INPUT_BLOCKED_MESSAGE, 502, req, env);
    }
    // Operational quota failures deserve their typed surface, not a generic 502.
    const quota = failures.find((f) => failureCode(f) === 'gemini_billing_cap' || failureCode(f) === 'gemini_rate_limited');
    if (quota) {
      return err(failureCode(quota)!, quota instanceof Error ? quota.message : String(quota), 503, req, env);
    }
    // Say WHY, and stop claiming transience we cannot know. The old copy read "retry, this
    // is usually transient" for every failure — during the 2026-08-29 geo outage that was
    // actively misleading: all three variants failed deterministically on the same Google
    // rejection, and the message sent the operator into a retry loop that could not work.
    // If every variant died the same way, that identical cause IS the error; surface it.
    const details = failures
      .map((f) => (f instanceof Error ? f.message.replace(/\s+/g, ' ').slice(0, 300) : String(f)))
      .slice(0, 6);
    const allSame = details.length > 1 && details.every((d) => d === details[0]);
    const cause = details[0] ? ` — ${allSame ? 'all variants failed identically' : 'first failure'}: ${details[0]}` : '';
    return err('generation_invalid',
      `only ${good.length}/${IDEATION_COUNT} ideation variants survived (need ≥2)${cause}`,
      502, req, env, details);
  }
  if (good.length < IDEATION_COUNT) {
    console.warn(`generate: proceeding with ${good.length}/${IDEATION_COUNT} ideations (failed: ${failures.map((f) => f instanceof Error ? f.message.slice(0, 120) : f).join(' | ')})`);
  }
  const output = { data: { formulaExtracted: good[0]!.formula, ideations: good.map((g) => g.ideation) } };

  // ── Assemble + persist ──
  const now = nowIso();
  const run: GenerationRun = {
    schemaVersion: 1,
    id: newId(),
    formatId: effectiveFormatId,
    formatVersion,
    profileId,
    profileVersion: profile.version,
    variationStrength,
    fidelityMode,
    ...(sourceIds ? { sourceFormatIds: sourceIds } : {}),
    formulaExtracted: output.data.formulaExtracted,
    ideations: output.data.ideations.map((i, idx) => ({ ...i, index: idx })),
    createdAt: now,
    generatorVersion: `${API_VERSION}/${env.GEMINI_MODEL}`,
  };
  GenerationRunSchema.parse(run);   // belt-and-braces before persisting
  await env.DB.prepare(
    `INSERT INTO generations (id, format_id, format_version, profile_id, profile_version,
       variation_strength, status, output, created_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
  ).bind(run.id, effectiveFormatId, run.formatVersion, profileId, run.profileVersion, variationStrength,
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

/** Verdict columns (0004) live outside the output blob, so every read merges them on.
 *  Undefined rather than null for absent values — the schema marks them optional. */
type VerdictRow = { verdict: string | null; verdict_note: string | null; verdict_at: string | null; verdict_ideation: number | null };

function withVerdict(output: string, row: VerdictRow): Record<string, unknown> {
  const run = JSON.parse(output) as Record<string, unknown>;
  if (row.verdict) run.verdict = row.verdict;
  if (row.verdict_note) run.verdictNote = row.verdict_note;
  if (row.verdict_at) run.verdictAt = row.verdict_at;
  if (row.verdict_ideation !== null) run.verdictIdeation = row.verdict_ideation;
  return run;
}

export async function getGeneration(req: Request, env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT output, verdict, verdict_note, verdict_at, verdict_ideation FROM generations WHERE id = ?',
  ).bind(id).first<{ output: string } & VerdictRow>();
  if (!row) return err('not_found', `generation ${id} not found`, 404, req, env);
  return json(withVerdict(row.output, row), 200, req, env);
}

/** PATCH /generations/:id — the feedback loop's write side (Phase 3, brief §P1.1).
 *
 *  Before this route existed the app could not learn: all 138 live runs sat at
 *  status='draft' and NO feedback signal had ever been recorded, so the sampler had
 *  nothing to weight by. The verdict feeds fitness() in the surprise sampler, which
 *  soft-weights the formats behind a fused run.
 *
 *  Idempotent by design: re-thumbing a run OVERWRITES its verdict rather than appending,
 *  so the operator can change their mind and a double-click cannot inflate the counts.
 *  `status` is deliberately not touched. */
export async function patchGeneration(req: Request, env: Env, id: string): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err('invalid_body', 'body must be JSON', 400, req, env);
  }
  const parsed = GenerationVerdictPatchSchema.safeParse(body);
  if (!parsed.success) {
    return err('invalid_body', `verdict patch invalid:\n${zodText(parsed.error)}`, 400, req, env);
  }
  const { verdict, ideationIndex, note } = parsed.data;
  const now = new Date().toISOString();
  // UPDATE … WHERE id = ? reports whether the row existed, so no separate existence read.
  const res = await env.DB.prepare(
    `UPDATE generations SET verdict = ?, verdict_note = ?, verdict_at = ?, verdict_ideation = ?
     WHERE id = ?`,
  ).bind(verdict, note ?? null, now, ideationIndex ?? null, id).run();
  if (!res.meta.changes) return err('not_found', `generation ${id} not found`, 404, req, env);

  console.log(`verdict ${id}: ${verdict}${ideationIndex !== undefined ? ` (ideation ${ideationIndex})` : ''}`);
  const row = await env.DB.prepare(
    'SELECT output, verdict, verdict_note, verdict_at, verdict_ideation FROM generations WHERE id = ?',
  ).bind(id).first<{ output: string } & VerdictRow>();
  return json(withVerdict(row!.output, row!), 200, req, env);
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
