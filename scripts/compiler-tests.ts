/**
 * Offline unit tests for the Layer-1 rule engines (FABLE5-PLAN Phase 4.2).
 * Run: npx tsx scripts/compiler-tests.ts
 */
import {
  applyBodyWrap, applySanitizeMap, chooseVideoModel, ensureCameraPhysics, lintMotionPrompt, lintNbPrompt,
  needsFaceForwardFix, wrapIdentityLock,
} from '../worker/src/generate/rules';
import type { ModelProfile } from '../shared/contract';
import { SAV_PROFILE, SEED_PROFILES } from '../worker/seeds/profiles';
import { ModelProfileSchema } from '../shared/schemas';
import type { FormatDna } from '../shared/contract';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) { failures++; console.error(`✗ ${name} ${detail}`); }
  else console.log(`✓ ${name}`);
}

// ── seed profiles validate against the contract ──
for (const p of SEED_PROFILES) {
  const r = ModelProfileSchema.safeParse(p);
  check(`profile ${p.id} validates`, r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3)));
}

// ── Kling-vs-CDance decision table (ports scanner:1858-1879) ──
check('dialogue → cdance', chooseVideoModel({ hasDialogue: true, clipCount: 1, durationSec: 8, emotionalRangeHigh: false }).choice === 'cdance_2');
check('multi-clip → cdance', chooseVideoModel({ hasDialogue: false, clipCount: 3, durationSec: 15, emotionalRangeHigh: false }).choice === 'cdance_2');
check('emotional → cdance', chooseVideoModel({ hasDialogue: false, clipCount: 1, durationSec: 8, emotionalRangeHigh: true }).choice === 'cdance_2');
check('simple one-shot → kling', chooseVideoModel({ hasDialogue: false, clipCount: 1, durationSec: 8, emotionalRangeHigh: false }).choice === 'kling_3');

// ── face-forward detection ──
const dnaFacingAway = {
  beats: [{ action: 'She walks away from the camera down the hallway' }],
  frames: [{ role: 'opening', scene: { subjectPlacement: 'center, back to camera', bodyPosition: 'standing' } }],
} as unknown as FormatDna;
const dnaFacing = {
  beats: [{ action: 'She looks directly into the lens and smiles' }],
  frames: [{ role: 'opening', scene: { subjectPlacement: 'center, facing camera 0°', bodyPosition: 'standing' } }],
} as unknown as FormatDna;
check('facing-away detected', needsFaceForwardFix(dnaFacingAway));
check('facing-camera passes', !needsFaceForwardFix(dnaFacing));

// ── motion lint ──
const v1 = lintMotionPrompt('She slowly turns, slowly smiles, flash illuminates her face', SAV_PROFILE, 'MULTI_CLIP', 0);
check('lint catches slowly×2 + flash', v1.some((v) => v.problem.includes('slowly')) && v1.some((v) => v.problem.includes('flash')), JSON.stringify(v1));
const v2 = lintMotionPrompt('x'.repeat(400), SAV_PROFILE, 'MULTI_CLIP', 0);
check('lint catches >310 chars (multi)', v2.some((v) => v.problem.includes('310')));
const v3 = lintMotionPrompt('x'.repeat(400), SAV_PROFILE, 'ONE_SHOT', 0);
check('one-shot allows 400 chars', !v3.some((v) => v.problem.includes('cap')));
const clean = lintMotionPrompt(SAV_PROFILE.toolRules.video.confirmedWorkingExamples[0]!, SAV_PROFILE, 'ONE_SHOT', 0);
check('confirmed working example passes lint', clean.length === 0, JSON.stringify(clean));

// ── NB identity-leak lint ──
const leak = lintNbPrompt('A platinum blonde half-brazilian girl smiles', SAV_PROFILE, 0);
check('identity leak caught', leak.length >= 2, JSON.stringify(leak));
check('clean NB passes', lintNbPrompt('The girl from the reference adjusts her scarf in the galley', SAV_PROFILE, 0).length === 0);

// ── identity-lock wrapping ──
const wrapped = wrapIdentityLock('She sips coffee at the terrace table.', SAV_PROFILE);
check('opener prepended', wrapped.startsWith(SAV_PROFILE.identityLock.opener));
check('closer appended', wrapped.endsWith(SAV_PROFILE.identityLock.closer));
const already = wrapIdentityLock(wrapped, SAV_PROFILE);
check('wrap is idempotent', already === wrapped);
check('wrapped prompt passes descriptor lint (closer mentions freckles legitimately)',
  lintNbPrompt(wrapped, SAV_PROFILE, 0).length === 0, JSON.stringify(lintNbPrompt(wrapped, SAV_PROFILE, 0)));

// ── self-contained motion: dialogue must live inside the motionPrompt ──
const dlg = 'wait till you see what he texted me';
const missing = lintMotionPrompt('Selfie angle with micro-shake, she laughs in the kitchen.', SAV_PROFILE, 'MULTI_CLIP', 0, dlg);
check('missing dialogue caught', missing.some((v) => v.problem.includes('dialogue')), JSON.stringify(missing));
const embedded = lintMotionPrompt(
  `Selfie angle with micro-shake, she smirks then laughs — she says, lips synced: "${dlg}" — kitchen counter behind her.`,
  SAV_PROFILE, 'MULTI_CLIP', 0, dlg,
);
check('embedded dialogue passes', !embedded.some((v) => v.problem.includes('dialogue')), JSON.stringify(embedded));
const longWithDialogue = lintMotionPrompt(`${'x'.repeat(400)} she says: "${dlg}"`, SAV_PROFILE, 'MULTI_CLIP', 0, dlg);
check('dialogue beat allows up to 600 chars', !longWithDialogue.some((v) => v.problem.includes('cap')), JSON.stringify(longWithDialogue));
const longNoDialogue = lintMotionPrompt('x'.repeat(400), SAV_PROFILE, 'MULTI_CLIP', 0);
check('no-dialogue beat still capped at 310', longNoDialogue.some((v) => v.problem.includes('310')));

// ── Seedream body wrap ──
const bodyProfile = {
  ...SAV_PROFILE,
  body: {
    build: 'fit hourglass, natural bust, toned waist',
    proportions: 'balanced bust-to-hip, defined waist',
    skin: 'natural texture with visible pores',
    sdEnhancementNotes: 'Enhance curves naturally within the outfit, keep proportions realistic.',
  },
} as ModelProfile;
const wrappedSd = applyBodyWrap('Enhance the outfit fit. Keep face and background exactly.', bodyProfile);
check('body wrap appended when missing', wrappedSd.includes('fit hourglass'), wrappedSd);
check('body wrap idempotent', applyBodyWrap(wrappedSd, bodyProfile) === wrappedSd);
check('no body section → unchanged', applyBodyWrap('Enhance the outfit fit.', SAV_PROFILE) === 'Enhance the outfit fit.');

// ── camera-physics enforcement ──
const dnaWithDynamics = {
  camera: { dynamics: { motionSignature: 'handheld selfie at arm\'s length, constant fine micro-shake, slow lateral sway' } },
} as unknown as FormatDna;
const dnaNoDynamics = { camera: {} } as unknown as FormatDna;
const bare = 'She spins in the kitchen and laughs, morning light through the window.';
const injected = ensureCameraPhysics(bare, dnaWithDynamics);
check('physics injected when absent', injected.startsWith('handheld selfie'), injected);
const hasPhysics = 'Placed camera, static locked-off, she walks into frame and poses.';
check('physics untouched when present', ensureCameraPhysics(hasPhysics, dnaWithDynamics) === hasPhysics);
check('no dynamics → unchanged', ensureCameraPhysics(bare, dnaNoDynamics) === bare);
check('physics injection idempotent', ensureCameraPhysics(injected, dnaWithDynamics) === injected);

// ── sanitize map ──
const sanitized = applySanitizeMap('she wears lingerie and a bikini, very sexy', SAV_PROFILE);
check('sanitize replaces terms', sanitized === 'she wears fitted intimate wear and a swimwear, very attractive', sanitized);

if (failures) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nALL COMPILER TESTS PASS');
