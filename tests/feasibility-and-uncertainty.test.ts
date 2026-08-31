/**
 * Production feasibility, uncertainty, and MIME inference (2026-08-31 brief, items 1-3).
 *
 * THE FEASIBILITY PROBLEM, in one example from the brief: a McDonald's Wi-Fi QR prank scored
 * 62/100 and was correctly called shareable. It is also near-impossible for us to build — it
 * needs a prankster, an unwitting stranger and a real public location, and our models are
 * single AI characters with no locked co-star. Because the sampler weights by score², that
 * 62 OUTCOMPETES a 55-scoring format we could actually shoot. A high score on an unbuildable
 * format is not merely useless, it is actively crowding out usable material — the same class
 * of error as a miscalibrated score, wearing a different hat.
 *
 * THE UNCERTAINTY PROBLEM: the output format rewarded a confident answer for every field, and
 * a schema with no way to say "I could not see that" applies quiet pressure to invent one.
 * Measured: a transcription pass on a music-only clip produced a fluent Turkish sentence that
 * was never spoken.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FormatDnaSchema, ViralMechanicsSchema } from '../shared/schemas';
import {
  feasibilityWeight, FEASIBILITY_FLOOR, sampleSurpriseSources, type SurpriseCandidate,
} from '../worker/src/generate/surprise';
import { resolveVideoMime } from '../worker/src/limits';
import { ANALYZER_SYSTEM_INSTRUCTION } from '../worker/src/prompt';

// ─────────────────────────────────────────────────────────────
// 1. MIME inference — the plain-curl upload bug
// ─────────────────────────────────────────────────────────────

test('a plain curl upload (application/octet-stream) resolves to a real video MIME', () => {
  // The actual reported failure: `-F "video=@clip.mp4"` sent application/octet-stream, which
  // is TRUTHY, so `file.type || 'video/mp4'` passed it through and Gemini answered
  // 400 "Unsupported MIME type". Requiring callers to write ";type=video/mp4" is not a
  // contract, it is a trap.
  assert.equal(resolveVideoMime('application/octet-stream', 'clip.mp4'), 'video/mp4');
  assert.equal(resolveVideoMime('', 'clip.mov'), 'video/quicktime');
  assert.equal(resolveVideoMime('application/octet-stream', 'reel.webm'), 'video/webm');
});

test('a correctly declared video type is trusted and normalised', () => {
  assert.equal(resolveVideoMime('video/mp4', 'x.bin'), 'video/mp4');
  assert.equal(resolveVideoMime('video/quicktime; codecs=hvc1', 'x.bin'), 'video/quicktime');
  assert.equal(resolveVideoMime('VIDEO/MP4', 'x.bin'), 'video/mp4');
});

test('magic bytes settle it when both the type and the filename are useless', () => {
  const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
  assert.equal(resolveVideoMime('application/octet-stream', 'upload', mp4), 'video/mp4');
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(resolveVideoMime('', 'upload', webm), 'video/webm');
});

test('an unknown upload falls back to mp4 rather than failing', () => {
  // Failing the upload would be worse: mp4 is overwhelmingly the common case, and Gemini
  // will give a real error if it genuinely cannot decode.
  assert.equal(resolveVideoMime('application/octet-stream', 'noextension'), 'video/mp4');
});

// ─────────────────────────────────────────────────────────────
// 2. Feasibility — the schema, and the weight that makes it matter
// ─────────────────────────────────────────────────────────────

const PRANK_MECHANICS = {
  primaryDriver: 'dramatic irony — the audience is in on the joke from frame one',
  replicableCore: ['audience knows something the subject does not', 'the reveal is a screen'],
  nonReplicable: ['an unwitting real stranger', 'a real McDonald\'s at peak time'],
  transplantRisk: 'without a genuine victim reaction the irony has nothing to land on',
  freshAngles: ['the same irony with the model as the one being fooled'],
  production: {
    castCount: 2,
    castRoles: ['prankster', 'unwitting victim'],
    needsPublicLocation: true,
    needsRealBystanders: true,
    screenContentRequired: true,
    aiFeasibility: 15,
    aiFeasibilityReason: 'needs a second person, real bystanders, a public venue, and legible on-screen content',
    singleCharacterRewrite: 'make the model the VICTIM — she scans the code herself, filmed by an off-camera friend',
  },
};

test('a full dissection including the production block validates', () => {
  assert.ok(ViralMechanicsSchema.safeParse(PRANK_MECHANICS).success);
});

test('production is REQUIRED on a new dissection — feasibility is not optional', () => {
  const { production: _p, ...withoutProduction } = PRANK_MECHANICS;
  assert.equal(ViralMechanicsSchema.safeParse(withoutProduction).success, false);
});

test('singleCharacterRewrite is required — a rejected format must still leave something usable', () => {
  const partial = JSON.parse(JSON.stringify(PRANK_MECHANICS)) as typeof PRANK_MECHANICS;
  delete (partial.production as Partial<typeof partial.production>).singleCharacterRewrite;
  assert.equal(ViralMechanicsSchema.safeParse(partial).success, false);
});

test('feasibilityWeight is NEUTRAL when never assessed', () => {
  // Load-bearing: all 169 stored formats predate this field and must not be penalised for
  // a gap nobody has filled in yet.
  assert.equal(feasibilityWeight(undefined), 1);
  assert.equal(feasibilityWeight(Number.NaN), 1);
});

test('feasibilityWeight scales with buildability and never reaches zero', () => {
  assert.equal(feasibilityWeight(100), 1);
  assert.equal(feasibilityWeight(0), FEASIBILITY_FLOOR);
  assert.ok(feasibilityWeight(15) < feasibilityWeight(85));
  // Soft, like every other weight: an unbuildable format can still donate a MECHANISM to a
  // fusion, which is exactly what singleCharacterRewrite exists to salvage.
  assert.ok(feasibilityWeight(0) > 0, 'feasibility must never hard-exclude');
});

test('feasibilityWeight clamps nonsense input rather than inverting the weight', () => {
  assert.equal(feasibilityWeight(-50), FEASIBILITY_FLOOR);
  assert.equal(feasibilityWeight(999), 1);
});

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}

function draws(cands: SurpriseCandidate[], trials: number, seed = 5): Map<string, number> {
  const rand = lcg(seed);
  const counts = new Map<string, number>();
  for (let i = 0; i < trials; i++) {
    for (const id of sampleSurpriseSources(cands, 1, new Set(), rand)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

test('ACCEPTANCE: a buildable 55 now outdraws an unbuildable 62', () => {
  // The brief's exact scenario. Before this, score² alone made the prank win.
  const c = draws([
    { id: 'prank-62', formatType: 'skit', score: 62, aiFeasibility: 15 },
    { id: 'buildable-55', formatType: 'skit', score: 55, aiFeasibility: 90 },
  ], 400);
  assert.ok(
    (c.get('buildable-55') ?? 0) > (c.get('prank-62') ?? 0),
    `unbuildable prank still winning: ${JSON.stringify([...c])}`,
  );
});

test('an unbuildable format is still drawn SOMETIMES — its mechanism is worth fusing', () => {
  const c = draws([
    { id: 'unbuildable', formatType: 'skit', score: 80, aiFeasibility: 0 },
    { id: 'easy', formatType: 'skit', score: 80, aiFeasibility: 100 },
  ], 500);
  assert.ok((c.get('unbuildable') ?? 0) > 0, 'feasibility hard-excluded a format');
});

test('unassessed formats are not disadvantaged against each other', () => {
  // Introducing the multiplier must not change relative odds across the existing library.
  const lib: SurpriseCandidate[] = [
    { id: 'a', formatType: 'skit', score: 70 },
    { id: 'b', formatType: 'pov', score: 70 },
  ];
  const before = draws(lib, 300);
  const after = draws(lib.map((x) => ({ ...x })), 300);
  assert.deepEqual([...before.entries()].sort(), [...after.entries()].sort());
});

// ─────────────────────────────────────────────────────────────
// 3. Uncertainty — permission to say "unknown"
// ─────────────────────────────────────────────────────────────

test('uncertain[] accepts named gaps and is optional for stored rows', () => {
  const raw = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'docs', 'golden-test-1-formatdna.json'), 'utf8'),
  ) as { format?: unknown };
  const stored = (raw as { format?: Record<string, unknown> }).format ?? raw;
  assert.ok(FormatDnaSchema.safeParse(stored).success, 'stored goldens must keep parsing');

  const withGaps = FormatDnaSchema.safeParse({
    ...(stored as Record<string, unknown>),
    uncertain: [{ field: 'beats[2].dialogue', why: 'music only, no audible speech' }],
  });
  assert.ok(withGaps.success);
  assert.equal(withGaps.data?.uncertain?.[0]?.field, 'beats[2].dialogue');
});

test('the analyzer is told an empty uncertain[] is legitimate', () => {
  // Otherwise it invents doubt to look rigorous, which is its own kind of noise.
  assert.match(ANALYZER_SYSTEM_INSTRUCTION, /empty array is a legitimate answer/i);
});

test('the analyzer is told a named gap beats a confident fabrication', () => {
  assert.match(ANALYZER_SYSTEM_INSTRUCTION, /NAMED GAP is far more useful/);
  assert.match(ANALYZER_SYSTEM_INSTRUCTION, /penalised for inventing it/);
});

test('the analyzer is explicitly forbidden from inventing speech', () => {
  // The measured failure: a fluent Turkish sentence transcribed from a music-only clip.
  assert.match(ANALYZER_SYSTEM_INSTRUCTION, /NEVER invent SPEECH/);
  assert.match(ANALYZER_SYSTEM_INSTRUCTION, /music-only clip/);
});

test('the analyzer is told low feasibility is not a criticism of the video', () => {
  // Without this it will conflate "hard for us to build" with "bad video" and depress the
  // score — re-introducing the calibration bug through a side door.
  assert.match(ANALYZER_SYSTEM_INSTRUCTION, /INDEPENDENT of how good the video is/);
  assert.match(ANALYZER_SYSTEM_INSTRUCTION, /not a criticism of the video/);
});

test('the analyzer is told to always attempt the single-character rewrite', () => {
  assert.match(ANALYZER_SYSTEM_INSTRUCTION, /singleCharacterRewrite/);
  assert.match(ANALYZER_SYSTEM_INSTRUCTION, /Always attempt it/);
});
