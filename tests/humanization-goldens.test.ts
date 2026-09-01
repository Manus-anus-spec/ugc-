/**
 * Phase 5 — humanization, validated with before/after golden prompts.
 *
 * Locked decision 1: HUMAN-BY-DEFAULT, no external paraphrase hop. Prompts must read human
 * straight out of rules.ts/prompt.ts.
 *
 * WHAT THIS FILE IS ACTUALLY GUARDING. worker/src/generate/prompt.ts already carries a
 * complete 12-law HUMANIZATION LAWS block, so the instruction layer was not the gap — the
 * ENFORCEMENT was. The lint knew five freeze words while the instruction banned nine, knew
 * six expression labels while law 1 bans naming expressions at all, and did not enforce law
 * 9's "never 'identical composition'" clause. Whenever the LLM ignored the instruction, the
 * extra terms shipped, because nothing downstream looked for them.
 *
 * THE FALSE-POSITIVE HALF MATTERS MORE THAN THE CATCHES. These lints feed a one-rewrite
 * repair loop on a PAID generation: a rule that fires on a good prompt burns a Gemini call
 * and can degrade a working prompt into a worse one. There is precedent in this repo — the
 * Jul 26 outage was naive substring matching making every Rosalia run fail on her own
 * profile's mandatory negation lines, an unwinnable rewrite loop. So every AFTER golden here
 * must lint to exactly ZERO violations, and the house-style patterns the laws deliberately
 * PRODUCE are asserted legal.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintMotionPrompt } from '../worker/src/generate/rules';
import type { ModelProfile } from '../shared/contract';

/** Minimal profile: no banned words of its own, so every violation seen here comes from the
 *  central humanization lint rather than per-profile configuration. */
const PROFILE = {
  toolRules: { video: { bannedWords: [] } },
} as unknown as ModelProfile;

const lint = (prompt: string): string[] =>
  lintMotionPrompt(prompt, PROFILE, 'ONE_SHOT', 0).map((v) => v.problem);

// ─────────────────────────────────────────────────────────────
// BEFORE → the AI-slop prompt every law exists to prevent
// ─────────────────────────────────────────────────────────────

const BEFORE = [
  'She stands frozen in the kitchen, motionless, holding the pose.',
  'Medium shot, waist-up, subject fills 60%, front angle, identical composition to the source.',
  'Her face shows pure disgust, then a confident smirk, then a shocked expression.',
  'She stares at the camera and maintains eye contact, perfectly still.',
  'She pauses for a beat with a look of shock, then freezes in place.',
].join(' ');

test('BEFORE: the slop golden trips the humanization lint', () => {
  const problems = lint(BEFORE);
  assert.ok(problems.length > 0, 'the slop prompt must not pass clean');
});

test('BEFORE: freeze language is caught', () => {
  assert.ok(lint(BEFORE).some((p) => /freeze-word/.test(p)), lint(BEFORE).join(' | '));
});

test('BEFORE: a named expression is caught', () => {
  assert.ok(lint(BEFORE).some((p) => /over-directed expression label/.test(p)));
});

test('BEFORE: portrait framing is caught', () => {
  assert.ok(lint(BEFORE).some((p) => /portrait-framing term/.test(p)));
});

test('BEFORE: "identical composition" is caught (law 9, previously unenforced)', () => {
  assert.ok(
    lint(BEFORE).some((p) => /flattens the shot into a portrait/.test(p)),
    lint(BEFORE).join(' | '),
  );
});

// Each newly-enforced term, individually — so a regression narrows the rule silently.
for (const term of [
  'motionless', 'perfectly still', 'freezes in place', 'holds the expression',
  'holds the pose', 'she pauses',
]) {
  test(`newly-enforced freeze term is caught: "${term}"`, () => {
    const problems = lint(`She works at the counter, ${term}, then reaches for the bowl.`);
    assert.ok(problems.some((p) => /freeze-word/.test(p)), `"${term}" not caught: ${problems.join(' | ')}`);
  });
}

for (const term of [
  'shocked face', 'shocked expression', 'look of disgust', 'look of horror', 'pure shock',
]) {
  test(`newly-enforced expression label is caught: "${term}"`, () => {
    const problems = lint(`She tries the sauce and gives a ${term} to the camera.`);
    assert.ok(
      problems.some((p) => /over-directed expression label/.test(p)),
      `"${term}" not caught: ${problems.join(' | ')}`,
    );
  });
}

// ─────────────────────────────────────────────────────────────
// AFTER → the same beats written human. MUST lint to zero.
// ─────────────────────────────────────────────────────────────

const AFTER_ONE_SHOT =
  'Keep the raw phone look of the first frame. She leans over the pan and tastes the sauce ' +
  'straight off the spoon, and as the heat lands her whole face opens up — she fans her mouth ' +
  'with the back of her hand, laughing, and reaches for the glass without looking. ' +
  'Environmental medium-wide, NOT a portrait, subject occupies ~40% of frame, off-center, the ' +
  'kitchen clearly visible behind her, camera at chest height with a slight downward tilt. ' +
  'Static handheld, only natural micro-shake. Her hair shifts as she turns toward the glass. ' +
  'Natural idle life throughout: she keeps blinking, a small breath in the shoulders, weight ' +
  'settling onto one hip, relaxed fingers. Ambient: extractor fan hum and a pan sizzling, ' +
  'phone mic, no background music.';

test('AFTER: the human golden lints to ZERO violations', () => {
  const problems = lint(AFTER_ONE_SHOT);
  assert.deepEqual(problems, [], `false positives on a good prompt: ${problems.join(' | ')}`);
});

/** Patterns the laws deliberately PRODUCE. If the lint flags these it is fighting its own
 *  instruction, which is exactly how a rewrite loop becomes unwinnable. */
const HOUSE_STYLE_MUST_PASS: [string, string][] = [
  [
    'law 2 held-beat continuation',
    'She holds the look for a moment, still blinking and breathing, then her eyes drift to the window.',
  ],
  [
    'law 2 "the music pauses" — audio, not a dead frame',
    'The track pauses on the beat as she steps into frame and keeps walking.',
  ],
  [
    'law 1 evocative-but-physical writing',
    'As the flavor hits, her face opens up and she ducks her chin, still chewing.',
  ],
  [
    'the noun "a heavy-lidded stare" — house style for the thirst lane, not a freeze',
    'She glances back over her shoulder with a heavy-lidded stare, then keeps moving toward the door.',
  ],
  [
    'law 9 relative layout wording',
    'Camera at chest height about 1.5m back, subject off-center at ~40% of frame, doorway visible behind her.',
  ],
  [
    'law 10 sourced camera move as real phone behavior',
    'A quick handheld pivot follows her, slight overshoot, then it settles; natural motion blur only during the fastest part.',
  ],
  [
    'law 4 bystander sequence',
    'Behind her a man briefly notices, takes a second glance, realizes he has been noticed and looks away, then keeps walking.',
  ],
  [
    'negated bans are the house style (NOT a portrait / no bokeh)',
    'NOT a portrait, NOT close-up, no bokeh, no cinematic grade — flat natural light, deep focus.',
  ],
];

for (const [label, prompt] of HOUSE_STYLE_MUST_PASS) {
  test(`NO FALSE POSITIVE: ${label}`, () => {
    const problems = lint(prompt);
    assert.deepEqual(problems, [], `flagged house style: ${problems.join(' | ')}`);
  });
}

test('the lint stays negation-aware for the newly-added terms', () => {
  // "never motionless" / "not frozen" are instructions TO the model, not violations.
  assert.deepEqual(lint('She is never motionless — she keeps shifting her weight.'), []);
  assert.deepEqual(lint('Not perfectly still: her shoulders keep breathing.'), []);
});

test('a clean prompt with no humanization terms at all lints clean', () => {
  assert.deepEqual(
    lint('She sets the mug down, wipes the counter, and glances toward the hallway as the dog barks.'),
    [],
  );
});
