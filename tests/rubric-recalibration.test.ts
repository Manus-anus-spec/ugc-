/**
 * Rubric 3 — the virality recalibration.
 *
 * THE MEASURED PROBLEM. On the live library: 169 formats, mean score 50.7, only 4 at 80+, and
 * 69 of them (41%) under 40 — for a set Khian hand-picked BECAUSE the videos already
 * performed. The 159 scored from actual video averaged 49.5 while the 10 scored from text DNA
 * averaged 69.3, so the two internal paths disagreed by ~20 points.
 *
 * THE CAUSE was the rubric's prior, not the videos. It was written to answer "would this go
 * viral?" about an unknown video — "assume this video will flop", "when torn between two
 * scores ALWAYS take the lower", "almost never award" the top band. Applied to a corpus of
 * proven winners, that produces systematic depression.
 *
 * WHY IT MATTERS MECHANICALLY: the surprise sampler weights by score SQUARED, so a format
 * scored 35 is drawn ~a quarter as often as one scored 70. A wrongly-low score does not just
 * mislabel a blueprint, it buries it — which is a direct cause of weak ideations.
 *
 * WHAT THIS FILE GUARDS. Recalibration is NOT permission to inflate, and the honest half is
 * easy to erode later: the rubric must still refuse credit for polish, still demand timestamped
 * evidence, still score weak mechanics low, and still refuse to invent performance data it was
 * never given. Both halves are asserted. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUBRIC_VERSION } from '../shared/schemas';
import { VIRALITY_SYSTEM_INSTRUCTION } from '../worker/src/prompt';

test('rubric is on version 3', () => {
  assert.equal(RUBRIC_VERSION, '3');
});

// ── what the recalibration REMOVED ──

test('the always-take-the-lower tie-break is gone', () => {
  assert.ok(
    !/ALWAYS take the lower/.test(VIRALITY_SYSTEM_INSTRUCTION),
    'the downward tie-break is still present — it compounds across six dimensions',
  );
  assert.match(VIRALITY_SYSTEM_INSTRUCTION, /take the one the EVIDENCE supports/);
});

test('the blanket "assume this will flop" prior is gone', () => {
  assert.ok(!/Assume this video will flop/.test(VIRALITY_SYSTEM_INSTRUCTION));
  assert.match(VIRALITY_SYSTEM_INSTRUCTION, /judge the MECHANISMS THAT ARE PRESENT/);
});

test('the top band is no longer described as effectively unreachable', () => {
  assert.ok(!/almost never award this/.test(VIRALITY_SYSTEM_INSTRUCTION));
});

test('the rubric explains WHY a wrongly-low score is expensive', () => {
  // If this reasoning is lost, a future editor will "helpfully" restore the pessimism —
  // it reads like rigour. The score² sampling consequence is the whole justification.
  assert.match(VIRALITY_SYSTEM_INSTRUCTION, /score SQUARED/);
  assert.match(VIRALITY_SYSTEM_INSTRUCTION, /SYMMETRIC/);
});

// ── what the recalibration deliberately KEPT (the honest half) ──

test('no credit for polish — beautiful and boring still scores as boring', () => {
  assert.match(VIRALITY_SYSTEM_INSTRUCTION, /NO CREDIT for production polish/);
});

test('scores above 70 still require timestamped mechanism evidence', () => {
  assert.match(VIRALITY_SYSTEM_INSTRUCTION, /must cite a timestamp and a mechanism/);
});

test('the survival-curve discipline survives', () => {
  assert.match(VIRALITY_SYSTEM_INSTRUCTION, /owes it NOTHING/);
  assert.match(VIRALITY_SYSTEM_INSTRUCTION, /survival curve/);
  // The "once the viewer gets to 0:08…" ban is the concrete form of the discipline: most
  // viewers never get there, so reasoning that assumes they did is invalid.
  assert.match(VIRALITY_SYSTEM_INSTRUCTION, /invalid reasoning/);
});

test('weak mechanics must STILL be scored low — recalibration is not inflation', () => {
  assert.match(VIRALITY_SYSTEM_INSTRUCTION, /still say so plainly and score low/);
  assert.match(VIRALITY_SYSTEM_INSTRUCTION, /just as useless as one full of deflated ones/);
});

test('the rubric must NEVER invent performance data', () => {
  // Khian's call, and the right one: handing the app a view count defeats the purpose —
  // it has to read virality from the video. The recalibration must not smuggle in an
  // outcome-based shortcut through the back door.
  assert.match(VIRALITY_SYSTEM_INSTRUCTION, /no view counts and you must never invent or assume any/);
  assert.match(VIRALITY_SYSTEM_INSTRUCTION, /score only what the DNA shows/);
});

test('content policing is still not a scoring dimension', () => {
  // Load-bearing for this library specifically: half of it is attractiveness-driven.
  assert.match(VIRALITY_SYSTEM_INSTRUCTION, /CONTENT POLICING IS NOT A DIMENSION/);
});

test('the score bands still exist and still span the full range', () => {
  for (const band of ['0-20', '21-40', '41-60', '61-75', '76-89', '90-100']) {
    assert.ok(VIRALITY_SYSTEM_INSTRUCTION.includes(band), `band ${band} missing`);
  }
});

test('the Four-S hook evaluation from rubric 2 survived the rubric-3 edit', () => {
  // Two edits to the same prompt in one session; neither should have clobbered the other.
  assert.match(VIRALITY_SYSTEM_INSTRUCTION, /FOUR S/);
  assert.match(VIRALITY_SYSTEM_INSTRUCTION, /HOOK CHANNELS/);
});
