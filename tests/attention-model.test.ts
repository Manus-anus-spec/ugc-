/**
 * The attention model (2026-08-28) — Triple Hook, stakes, lock-in, identity, sharer payoff.
 *
 * Derived from convergent findings across marketing-psychology sources Khian supplied:
 * Kallaway's Four S's / Triple Hook / Lock-in Zone, and Tuan Le's familiarity-beats-
 * originality, curiosity-trap, identity-over-product and make-the-sharer-look-good.
 *
 * THE RISK THIS FILE GUARDS. 169 formats and 139 generation runs are already stored without
 * any of these fields. If a single one is required on a STORED schema, every one of those
 * rows stops parsing and the library goes dark — the Jul 26 outage in this repo was exactly
 * that class of failure (strict schema + strict lint bricked /generate). So the contract is:
 * REQUIRED of the LLM (Gemini's constrained decoder enforces it), OPTIONAL in storage.
 * Both halves are asserted here. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AttentionPlanSchema, FormatDnaSchema, HookSchema, IdeationSchema, RUBRIC_VERSION,
  ViralityScorecardSchema,
} from '../shared/schemas';
import { buildGeneratorInstruction } from '../worker/src/generate/prompt';

const REPO_ROOT = join(import.meta.dirname, '..');

// ─────────────────────────────────────────────────────────────
// BACK-COMPAT — the half that would take the library down
// ─────────────────────────────────────────────────────────────

test('every stored golden still parses without any attention fields', () => {
  const goldens = [
    'docs/golden-test-1-formatdna.json',
    'docs/golden-test-1-pro-formatdna.json',
    ...readdirSync(join(REPO_ROOT, 'docs/goldens'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => `docs/goldens/${f}`),
  ];
  assert.ok(goldens.length >= 7);
  for (const rel of goldens) {
    const raw = JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8')) as { format?: unknown };
    const parsed = FormatDnaSchema.safeParse((raw as { format?: unknown }).format ?? raw);
    assert.ok(parsed.success, `${rel} stopped parsing: ${JSON.stringify(parsed.error?.issues.slice(0, 3))}`);
  }
});

test('a hook with NO attention fields is still valid (all 169 stored rows)', () => {
  const bare = { type: 'visual', openingVisual: 'she freezes mid-step', mechanism: 'pattern interrupt' };
  assert.ok(HookSchema.safeParse(bare).success);
});

test('an ideation with NO attentionPlan is still valid (all 139 stored runs)', () => {
  const parsed = IdeationSchema.safeParse({
    index: 0, title: 't', angle: 'a', keptFromOriginal: [], reinvented: [],
    whyItWorksForProfile: 'w', creativeBrief: 'b',
    videoModel: { choice: 'kling_3', reason: 'r' },
    faceForwardNote: null, videoFormat: 'ONE_SHOT', clipCount: 1, targetDurationSec: 8,
    beats: [], copy: { caption: 'c', hashtags: [], textOverlays: [] },
    audioPlan: { type: 'trending_audio', description: 'd' },
    editingNotes: 'n', qaChecklist: { nbChecks: [], sdChecks: [], videoChecks: [] },
    status: 'draft',
  });
  assert.ok(parsed.success, `stored ideation broke: ${JSON.stringify(parsed.error?.issues.slice(0, 5))}`);
});

test('a scorecard with NO rubricVersion is still valid — absent means rubric 1', () => {
  const parsed = ViralityScorecardSchema.safeParse({
    overall: 58, verdict: 'v',
    dimensions: {
      hook: { score: 50, reason: 'r' }, retention: { score: 50, reason: 'r' },
      emotion: { score: 50, reason: 'r' }, share: { score: 50, reason: 'r' },
      replay: { score: 50, reason: 'r' }, algo: { score: 50, reason: 'r' },
    },
    strengths: [], weaknesses: [], ceiling: 'c', improvements: [],
  });
  assert.ok(parsed.success);
  assert.equal(parsed.data?.rubricVersion, undefined);
});

test('scores from different rubrics stay DISTINGUISHABLE, not silently mixed', () => {
  // virality_score drives the sampler as score², so an unlabelled mix would quietly
  // reweight the whole library. The stamp is the whole point.
  // Deliberately version-AGNOSTIC: the point is that the stamp is applied and round-trips,
  // not which number it currently holds. tests/rubric-recalibration.test.ts pins the number.
  const v2 = ViralityScorecardSchema.safeParse({
    rubricVersion: RUBRIC_VERSION, overall: 72, verdict: 'v',
    dimensions: {
      hook: { score: 80, reason: 'r' }, retention: { score: 70, reason: 'r' },
      emotion: { score: 60, reason: 'r' }, share: { score: 60, reason: 'r' },
      replay: { score: 55, reason: 'r' }, algo: { score: 75, reason: 'r' },
    },
    strengths: [], weaknesses: [], ceiling: 'c', improvements: [],
  });
  assert.equal(v2.data?.rubricVersion, RUBRIC_VERSION);
});

// ─────────────────────────────────────────────────────────────
// THE PLAN ITSELF — required of the LLM, every field, no escape hatch
// ─────────────────────────────────────────────────────────────

const FULL_PLAN = {
  subject: 'a mum taste-testing her daughter’s "improved" salsa',
  stakes: 'the whole batch is for tonight’s party and there is no time to remake it',
  speed: 'opens mid-spoonful — the greeting and the kitchen tour are cut entirely',
  simplicity: 'one idea: the face. No recipe, no voiceover setup.',
  hookText: 'she said it "barely has any chilli"',
  hookSpoken: 'oh. oh no.',
  hookVisual: 'the spoon already at her mouth, eyes going wide before she can put it down',
  lockIn: 'she has not swallowed yet and the daughter is still smiling off-camera',
  viewerIdentity: 'the person whose family always does this at dinner',
  sharerPayoff: 'sending it says "this is literally my mum" — it is a way to talk about your family',
};

test('a complete attention plan validates', () => {
  assert.ok(AttentionPlanSchema.safeParse(FULL_PLAN).success);
});

for (const field of Object.keys(FULL_PLAN)) {
  test(`attentionPlan REQUIRES ${field} — no field is optional for a new ideation`, () => {
    const partial = { ...FULL_PLAN } as Record<string, string>;
    delete partial[field];
    assert.equal(
      AttentionPlanSchema.safeParse(partial).success, false,
      `${field} was accepted as missing — the generator could then skip it`,
    );
  });
}

// ─────────────────────────────────────────────────────────────
// The instruction has to actually TEACH the model these laws
// ─────────────────────────────────────────────────────────────

/** Minimal args for the generator instruction — persona-less profile, so this exercises the
 *  path every model shares rather than the Theme Governor branch. */
function instruction(mode: 'adapt' | 'reproduce' | 'synthesize' = 'adapt'): string {
  const profile = { world: {} } as unknown as Parameters<typeof buildGeneratorInstruction>[0];
  return buildGeneratorInstruction(profile, 'close', 3, mode, 4);
}

test('the generator instruction states all seven attention laws', () => {
  const text = instruction();
  for (const marker of [
    'FOUR S', 'STAKES ARE THE MOST COMMONLY MISSING', 'THREE CHANNELS AT ONCE',
    'LOCK-IN', 'IDENTITY OVER PRODUCT', 'SHARING IS SELFISH', 'FAMILIARITY BEATS ORIGINALITY',
  ]) {
    assert.ok(text.includes(marker), `attention law missing from the instruction: ${marker}`);
  }
});

test('the instruction says the feed autoplays MUTED (the default condition)', () => {
  assert.match(instruction(), /MUTED/);
});

test('the instruction forbids "n/a" as an answer to an attention field', () => {
  // Without this the model fills the easy fields and stubs the hard ones (stakes, sharer
  // payoff), which is precisely the slop the plan exists to prevent.
  assert.match(instruction(), /"n\/a" is not an acceptable answer/i);
});

test('the instruction rejects a demographic as a viewer identity', () => {
  assert.match(instruction(), /media buy, not a reason to watch/);
});

test('the humanization laws survive alongside the new attention laws', () => {
  // Both blocks live in the same instruction; adding one must not displace the other.
  const text = instruction();
  assert.ok(text.includes('HUMANIZATION LAWS'));
  assert.ok(text.includes('ATTENTION LAWS'));
});
