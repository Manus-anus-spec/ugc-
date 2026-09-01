/**
 * OBJECT & PROP PHYSICS reality checks — what she DOES to things, and how they move.
 *
 * Character coherence was only half the problem. The bigger failure class is the OBJECT: an
 * effect with no visible cause, a tool that materialises mid-shot, a mass that moves as if it
 * weighs nothing, a prop that vanishes between clips. Video models render every one of those
 * happily, and each reads instantly as AI.
 *
 * The generator instruction has carried a PROP-PHYSICS LAW since item 43 — name the visible
 * nozzle, have the water already running at clip start, never spawn a knife — and nothing
 * enforced it. Exactly the same instruction-vs-enforcement gap as the humanization laws.
 *
 * ALL OF THESE ARE WARNINGS, and that is a design decision rather than caution: each check
 * reads one beat at a time and cannot see a source established in a neighbouring beat's first
 * frame. Blocking on them would burn Gemini calls on prompts that were fine. The
 * no-false-positive tests here carry more weight than the detection ones.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReality } from '../worker/src/generate/reality';
import type { FormatDna, Ideation } from '../shared/contract';

/** One beat, propped camera (occupies no hands, so hand rules stay out of the way). */
function oneBeat(motionPrompt: string) {
  const dna = {
    camera: { setup: 'propped_on_surface' },
    beats: [{ index: 0, rightHand: 'at her side', leftHand: 'at her side' }],
  } as unknown as FormatDna;
  const ideation = {
    index: 0,
    beats: [{ clipIndex: 0, durationSec: 8, sourceBeatIndex: 0, motionPrompt, nbPrompt: '' }],
  } as unknown as Ideation;
  return { ideation, dna };
}

/** Two beats with explicit observed hands, for the object-permanence check. */
function twoBeats(hands: [string, string][], prompts: [string, string]) {
  const dna = {
    camera: { setup: 'propped_on_surface' },
    beats: hands.map(([r, l], i) => ({ index: i, rightHand: r, leftHand: l })),
  } as unknown as FormatDna;
  const ideation = {
    index: 0,
    beats: prompts.map((motionPrompt, i) => ({
      clipIndex: i, durationSec: 5, sourceBeatIndex: i, motionPrompt, nbPrompt: '',
    })),
  } as unknown as Ideation;
  return { ideation, dna };
}

const kinds = (i: Ideation, d: FormatDna, kind: string) =>
  checkReality(i, d).filter((f) => f.kind === kind);

// ── effect without a cause ──

test('WARN: an emitted effect with no visible source', () => {
  const { ideation, dna } = oneBeat('Water sprays across the counter as she laughs.');
  const hit = kinds(ideation, dna, 'effect-without-cause')[0];
  assert.ok(hit, 'uncaused effect not flagged');
  assert.equal(hit.severity, 'warn');
  assert.match(hit.issue, /no visible source/);
});

test('NO false positive: the same effect WITH its source established', () => {
  // This is the phrasing the PROP-PHYSICS LAW actually asks for. Flagging it would punish
  // precisely the prompts that got it right.
  const { ideation, dna } = oneBeat('The hose nozzle is already running as water sprays across the counter.');
  assert.deepEqual(kinds(ideation, dna, 'effect-without-cause'), []);
});

test('NO false positive: pouring from an opened bottle', () => {
  const { ideation, dna } = oneBeat('She tilts the opened bottle and pours it into the glass.');
  assert.deepEqual(kinds(ideation, dna, 'effect-without-cause'), []);
});

// ── spawned tools ──

test('WARN: a tool that materialises mid-shot', () => {
  const { ideation, dna } = oneBeat('She slices the lime with a knife and drops it in.');
  const hit = kinds(ideation, dna, 'spawned-tool')[0];
  assert.ok(hit);
  assert.match(hit.issue, /appear from nowhere/);
});

test('NO false positive: a tool picked up first', () => {
  const { ideation, dna } = oneBeat('She reaches for the knife on the board and slices the lime.');
  assert.deepEqual(kinds(ideation, dna, 'spawned-tool'), []);
});

test('NO false positive: a tool already in her hand', () => {
  const { ideation, dna } = oneBeat('Already holding the spoon, she stirs the pan.');
  assert.deepEqual(kinds(ideation, dna, 'spawned-tool'), []);
});

// ── weight and inertia ──

test('WARN: mass lifted with no weight in the body', () => {
  const { ideation, dna } = oneBeat('She lifts the crate onto the counter and turns away.');
  const hit = kinds(ideation, dna, 'weightless-mass')[0];
  assert.ok(hit);
  assert.match(hit.issue, /weighs nothing/);
});

test('NO false positive: mass lifted WITH a weight cue', () => {
  const { ideation, dna } = oneBeat('She braces and lifts the crate with both hands, shifting her weight back.');
  assert.deepEqual(kinds(ideation, dna, 'weightless-mass'), []);
});

// ── object permanence across beats ──

test('WARN: held last beat, gone this beat, no release named', () => {
  const { ideation, dna } = twoBeats(
    [['holds the mug', 'at her side'], ['at her side', 'at her side']],
    ['She sips from the mug.', 'She looks toward the window.'],
  );
  const hit = kinds(ideation, dna, 'object-vanished')[0];
  assert.ok(hit, 'vanished object not flagged');
  assert.match(hit.issue, /vanish between clips/);
});

test('NO false positive: the object is put down explicitly', () => {
  const { ideation, dna } = twoBeats(
    [['holds the mug', 'at her side'], ['at her side', 'at her side']],
    ['She sips, then puts the mug down.', 'She looks toward the window.'],
  );
  assert.deepEqual(kinds(ideation, dna, 'object-vanished'), []);
});

test('NO false positive: the object is still held next beat', () => {
  const { ideation, dna } = twoBeats(
    [['holds the mug', 'at her side'], ['holds the mug', 'at her side']],
    ['She sips.', 'She sips again.'],
  );
  assert.deepEqual(kinds(ideation, dna, 'object-vanished'), []);
});

test('NO false positive: nothing was held to begin with', () => {
  const { ideation, dna } = twoBeats(
    [['at her side', 'at her side'], ['at her side', 'at her side']],
    ['She laughs.', 'She turns away.'],
  );
  assert.deepEqual(kinds(ideation, dna, 'object-vanished'), []);
});

test('NO false positive: handed off to someone else', () => {
  const { ideation, dna } = twoBeats(
    [['holds the mug', 'at her side'], ['at her side', 'at her side']],
    ['She hands the mug over.', 'She wipes the counter.'],
  );
  assert.deepEqual(kinds(ideation, dna, 'object-vanished'), []);
});

// ── the design constraint itself ──

test('every object-physics finding is a WARNING, never blocking', () => {
  // Each reads one beat and cannot see a source established in a neighbouring beat's first
  // frame, so blocking would burn Gemini calls on prompts that were fine.
  const { ideation, dna } = oneBeat('She lifts the crate, pours it out, and slices with a knife.');
  const objectKinds = ['effect-without-cause', 'spawned-tool', 'weightless-mass', 'object-vanished'];
  const found = checkReality(ideation, dna).filter((f) => objectKinds.includes(f.kind));
  assert.ok(found.length >= 2, 'expected several object findings on a deliberately bad prompt');
  for (const f of found) assert.equal(f.severity, 'warn', `${f.kind} must not block`);
});

test('a clean, physically coherent prompt produces no object findings at all', () => {
  const { ideation, dna } = oneBeat(
    'She reaches for the kettle already steaming on the hob, braces her wrist and pours slowly into the mug.',
  );
  const objectKinds = ['effect-without-cause', 'spawned-tool', 'weightless-mass', 'object-vanished'];
  assert.deepEqual(checkReality(ideation, dna).filter((f) => objectKinds.includes(f.kind)), []);
});
