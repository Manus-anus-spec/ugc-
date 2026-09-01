/**
 * REALITY CHECK — does the prompt describe something that could physically happen?
 *
 * THE GAP: every existing lint asks "is this phrased like AI?" — banned words, char caps,
 * freeze words, cinematizer terms, portrait framing, plastic-skin tells. None asked "could
 * this actually happen?". So a prompt could pass all of them and still describe both hands
 * busy while one hand holds the filming phone, or eight actions inside 1.4 seconds, or a
 * locked-off camera that also pans. Those generate — they just generate nonsense, and the
 * clip is paid for either way.
 *
 * THE RISK THIS FILE GUARDS, and it is the reason severity is split: the Jul 26 outage in this
 * repo was a lint that fired on GOOD prompts and produced an unwinnable rewrite loop. A false
 * 'blocking' finding costs a Gemini call and can degrade a working prompt. A false 'warn'
 * costs one line on a card. So every rule here is a presence/absence or counting test, and
 * anything with genuine ambiguity is a warning. The no-false-positive tests at the bottom
 * matter more than the detection tests above them.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReality, summariseReality } from '../worker/src/generate/reality';
import type { FormatDna, Ideation } from '../shared/contract';

function scene(opts: {
  setup?: string;
  cast?: unknown[];
  srcHands?: [string, string];
  beat?: Record<string, unknown>;
} = {}) {
  const dna = {
    camera: { setup: opts.setup ?? 'propped_on_surface', dynamics: { motionSignature: 'locked off' } },
    beats: opts.srcHands
      ? [{ index: 0, rightHand: opts.srcHands[0], leftHand: opts.srcHands[1] }]
      : [{ index: 0, rightHand: 'at her side', leftHand: 'at her side' }],
    ...(opts.cast ? { cast: opts.cast } : {}),
  } as unknown as FormatDna;

  const ideation = {
    index: 0,
    beats: [{
      clipIndex: 0, durationSec: 6, sourceBeatIndex: 0,
      motionPrompt: 'She leans over the pan and tastes the sauce.',
      nbPrompt: 'She stands in a warm kitchen.',
      ...(opts.beat ?? {}),
    }],
  } as unknown as Ideation;

  return { ideation, dna };
}

// ─────────────────────────────────────────────────────────────
// DETECTION
// ─────────────────────────────────────────────────────────────

test('BLOCKING: both hands busy while the setup needs one on the phone', () => {
  // The generator writes hands and camera independently, so this is a real and common clash.
  const { ideation, dna } = scene({
    setup: 'self_held_selfie',
    srcHands: ['holds the spoon', 'grips the pan handle'],
  });
  const f = checkReality(ideation, dna);
  const hit = f.find((x) => x.kind === 'hands-vs-camera')!;
  assert.ok(hit, JSON.stringify(f));
  assert.equal(hit.severity, 'blocking');
  assert.match(hit.issue, /BOTH hands are busy/);
});

test('BLOCKING: a static camera that also pans', () => {
  const { ideation, dna } = scene({
    beat: { motionPrompt: 'Static locked-off phone on the counter as it pans to follow her.' },
  });
  const hit = checkReality(ideation, dna).find((x) => x.kind === 'static-vs-move')!;
  assert.ok(hit);
  assert.equal(hit.severity, 'blocking');
});

test('BLOCKING: dialogue attributed to someone who is not in the scene', () => {
  // Only detectable since beat.speaker exists — before that a line had no owner at all.
  const { ideation, dna } = scene({ beat: { speaker: 'person_7', dialogue: 'hello' } });
  const hit = checkReality(ideation, dna).find((x) => x.kind === 'unknown-speaker')!;
  assert.ok(hit);
  assert.match(hit.issue, /person_7/);
});

test('BLOCKING: an off-camera person\'s line not marked VO would be lip-synced onto her', () => {
  const { ideation, dna } = scene({
    cast: [{ id: 'friend', role: 'friend filming', appearance: '', wardrobe: '', offCamera: true }],
    beat: { speaker: 'friend', dialogue: 'go on, try it' },
  });
  const hit = checkReality(ideation, dna).find((x) => x.kind === 'offcamera-lipsync')!;
  assert.ok(hit);
  assert.match(hit.issue, /wrong person/);
});

test('BLOCKING: a beat needing a second person when the format has no cast', () => {
  const { ideation, dna } = scene({
    beat: { motionPrompt: 'She films herself from behind as she walks away.' },
  });
  const hit = checkReality(ideation, dna).find((x) => x.kind === 'needs-second-person')!;
  assert.ok(hit);
  assert.equal(hit.severity, 'blocking');
});

test('WARN: too many actions for the beat length', () => {
  const { ideation, dna } = scene({
    beat: {
      durationSec: 1.4,
      motionPrompt: 'She walks, turns, sits, reaches, grabs, pours, drinks and laughs.',
    },
  });
  const hit = checkReality(ideation, dna).find((x) => x.kind === 'action-density')!;
  assert.ok(hit, 'dense beat not flagged');
  assert.equal(hit.severity, 'warn', 'action density is a smell, not a contradiction');
  assert.match(hit.issue, /smeared/);
});

test('WARN: a beat that depends on legible on-screen text', () => {
  // Not a prompt fault — a production instruction. Which is exactly why it warns and the
  // message says composite it, rather than asking for a rewrite that cannot help.
  const { ideation, dna } = scene({
    beat: { motionPrompt: 'She scans it and the phone screen reads FREE WIFI.' },
  });
  const hit = checkReality(ideation, dna).find((x) => x.kind === 'legible-text')!;
  assert.ok(hit);
  assert.equal(hit.severity, 'warn');
  assert.match(hit.issue, /composite/);
});

// ─────────────────────────────────────────────────────────────
// NO FALSE POSITIVES — the half that protects the rewrite loop
// ─────────────────────────────────────────────────────────────

test('a clean, ordinary prompt produces NOTHING', () => {
  const { ideation, dna } = scene();
  assert.deepEqual(checkReality(ideation, dna), []);
});

test('"no pans, no tilts" is a NEGATION, not a camera move', () => {
  // This exact phrasing is the house static-camera default that an injector appends to nearly
  // every prompt. Flagging it would fire on essentially the whole library.
  const { ideation, dna } = scene({
    beat: { motionPrompt: 'Static handheld, only natural micro-shake — no pans, no tilts, no zooms, no push-ins.' },
  });
  assert.deepEqual(checkReality(ideation, dna).filter((f) => f.kind === 'static-vs-move'), []);
});

test('one busy hand and one idle hand is fine on a selfie setup', () => {
  // The normal shape of a real selfie video, and the commonest thing this rule could ruin.
  const { ideation, dna } = scene({
    setup: 'self_held_selfie',
    srcHands: ['holds the phone', 'at her side'],
  });
  assert.deepEqual(checkReality(ideation, dna).filter((f) => f.kind === 'hands-vs-camera'), []);
});

test('both hands busy is fine when the camera is PROPPED', () => {
  // A propped phone occupies no hands, so both-hands-busy is not a contradiction at all.
  const { ideation, dna } = scene({
    setup: 'propped_on_surface',
    srcHands: ['stirs the pan', 'holds the bowl'],
  });
  assert.deepEqual(checkReality(ideation, dna).filter((f) => f.kind === 'hands-vs-camera'), []);
});

test('a VO-marked off-camera line does NOT trip the lip-sync check', () => {
  const { ideation, dna } = scene({
    cast: [{ id: 'friend', role: 'friend', appearance: '', wardrobe: '', offCamera: true }],
    beat: { speaker: 'friend', dialogue: 'VO (off-camera voiceover — never lip-sync): go on' },
  });
  assert.deepEqual(checkReality(ideation, dna).filter((f) => f.kind === 'offcamera-lipsync'), []);
});

test('"subject" is always a valid speaker without needing a cast entry', () => {
  const { ideation, dna } = scene({ beat: { speaker: 'subject', dialogue: 'oh no' } });
  assert.deepEqual(checkReality(ideation, dna).filter((f) => f.kind === 'unknown-speaker'), []);
});

test('a second-person action is fine when the format HAS a cast', () => {
  const { ideation, dna } = scene({
    cast: [{ id: 'friend', role: 'friend filming', appearance: 'tall', wardrobe: 'hoodie' }],
    beat: { motionPrompt: 'Someone else films her from across the room.' },
  });
  assert.deepEqual(checkReality(ideation, dna).filter((f) => f.kind === 'needs-second-person'), []);
});

test('a normal action count in a normal beat length is not flagged', () => {
  const { ideation, dna } = scene({
    beat: { durationSec: 8, motionPrompt: 'She leans in, tastes it, and laughs.' },
  });
  assert.deepEqual(checkReality(ideation, dna).filter((f) => f.kind === 'action-density'), []);
});

test('a beat with no duration recorded is not flagged for density', () => {
  // Division by an absent duration must not invent a finding.
  const { ideation, dna } = scene({
    beat: { durationSec: undefined, motionPrompt: 'She walks, turns, sits, reaches, grabs.' },
  });
  assert.deepEqual(checkReality(ideation, dna).filter((f) => f.kind === 'action-density'), []);
});

test('an empty ideation produces no findings and does not throw', () => {
  const empty = { index: 0, beats: [] } as unknown as Ideation;
  assert.deepEqual(checkReality(empty, {} as unknown as FormatDna), []);
});

test('summariseReality counts blocking and warnings separately', () => {
  assert.equal(summariseReality([]), 'reality check: clean');
  const s = summariseReality([
    { beatIndex: 0, severity: 'blocking', kind: 'k', issue: 'i' },
    { beatIndex: 1, severity: 'warn', kind: 'k', issue: 'i' },
    { beatIndex: 2, severity: 'warn', kind: 'k', issue: 'i' },
  ]);
  assert.match(s, /1 blocking/);
  assert.match(s, /2 warnings/);
});
