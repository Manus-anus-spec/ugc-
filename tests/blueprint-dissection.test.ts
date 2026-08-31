/**
 * Blueprint dissection — separating what can be STOLEN from what only worked once.
 *
 * THE GAP THIS CLOSES. The library recorded, in forensic detail, WHAT a video did — camera
 * physics, cut cadence, beat-by-beat motion — but never separated the part that transplants
 * from the part that only worked once. So "reuse the format" and "copy the video" were
 * indistinguishable to the generator, and the safest thing it could do was reproduce the
 * surface. That is how you end up a copier instead of a trendsetter, and no amount of prompt
 * polish fixes it, because the distinction was never captured in the first place.
 *
 * Two halves, and they have to meet:
 *  - viralMechanics on the DNA (analyzer): what travels, what does not, and where else the
 *    mechanism could fire.
 *  - transplantPlan on the ideation (generator): what it TOOK and what it INVENTED, stated
 *    plainly enough that a re-skin is visible on the card instead of buried in a prompt.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FormatDnaSchema, IdeationSchema, TransplantPlanSchema, ViralMechanicsSchema,
} from '../shared/schemas';
import { buildGeneratorInstruction, buildSynthesisDigest } from '../worker/src/generate/prompt';
import type { FormatDna } from '../shared/contract';

// ── back-compat: 169 formats and 139 runs predate both fields ──

test('a real stored golden — which has no viralMechanics — still parses', () => {
  // Uses actual library data rather than a hand-built object: the risk being guarded is that
  // all 169 stored formats stop parsing, and only real rows prove that they don't.
  const raw = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'docs', 'golden-test-1-formatdna.json'), 'utf8'),
  ) as { format?: unknown };
  const parsed = FormatDnaSchema.safeParse((raw as { format?: unknown }).format ?? raw);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 4)));
  assert.equal(parsed.data?.viralMechanics, undefined, 'stored goldens predate the dissection');
});

test('an ideation with no transplantPlan still parses', () => {
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
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 4)));
});

// ── the shapes themselves ──

const MECHANICS = {
  primaryDriver: 'the payoff is withheld until the final half-second, so leaving early costs you the joke',
  replicableCore: [
    'a promise made in the first 2s that only resolves at the very end',
    'an authority figure undercut by someone with no authority',
  ],
  nonReplicable: [
    'the creator already had 2M followers, so the first 10k views were free',
    'it rode a trending audio that has since died',
    'her actual grandmother, who cannot be recast',
  ],
  transplantRisk: 'without an existing audience the first 2s must work harder — the promise has to be legible to a stranger',
  freshAngles: ['the same withhold applied to a purchase decision', 'the same undercut with a pet instead of a person'],
  // Added 2026-08-31: production feasibility is now part of the dissection, not a sibling
  // block, because "needs a real bystander" is already a nonReplicable fact and two
  // structures describing the same thing drift apart.
  production: {
    castCount: 2,
    castRoles: ['the authority figure', 'the child who undercuts them'],
    needsPublicLocation: false,
    needsRealBystanders: false,
    screenContentRequired: false,
    aiFeasibility: 30,
    aiFeasibilityReason: 'needs two distinct people on camera; our models are a single character',
    singleCharacterRewrite: 'the model plays both sides across a cut — she IS the authority and the undercut lands via a text overlay',
  },
};

test('a complete viralMechanics validates', () => {
  assert.ok(ViralMechanicsSchema.safeParse(MECHANICS).success);
});

for (const field of Object.keys(MECHANICS)) {
  test(`viralMechanics requires ${field}`, () => {
    const partial = { ...MECHANICS } as Record<string, unknown>;
    delete partial[field];
    assert.equal(ViralMechanicsSchema.safeParse(partial).success, false);
  });
}

const PLAN = {
  mechanismTaken: 'the payoff is withheld until the final half-second',
  surfaceInvented: 'a woman refusing to say which of two flatmates ate the leftovers until the last frame',
  leftBehind: 'the original creator\'s existing audience and the dead trending audio',
  whyNotACopy: 'different situation, cast and payoff — only the withhold structure is shared',
};

test('a complete transplantPlan validates', () => {
  assert.ok(TransplantPlanSchema.safeParse(PLAN).success);
});

for (const field of Object.keys(PLAN)) {
  test(`transplantPlan requires ${field} — no field is optional for a new ideation`, () => {
    const partial = { ...PLAN } as Record<string, string>;
    delete partial[field];
    assert.equal(TransplantPlanSchema.safeParse(partial).success, false, `${field} accepted as missing`);
  });
}

// ── the instruction has to teach the distinction, not just declare it ──

function instruction(mode: 'adapt' | 'reproduce' | 'synthesize' = 'adapt'): string {
  const profile = { world: {} } as unknown as Parameters<typeof buildGeneratorInstruction>[0];
  return buildGeneratorInstruction(profile, 'close', 3, mode, 4);
}

test('the transplant law is stated in the generator instruction', () => {
  const t = instruction();
  assert.match(t, /THE TRANSPLANT LAW/);
  assert.match(t, /STEAL THE MECHANISM, INVENT THE SURFACE/);
});

test('the instruction rejects the "same surface, swapped noun" re-skin', () => {
  // The single most likely failure: ramen review -> pasta review. Naming the failure mode
  // concretely is what makes it avoidable; an abstract "be original" does nothing.
  assert.match(instruction(), /swapped noun/);
  assert.match(instruction(), /Change the SITUATION, not the noun/);
});

test('the instruction tells the model to go up a level when it names a prop', () => {
  assert.match(instruction(), /names a specific prop, brand, person or location/);
});

test('the instruction treats nonReplicable as binding, not advisory', () => {
  assert.match(instruction(), /treat that list as binding/);
});

test('the instruction points at freshAngles rather than the source\'s own territory', () => {
  assert.match(instruction(), /freshAngles/);
  assert.match(instruction(), /re-treading the source's own territory/);
});

// ── the digest is where dissection actually reaches a fusion ──

function dnaWith(vm?: unknown): FormatDna {
  return {
    title: 'Grandma taste test', formatType: 'skit',
    hook: { type: 'visual', mechanism: 'withheld payoff' },
    whyItWorks: { mechanism: 'curiosity gap', retentionDrivers: ['open loop'], targetViewer: 'families' },
    beats: [{}, {}], pacing: { rhythm: 'fast cuts' },
    virality: { overall: 78, strengths: ['clean withhold'] },
    ...(vm ? { viralMechanics: vm } : {}),
  } as unknown as FormatDna;
}

test('the synthesis digest carries the dissection through to the fusion prompt', () => {
  // Without this the fusion has to infer transplantability from a plot summary.
  const digest = buildSynthesisDigest([dnaWith(MECHANICS), dnaWith(MECHANICS)]);
  assert.match(digest, /PRIMARY DRIVER/);
  assert.match(digest, /TRANSPLANTABLE \(reuse these\)/);
  assert.match(digest, /DO NOT REUSE \(worked only for the original\)/);
  assert.match(digest, /FRESH ANGLES/);
  assert.match(digest, /cannot be recast/, 'the nonReplicable detail must survive verbatim');
});

test('the digest degrades cleanly for the 169 formats with no dissection yet', () => {
  // Every stored format lacks viralMechanics until re-analysed. The digest must simply omit
  // those lines rather than emit "undefined" into a paid prompt.
  const digest = buildSynthesisDigest([dnaWith(), dnaWith()]);
  assert.ok(!/PRIMARY DRIVER/.test(digest));
  assert.ok(!/undefined/.test(digest), 'undefined leaked into the fusion prompt');
  assert.match(digest, /why it works: curiosity gap/, 'the pre-existing digest content must survive');
});
