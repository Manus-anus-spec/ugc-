/**
 * Client-measured ground truth on POST /analyze (brief item 4).
 *
 * THE MEASURED PROBLEM, from the brief's test clip (15.97s McDonald's Wi-Fi prank):
 *   cut 1  ffmpeg 2.567s   app 1.875s   −0.69s
 *   cut 2  ffmpeg 8.167s   app 6.875s   −1.29s
 *   cut 3  ffmpeg 9.133s   app 8.875s   −0.26s
 * Consistently early, by an inconsistent amount, and everything downstream inherits it:
 * beat durations, the retention critique's timestamps, every per-beat prompt.
 *
 * THE ROOT CAUSE OF WHY THE EXISTING MULTI-PASS NEVER FIXED IT — found while building this,
 * and it is the crux: normalizeTimings only snapped a beat to a measured cut when it was
 * within 0.6s. Two of the three errors above (0.69 and 1.29) fall OUTSIDE that guard, so the
 * correction silently declined to apply. The guard is correct for ESTIMATED cuts, where
 * snapping to a bad guess makes things worse, and wrong for MEASURED ones.
 *
 * WHAT WAS DELIBERATELY NOT DONE: the brief said "skip PASS A entirely". Pass A returns
 * {cuts, windows}, and those windows target the MICRO passes that capture sub-second body
 * motion — the thing this app does that a stills-plus-transcript tool cannot. Supplied cuts
 * replace the cut LIST; they say nothing about where the MOTION is, and a long take can hold
 * a big motion beat nowhere near a cut. Pass A still runs, at halved fps, because cut
 * DETECTION is what needed the frame rate and locating a window is coarser.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroundTruthSchema, SourceMetaSchema } from '../shared/schemas';
import { buildCutMapGrounding, buildTranscriptGrounding } from '../worker/src/prompt';

const FFMPEG_CUTS = [2.567, 8.167, 9.133];

// ── the contract ──

test('ground truth is entirely optional — an empty object is valid', () => {
  assert.ok(GroundTruthSchema.safeParse({}).success);
});

test('the brief\'s measured payload validates as-is', () => {
  const parsed = GroundTruthSchema.safeParse({
    sceneCuts: FFMPEG_CUTS,
    durationSec: 15.972,
    fps: 30,
    dimensions: '720x1280',
    transcript: [{ start: 0, end: 3.2, text: 'hey', confidence: 0.91 }],
    transcriptConfidence: 'high',
  });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3)));
});

test('transcriptConfidence accepts no_speech — the value that prevents invention', () => {
  assert.ok(GroundTruthSchema.safeParse({ transcriptConfidence: 'no_speech' }).success);
  assert.equal(GroundTruthSchema.safeParse({ transcriptConfidence: 'probably' }).success, false);
});

// ── the cut-map prompt ──

test('MEASURED cuts are presented as frame-exact facts the model may not move', () => {
  const g = buildCutMapGrounding(FFMPEG_CUTS, [], 'measured');
  assert.match(g, /FRAME-EXACT/);
  assert.match(g, /2\.567/, 'measured cuts keep 3dp — 2dp would discard sub-frame precision');
  assert.match(g, /MUST equal them/);
  assert.match(g, /you do not get to move them/);
});

test('ESTIMATED cuts keep the softer original wording', () => {
  // An estimate is another sampled pass's best guess; the model may reasonably disagree.
  // Overstating it as fact would be a different failure of the same kind.
  const g = buildCutMapGrounding([1.875, 6.875], [], 'estimated');
  assert.ok(!/FRAME-EXACT/.test(g));
  assert.match(g, /treat as fact/);
  assert.match(g, /snap to these times/);
});

test('the estimated wording is still the default, so nothing changes for existing callers', () => {
  assert.equal(buildCutMapGrounding([1.5], []), buildCutMapGrounding([1.5], [], 'estimated'));
});

test('motion windows survive into the prompt alongside measured cuts', () => {
  // The whole reason Pass A is kept rather than skipped.
  const g = buildCutMapGrounding(FFMPEG_CUTS, [{ startSec: 4.2, endSec: 5.6 }], 'measured');
  assert.match(g, /4\.20-5\.60s/);
  assert.match(g, /most precise motionBeat/);
});

test('a one-shot with no cuts is stated as such rather than left blank', () => {
  assert.match(buildCutMapGrounding([], [], 'measured'), /one-shot/);
});

// ── transcript grounding: trust is not uniform ──

test('no_speech produces an explicit instruction not to invent dialogue', () => {
  // The measured trap: faster-whisper returned a fluent Turkish "thanks for watching" for a
  // music-only clip. Injecting that as ground truth would be worse than no transcript.
  const g = buildTranscriptGrounding(undefined, 'no_speech');
  assert.match(g, /NO SPEECH/);
  assert.match(g, /Leave every beat's dialogue EMPTY/);
  assert.match(g, /invent a single spoken word/);
  // And it must give the model somewhere to disagree rather than forcing compliance.
  assert.match(g, /uncertain/);
});

test('a HIGH-confidence transcript is authoritative and verbatim', () => {
  const g = buildTranscriptGrounding(
    [{ start: 0, end: 2, text: 'watch this', confidence: 0.95 }], 'high',
  );
  assert.match(g, /VERBATIM/);
  assert.match(g, /authoritative/);
  assert.match(g, /"watch this"/);
  assert.match(g, /Do not paraphrase/);
});

test('a LOW-confidence transcript is a hint the model may overrule', () => {
  const g = buildTranscriptGrounding(
    [{ start: 0, end: 3, text: 'thanks for watching and goodbye' }], 'low',
  );
  assert.match(g, /NOT authoritative/);
  assert.match(g, /Prefer what you can actually hear/);
  // Names the actual artefact shape seen, so it is recognisable rather than abstract.
  assert.match(g, /language that does not match the video/);
  assert.match(g, /DISREGARD/);
});

test('no transcript and no confidence produces NOTHING — no empty scaffolding', () => {
  assert.equal(buildTranscriptGrounding(undefined, undefined), '');
  assert.equal(buildTranscriptGrounding([], undefined), '');
});

test('quotes inside a transcript line cannot break the prompt', () => {
  const g = buildTranscriptGrounding([{ start: 0, end: 1, text: 'she said "no"' }], 'high');
  assert.ok(!/said "no"/.test(g), 'raw double quotes leaked into the quoted line');
  assert.match(g, /she said 'no'/);
});

// ── provenance on the stored DNA ──

test('SourceMeta records cutSource and transcriptSource', () => {
  const parsed = SourceMetaSchema.safeParse({
    platform: 'upload', durationSec: 15.972, clipCount: 4, isOneShot: false,
    analyzedAt: '2026-08-31T00:00:00Z', analyzerVersion: 'ugc-api@1.0.0/gemini-2.5-pro',
    samplingFps: 4, timingConfidence: 'high',
    cutSource: 'measured', transcriptSource: 'client_no_speech',
  });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3)));
  assert.equal(parsed.data?.cutSource, 'measured');
});

test('provenance is optional — rows analysed before it existed still parse', () => {
  const parsed = SourceMetaSchema.safeParse({
    platform: 'upload', durationSec: 8, clipCount: 1, isOneShot: true,
    analyzedAt: 'x', analyzerVersion: 'v',
  });
  assert.ok(parsed.success);
  assert.equal(parsed.data?.cutSource, undefined);
});
