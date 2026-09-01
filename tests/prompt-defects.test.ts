/**
 * Regression tests for the three prompt defects proven against the committed live
 * artifact docs/live-artifacts/generate-rosalia-2026-08-28-d1e74c20.json
 * (POST /generate, formatId 8712ced8, profileId rosalia, HTTP 200, 3 ideations).
 *
 *   1. sdPrompt emitted the banned body-word "full" in all three ideations
 *      (improvement-log item 1 — the oldest item in the log).
 *   2. The hold-body directive was absent from every motionPrompt (item 23).
 *   3. "waist-up" / "subject fills 50%" survived into prompts (item 6), and the
 *      nbPrompt surface had no portrait lint at all.
 *
 * Each defect is asserted at the injector level AND, where it matters, through the
 * real enforceIdeation chain — an injector test alone would stay green if someone
 * removed the chain's call to it. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  stripBodyWordFull,
  framingToAntiPortrait,
  ensureBeatCameraPhysics,
  ensureBodyHold,
  enforceIdeation,
  lintNbPrompt,
  BODY_HOLD_DIRECTIVE,
  PORTRAIT_FRAMING_TERM,
} from '../worker/src/generate/rules';
import type { Ideation, ModelProfile, FormatDna, Beat } from '../shared/contract';

const REPO_ROOT = join(import.meta.dirname, '..');
const ARTIFACT = 'docs/live-artifacts/generate-rosalia-2026-08-28-d1e74c20.json';

// ─────────────────────────────────────────────────────────────
// DEFECT 1 — item 1: "full" must never reach an emitted sdPrompt
// ─────────────────────────────────────────────────────────────

// The exact strings the live run emitted. Every one escaped the old pattern because
// it required "full" to sit IMMEDIATELY before the body noun.
const LIVE_SD_LEAKS = [
  'Full natural bust + snatched waist, off-shoulder decolletage, warm kitchen light.',
  'off-shoulder embroidered outfit hugs her curves — full natural bust high, tiny snatched waist.',
  'S-curve profile — full high bust, snatched waist, full glutes/hips.',
  'and full proportioned thighs — a believable fit-curvy build.',
  'bold full round lifted glutes and full hips clearly wider than the waist',
];

for (const leak of LIVE_SD_LEAKS) {
  test(`stripBodyWordFull removes "full" from the live string: ${leak.slice(0, 44)}…`, () => {
    assert.ok(!/\bfull\b/i.test(stripBodyWordFull(leak)), `still leaks: ${stripBodyWordFull(leak)}`);
  });
}

test('stripBodyWordFull handles an intervening adjective by DROPPING "full", not substituting', () => {
  // "natural $1" on "full natural bust" would have produced "natural natural bust".
  assert.equal(stripBodyWordFull('full natural bust'), 'natural bust');
  assert.equal(stripBodyWordFull('full round lifted glutes'), 'round lifted glutes');
});

test('stripBodyWordFull still substitutes when "full" is the only adjective', () => {
  assert.equal(stripBodyWordFull('full hips'), 'natural hips');
  assert.equal(stripBodyWordFull('full bust'), 'natural bust');
});

test('stripBodyWordFull covers "glutes" — the noun the live FULL_SIDE template used', () => {
  // rosalia's toolRules.sd.frameTypeTemplates.FULL_SIDE says "full glutes/hips" and the
  // old noun list did not contain "glutes" at all.
  assert.ok(!/\bfull\b/i.test(stripBodyWordFull('full glutes/hips')));
});

test('stripBodyWordFull is case-insensitive and preserves a sentence-opening capital', () => {
  // The operator copy-pastes this box verbatim, so a lowercase opener is a regression.
  assert.match(stripBodyWordFull('Full natural bust + snatched waist.'), /^Natural bust/);
});

test('stripBodyWordFull NEVER touches the framing terms "full body/frame/length"', () => {
  // These are camera framing, not body amplification. rosalia's live cameraLines carry
  // "full body visible" — mangling it would corrupt a working prompt.
  for (const s of [
    'placed camera at hip height, full body visible, static',
    'full frame, full length shot',
  ]) assert.equal(stripBodyWordFull(s), s);
});

test('stripBodyWordFull does not mangle the idiom "full of natural curves"', () => {
  // A naive modifier-skipping pattern turns this into "of natural curves".
  assert.equal(stripBodyWordFull('she is full of natural curves'), 'she is full of natural curves');
});

test('stripBodyWordFull leaves "a full, naturally curvy figure" alone (comma breaks the phrase)', () => {
  assert.equal(stripBodyWordFull('a full, naturally curvy figure'), 'a full, naturally curvy figure');
});

test('stripBodyWordFull is idempotent', () => {
  const once = stripBodyWordFull(LIVE_SD_LEAKS[0]!);
  assert.equal(stripBodyWordFull(once), once);
});

// ─────────────────────────────────────────────────────────────
// DEFECT 2 — item 23: the hold-body directive
// ─────────────────────────────────────────────────────────────

test('ensureBodyHold appends the item-23 directive', () => {
  const out = ensureBodyHold('She stirs the pot and laughs.');
  assert.ok(out.endsWith(BODY_HOLD_DIRECTIVE));
  assert.match(out, /do NOT slim, shrink, or distort her figure/);
});

test('ensureBodyHold is idempotent — never double-appends', () => {
  const once = ensureBodyHold('She stirs the pot.');
  assert.equal(ensureBodyHold(once), once);
  assert.equal((ensureBodyHold(once).match(/do NOT slim/gi) ?? []).length, 1);
});

test('ensureBodyHold sentinel survives a paraphrase (same failure mode as §5 secondary motion)', () => {
  // A lint-repair rewrite can reword the sentence; an exact-string check would stack a
  // second copy on top of the paraphrase.
  const paraphrased = 'She stirs. Keep her body shape and proportions identical throughout.';
  assert.equal(ensureBodyHold(paraphrased), paraphrased);
});

test('ensureBodyHold adds sentence punctuation before appending', () => {
  assert.match(ensureBodyHold('She stirs the pot'), /pot\. Maintain her exact body/);
});

// ─────────────────────────────────────────────────────────────
// DEFECT 3 — item 6 vs item 43: framing translated at emit
// ─────────────────────────────────────────────────────────────

test('framingToAntiPortrait strips the banned tokens but KEEPS the source subject size', () => {
  const out = framingToAntiPortrait('waist-up, subject fills 50%')!;
  assert.ok(!PORTRAIT_FRAMING_TERM.test(out), `banned token survived: ${out}`);
  assert.match(out, /subject occupies ~50%/, 'source fidelity: the source number is preserved');
  assert.match(out, /NOT a portrait/);
  assert.match(out, /room visible/);
});

test('framingToAntiPortrait falls back to item 6’s ~40% when the source named no number', () => {
  assert.match(framingToAntiPortrait('waist-up')!, /subject occupies ~40%/);
});

test('framingToAntiPortrait returns clean framing completely untouched', () => {
  for (const s of ['wide shot, room visible', 'over-the-shoulder, subject off-center', '']) {
    assert.equal(framingToAntiPortrait(s), s);
  }
  assert.equal(framingToAntiPortrait(undefined), undefined);
});

test('framingToAntiPortrait keeps the non-banned parts of a mixed framing string', () => {
  const out = framingToAntiPortrait('low angle, waist-up, subject fills 60%')!;
  assert.match(out, /low angle/);
  assert.ok(!PORTRAIT_FRAMING_TERM.test(out));
});

test('framingToAntiPortrait also handles "front angle"', () => {
  assert.ok(!PORTRAIT_FRAMING_TERM.test(framingToAntiPortrait('front angle, waist-up')!));
});

const sourceBeat = {
  shotSize: 'MS', framing: 'waist-up, subject fills 50%', cameraMove: 'static',
  startSec: 0, endSec: 11,
} as unknown as Beat;

test('ensureBeatCameraPhysics no longer injects banned framing (the live CAMERA(source) bug)', () => {
  // Live: "CAMERA(source): medium shot, waist-up, subject fills 50%, beat of ~11s" on all
  // three motionPrompts — injected AFTER the lint had run, so nothing caught it.
  const out = ensureBeatCameraPhysics('She leans in and tastes the sauce.', sourceBeat);
  assert.ok(!PORTRAIT_FRAMING_TERM.test(out), `banned framing injected: ${out}`);
  assert.match(out, /subject occupies ~50%/);
});

test('ensureBeatCameraPhysics keeps the shot-size token so lintFidelity still passes', () => {
  // lintFidelity independently requires SHOT_SIZE_TEXT[shotSize] to be physically present.
  assert.match(ensureBeatCameraPhysics('She leans in.', sourceBeat), /medium shot/);
});

test('ensureBeatCameraPhysics stays idempotent across the translation', () => {
  const once = ensureBeatCameraPhysics('She leans in.', sourceBeat);
  assert.equal(ensureBeatCameraPhysics(once, sourceBeat), once);
});

test('ensureBeatCameraPhysics does not stack a second framing when the source wording is already present', () => {
  // The information is present; the banned WORDING is the lint's job, not the injector's.
  // Appending the translated clause on top would leave two contradictory framings.
  const already = 'Medium shot, waist-up, subject fills 50%, static, beat of ~11s as she laughs.';
  assert.equal(ensureBeatCameraPhysics(already, sourceBeat), already);
});

// ── the unlinted nbPrompt surface ──

const PROFILE_FOR_LINT = {
  identityLock: { opener: 'Match the reference face exactly.', closer: 'Keep her identity unchanged.', strippedDescriptors: [] },
  toolRules: { nb: { bannedPhrases: [] } },
} as unknown as ModelProfile;

test('lintNbPrompt now flags portrait framing (the surface that was entirely unlinted)', () => {
  // Live: ideations[1].beats[0].nbPrompt = "…camera at chest height, waist-up framing,
  // subject occupies ~40%…" and nothing flagged it, because flagTell lived only in
  // lintMotionPrompt.
  const v = lintNbPrompt('Camera at chest height, waist-up framing, subject occupies ~40%.', PROFILE_FOR_LINT, 0);
  assert.equal(v.length, 1);
  assert.match(v[0]!.problem, /portrait-framing term "waist-up"/);
  assert.equal(v[0]!.field, 'nbPrompt');
});

test('lintNbPrompt portrait check is negation-aware — the house "NOT a portrait" style passes', () => {
  assert.deepEqual(lintNbPrompt('Environmental medium-wide, NOT a portrait, room visible.', PROFILE_FOR_LINT, 0), []);
});

test('lintNbPrompt leaves a clean anti-portrait nbPrompt alone', () => {
  assert.deepEqual(
    lintNbPrompt('Subject occupies ~32% of frame, off-center, lots of negative space, room visible.', PROFILE_FOR_LINT, 0),
    [],
  );
});

// ─────────────────────────────────────────────────────────────
// CHAIN-LEVEL — an injector test alone stays green if the chain stops calling it
// ─────────────────────────────────────────────────────────────

function chainFixture(): { ideation: Ideation; profile: ModelProfile; dna: FormatDna } {
  const srcBeat = {
    index: 1, clipIndex: 0, startSec: 0, endSec: 11,
    action: 'she leans over the pan and tastes the sauce',
    rightHand: 'holds the spoon', leftHand: 'steadies the pan',
    cameraMove: 'static', framing: 'waist-up, subject fills 50%',
    expressionEnergy: 'warm amusement', startsOnCut: true,
    shotSize: 'MS', cameraAngle: 'eye', shotType: 'aroll',
    motionBeat: 'she rocks back as the steam hits her',
  };
  const ideation = {
    title: 'Abuela salsa test', angle: 'family taste test', videoFormat: 'ONE_SHOT',
    clipCount: 1, targetDurationSec: 11, status: 'draft',
    videoModel: { choice: 'kling_3', reason: 'test' },
    audioPlan: { type: 'trending_audio', description: 'trending audio over the take' },
    beats: [{
      clipIndex: 0, durationSec: 11, sdFrameType: 'UPPER_BODY', shotType: 'aroll',
      action: 'she tastes the sauce',
      motionPrompt: 'She leans over the pan and tastes the sauce, then rocks back as the steam hits her.',
      nbPrompt: 'She stands in a warm kitchen, both feet flat, holding a wooden spoon.',
      sdPrompt: 'Full natural bust + snatched waist, off-shoulder embroidered blouse, warm kitchen behind.',
      firstFrameSource: 'fresh_nb', sourceBeatIndex: 0, sourceBeatIndices: [0],
    }],
    qaChecklist: { sdChecks: [], nbChecks: [], videoChecks: [] },
  } as unknown as Ideation;
  const profile = {
    id: 'test', identityLock: {
      opener: 'Match the reference face exactly.', closer: 'Keep her identity unchanged.',
      strippedDescriptors: [],
    },
    body: { leadDescriptor: 'match her locked body shape exactly', build: 'fit curvy', proportions: 'hourglass' },
    voice: { accent: 'warm Mexican-Spanish lilt', captionStyle: 'x', overlayStyle: 'x', bannedWords: [], exampleOverlays: [] },
    looks: {}, world: {},
    toolRules: {
      video: { bannedWords: [], cameraLines: {}, confirmedWorkingExamples: [] },
      nb: { bannedPhrases: [], structureNotes: '' },
      sd: { frameTypeTemplates: { UPPER_BODY: 'Natural bust, snatched waist, [clothing], [background].' } },
    },
  } as unknown as ModelProfile;
  const dna = {
    id: 'fmt', title: 'Spicy Chili Mom Test Fail', archetype: 'skit', formatType: 'skit',
    beats: [srcBeat],
    camera: { setup: 'propped_on_surface' },
    pacing: { totalDurationSec: 11, cutCount: 0, isOneShot: true, rhythm: 'single take', energy: 'warm' },
    audio: { kind: 'trending_audio', trendingSoundDependent: true, roomTone: 'kitchen hum' },
    aesthetic: { promptAnchor: 'raw iPhone footage, ungraded', realismMarkers: [] },
    setting: { locationType: 'home kitchen', timeOfDay: 'evening', lighting: 'warm overhead', keyProps: ['pan'], colorPalette: 'warm', mood: 'cosy' },
    wardrobeRole: { role: 'at-home cooking fit', garments: ['off-shoulder embroidered blouse'], stylingNotes: 'hair up' },
    hook: { type: 'visual', openingVisual: 'she tastes it' },
    whyItWorks: { mechanism: 'family comedy' },
    contentFlag: { rating: 'sfw' },
    source: { platform: 'instagram', durationSec: 11, clipCount: 1 },
  } as unknown as FormatDna;
  return { ideation, profile, dna };
}

test('CHAIN: every non-broll motionPrompt carries the item-23 directive exactly once', () => {
  const { ideation, profile, dna } = chainFixture();
  enforceIdeation(ideation, profile, dna, 'reproduce');
  for (const beat of ideation.beats) {
    const hits = (beat.motionPrompt.match(/do NOT slim, shrink, or distort her figure/gi) ?? []).length;
    assert.equal(hits, 1, `expected exactly 1 hold-body directive, got ${hits}: ${beat.motionPrompt}`);
  }
});

test('CHAIN: enforceIdeation is idempotent for the hold-body directive', () => {
  // The generator can re-enforce after a lint-repair rewrite; that must not stack.
  const { ideation, profile, dna } = chainFixture();
  enforceIdeation(ideation, profile, dna, 'reproduce');
  enforceIdeation(ideation, profile, dna, 'reproduce');
  for (const beat of ideation.beats) {
    assert.equal((beat.motionPrompt.match(/do NOT slim/gi) ?? []).length, 1, beat.motionPrompt);
  }
});

test('CHAIN: no emitted motionPrompt carries banned portrait framing, even in reproduce mode', () => {
  // reproduce mode is exactly where the CAMERA(source) injection put it live.
  const { ideation, profile, dna } = chainFixture();
  enforceIdeation(ideation, profile, dna, 'reproduce');
  for (const beat of ideation.beats) {
    assert.ok(
      !PORTRAIT_FRAMING_TERM.test(beat.motionPrompt),
      `banned portrait framing in emitted motionPrompt: ${beat.motionPrompt}`,
    );
  }
});

test('CHAIN: source framing survives semantically — subject size and shot size both present', () => {
  const { ideation, profile, dna } = chainFixture();
  enforceIdeation(ideation, profile, dna, 'reproduce');
  const p = ideation.beats[0]!.motionPrompt;
  assert.match(p, /subject occupies ~50%/, 'source subject size must survive the translation');
  assert.match(p, /medium shot/, 'source shot size must survive');
});

test('CHAIN: no emitted sdPrompt contains the banned body-word "full"', () => {
  const { ideation, profile, dna } = chainFixture();
  enforceIdeation(ideation, profile, dna, 'reproduce');
  for (const beat of ideation.beats) {
    assert.ok(!/\bfull\b/i.test(beat.sdPrompt), `sdPrompt leaks "full": ${beat.sdPrompt}`);
  }
});

// ─────────────────────────────────────────────────────────────
// The evidence file itself — guards against the artifact being replaced with a
// passing run, which would quietly destroy the reproduction case.
// ─────────────────────────────────────────────────────────────

test('the committed live artifact still exhibits all three ORIGINAL defects', () => {
  const art = JSON.parse(readFileSync(join(REPO_ROOT, ARTIFACT), 'utf8')) as {
    ideations: { beats: { motionPrompt: string; sdPrompt: string }[] }[];
  };
  const beats = art.ideations.flatMap((i) => i.beats);
  assert.equal(art.ideations.length, 3, 'artifact should hold the 3 recorded ideations');

  assert.ok(beats.some((b) => /\bfull\b/i.test(b.sdPrompt)), 'defect 1 evidence: an sdPrompt with "full"');
  assert.equal(
    beats.filter((b) => /do NOT slim|Maintain her exact body/i.test(b.motionPrompt)).length, 0,
    'defect 2 evidence: no motionPrompt carried the hold-body directive',
  );
  assert.ok(
    beats.some((b) => PORTRAIT_FRAMING_TERM.test(b.motionPrompt)),
    'defect 3 evidence: a motionPrompt with banned portrait framing',
  );
});

test('re-running the fixed strip over the artifact’s sdPrompts clears every leak', () => {
  const art = JSON.parse(readFileSync(join(REPO_ROOT, ARTIFACT), 'utf8')) as {
    ideations: { beats: { sdPrompt: string }[] }[];
  };
  for (const beat of art.ideations.flatMap((i) => i.beats)) {
    assert.ok(
      !/\bfull\b/i.test(stripBodyWordFull(beat.sdPrompt)),
      `still leaks after strip: ${stripBodyWordFull(beat.sdPrompt)}`,
    );
  }
});
