/**
 * Offline unit tests for the Layer-1 rule engines (FABLE5-PLAN Phase 4.2).
 * Run: npx tsx scripts/compiler-tests.ts
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyBodyWrap, applyModelPositionBlocks, applySanitizeMap, autofixNbSlop, buildPostProcessing,
  buildProductionRoute, buildTrim, chooseVideoModel, ensureAesthetic, ensureBeatCameraPhysics,
  ensureCameraPhysics, ensureContinuity, ensureDialogueEmbedded, ensureMicroExpression, ensureMotionCadence,
  applyEditPlanFidelity, applyUniversalSanitize, buildDefaultContinuityLock, buildSegmentPlanText,
  ensureNbRealism, ensureSecondaryMotion, ensureSegmentTimeline, ensureSkinTexture, planSegments,
  lintFidelity, lintMotionPrompt, lintNbPrompt, lintPlasticTells, motionCharCap,
  needsFaceForwardFix, stripIdentityDescriptors, wrapIdentityLock,
  KLING_HANDHELD_TAIL, applySeedanceLeanTail,
  ensureIdleBehavior, ensureAmbientSound, ensureStaticCameraDefault, stripBodyWordFull, ensureAccentDelivery,
  sanitizeImageModeration,
} from '../worker/src/generate/rules';
import { BELLE_PROFILE } from '../worker/seeds/profiles';
import type { Beat, ContinuityLock, FormatDna, Ideation, ModelProfile } from '../shared/contract';
import { SAV_PROFILE, SEED_PROFILES } from '../worker/seeds/profiles';
import { FormatDnaSchema, ModelProfileSchema } from '../shared/schemas';

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
// FABLE5 §6: Seedance 2.0 (cdance_2) is now the PRIMARY target — default for everything.
check('simple one-shot → seedance primary', chooseVideoModel({ hasDialogue: false, clipCount: 1, durationSec: 8, emotionalRangeHigh: false }).choice === 'cdance_2');
check('kling reachable as fallback seam', chooseVideoModel({ hasDialogue: false, clipCount: 1, durationSec: 8, emotionalRangeHigh: false, preferKling: true }).choice === 'kling_3');

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
const v2 = lintMotionPrompt('x'.repeat(1000), SAV_PROFILE, 'MULTI_CLIP', 0);
check('lint catches >900 chars (multi)', v2.some((v) => v.problem.includes('900')));
const v3 = lintMotionPrompt('x'.repeat(600), SAV_PROFILE, 'ONE_SHOT', 0);
check('one-shot allows 600 chars', !v3.some((v) => v.problem.includes('cap')));
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
const longWithDialogue = lintMotionPrompt(`${'x'.repeat(600)} she says: "${dlg}"`, SAV_PROFILE, 'MULTI_CLIP', 0, dlg);
check('dialogue beat allows up to 1100 chars', !longWithDialogue.some((v) => v.problem.includes('cap')), JSON.stringify(longWithDialogue));
const longNoDialogue = lintMotionPrompt('x'.repeat(1000), SAV_PROFILE, 'MULTI_CLIP', 0);
check('no-dialogue beat still capped at 900', longNoDialogue.some((v) => v.problem.includes('900')));

// ── cinematizer lint ──
const cine = lintMotionPrompt('Handheld iPhone footage, cinematic slow push-in as she turns.', SAV_PROFILE, 'MULTI_CLIP', 0);
check('positive "cinematic" caught', cine.some((v) => v.problem.includes('cinematizer')), JSON.stringify(cine));
const negated = lintMotionPrompt('Raw handheld iPhone footage, deep focus — NOT cinematic, no bokeh, she turns and laughs.', SAV_PROFILE, 'MULTI_CLIP', 0);
check('negated cinematizer words pass', !negated.some((v) => v.problem.includes('cinematizer')), JSON.stringify(negated));

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
const cleanSd = 'Fill the fitted dress with her curvy figure, snatched waist and full hips. Keep face and background exactly.';
check('clean sd prompt passes through unchanged', applyBodyWrap(cleanSd, bodyProfile, 'FULL_FRONT') === cleanSd, applyBodyWrap(cleanSd, bodyProfile, 'FULL_FRONT'));
check('body spec is NOT appended (no triplication)', !applyBodyWrap(cleanSd, bodyProfile, 'FULL_FRONT').includes('fit hourglass'));
const leaky = applyBodyWrap('Fill the dress with her full curves and snatched waist. Two-step pipeline: feed the locked body sheet ARCHETYPE.jpg alongside the source. Keep face and background exactly.', bodyProfile, 'FULL_FRONT');
check('operator meta / file paths stripped from prompt', !/\.jpg|two[- ]step pipeline|body sheet|ARCHETYPE/i.test(leaky), leaky);
check('empty sd falls back to frame template', applyBodyWrap('', bodyProfile, 'FULL_FRONT') === bodyProfile.toolRules.sd.frameTypeTemplates.FULL_FRONT);
check('no body section → meta-stripped passthrough', applyBodyWrap('Enhance the outfit fit.', SAV_PROFILE, 'FULL_FRONT') === 'Enhance the outfit fit.');

// ── footage-aesthetic enforcement ──
const dnaWithAesthetic = {
  camera: {},
  aesthetic: { promptAnchor: 'casual amateur iPhone front-camera vlog footage, raw ungraded look — NOT cinematic' },
} as unknown as FormatDna;
const cinematicish = 'She turns from the balcony rail as golden light washes over the scene.';
const anchored = ensureAesthetic(cinematicish, dnaWithAesthetic);
check('aesthetic anchor injected when absent', anchored.startsWith('casual amateur iPhone'), anchored);
const alreadyAmateur = 'Raw amateur iPhone selfie video, she laughs at the counter.';
check('aesthetic untouched when present', ensureAesthetic(alreadyAmateur, dnaWithAesthetic) === alreadyAmateur);
const noAesthetic = { camera: {} } as unknown as FormatDna;
check('no aesthetic in DNA → house default anchor', ensureAesthetic(cinematicish, noAesthetic).startsWith('Raw handheld iPhone footage'));
check('aesthetic injection idempotent', ensureAesthetic(anchored, dnaWithAesthetic) === anchored);

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

// ═══════════════════════ v3 filming-fidelity engine ═══════════════════════

const SRC_BEAT = {
  index: 1, clipIndex: 1, startSec: 2.0, endSec: 3.4,
  action: 'she laughs hard mid-stir', rightHand: 'stirring the pot', leftHand: 'brushes hair back',
  cameraMove: 'quick down-tilt to the pan', framing: 'waist-up, subject fills 60%',
  expressionEnergy: 'playful burst', startsOnCut: true,
  shotSize: 'MS', cameraAngle: 'eye', cutTransition: 'hard',
  motionBeat: 'chest bounces as she laughs',
  secondaryMotion: { hair: 'hair swings forward then settles', fabric: 'apron ripples', softBody: 'natural bounce through the laugh', accessories: 'none' },
  microExpression: 'blinks twice, gaze darts to the pan',
} as Beat;

// ── ensureContinuity ──
const LOCK: ContinuityLock = {
  setDescription: 'small sunlit farmhouse kitchen', wardrobeExact: 'sage-green ribbed tank, denim shorts',
  hairExact: 'loose waves, tucked left', lightingExact: 'window key camera-left', colorTempK: 'warm indoor ~3000K',
  timeOfDay: 'late morning', keyProps: ['cast-iron pot'],
};
const nbNoLock = 'She stirs the pot at the counter, smiling.';
const nbLocked = ensureContinuity(nbNoLock, LOCK);
check('continuity injected when missing', /CONTINUITY:/.test(nbLocked) && nbLocked.includes('sage-green ribbed tank'), nbLocked);
check('continuity injection idempotent', ensureContinuity(nbLocked, LOCK) === nbLocked);
check('no lock → unchanged', ensureContinuity(nbNoLock, undefined) === nbNoLock);

// ── ensureBeatCameraPhysics (per-beat, reproduce) ──
const bare2 = 'She laughs hard mid-stir, steam rising.';
const withCam = ensureBeatCameraPhysics(bare2, SRC_BEAT);
check('beat camera injected (shot size + move + duration)',
  /CAMERA\(source\):/.test(withCam) && withCam.includes('medium shot') && withCam.includes('down-tilt') && /~1\.4s/.test(withCam), withCam);
check('beat camera injection idempotent', ensureBeatCameraPhysics(withCam, SRC_BEAT) === withCam);
const fullCam = 'Medium shot, waist-up, subject fills 60%, quick down-tilt to the pan, hold ~1.4s as she laughs.';
check('beat camera untouched when all tokens present', ensureBeatCameraPhysics(fullCam, SRC_BEAT) === fullCam, ensureBeatCameraPhysics(fullCam, SRC_BEAT));
check('no source beat → unchanged', ensureBeatCameraPhysics(bare2, undefined) === bare2);

// ── ensureSecondaryMotion ──
const noSm = 'She turns to the camera and laughs, hold ~1.4s.';
const withSm = ensureSecondaryMotion(noSm, SRC_BEAT.secondaryMotion);
check('secondary motion injected from beat', withSm.includes('hair swings forward') && withSm.includes('apron ripples'), withSm);
check('secondary motion idempotent', ensureSecondaryMotion(withSm, SRC_BEAT.secondaryMotion) === withSm);
const defaulted = ensureSecondaryMotion(noSm, undefined);
check('secondary motion default injected when beat has none', /Secondary motion/.test(defaulted), defaulted);
// FABLE5 §7: cap at 1–2 cues — the default must never stack more than two clauses.
check('secondary motion default capped at ≤2 cues', (defaulted.split('Secondary motion')[1]?.split(/[;,]/).length ?? 0) <= 2, defaulted);
const alreadySm = 'Her hair swings as she spins, skirt sways with the turn.';
check('secondary motion untouched when present', ensureSecondaryMotion(alreadySm, SRC_BEAT.secondaryMotion) === alreadySm);

// ── ensureMicroExpression ──
const faceBeat = ensureMicroExpression('Waist-up selfie angle, she talks to the lens.', 'waist-up, subject fills 60%', SRC_BEAT.microExpression);
check('micro-expression injected on face beat', /blink/i.test(faceBeat), faceBeat);
check('micro-expression idempotent', ensureMicroExpression(faceBeat, 'waist-up', SRC_BEAT.microExpression) === faceBeat);
const backShot = 'Wide shot from behind, she walks away down the hallway.';
check('non-face beat untouched', ensureMicroExpression(backShot, 'full body from behind', undefined) === backShot);

// ── ensureMotionCadence ──
const cadenced = ensureMotionCadence('She spins once in the kitchen.');
check('cadence tail appended', /no frame interpolation, no slow-motion/.test(cadenced), cadenced);
check('cadence idempotent', ensureMotionCadence(cadenced) === cadenced);

// ── applyModelPositionBlocks ──
const klinged = applyModelPositionBlocks('Raw iPhone look, she stirs and laughs.', 'kling_3');
check('kling handheld block appended LAST', klinged.trimEnd().replace(/\.$/, '').toLowerCase().endsWith(KLING_HANDHELD_TAIL), klinged);
const midBlock = `Raw iPhone look, ${KLING_HANDHELD_TAIL}, she stirs and laughs at the counter.`;
const klingMoved = applyModelPositionBlocks(midBlock, 'kling_3');
check('kling block MOVED to end when mid-prompt', klingMoved.trimEnd().replace(/\.$/, '').toLowerCase().endsWith(KLING_HANDHELD_TAIL), klingMoved);
// FABLE5 §6 lean mode: the Seedance production path is applySeedanceLeanTail (used in
// enforceIdeation) — ONE consolidated line, NO obsolete "no smoothness/no stabilization".
const dnaLean = { setting: { locationType: 'kitchen' } } as unknown as FormatDna;
const leanTail = applySeedanceLeanTail('Raw iPhone look, she stirs the pot and grins.', dnaLean, undefined);
check('seedance lean tail: no obsolete stabilization pair', !/no smoothness|no stabilization/i.test(leanTail), leanTail);
check('seedance lean tail: single negatives line with subtitle+watermark+music bans', /no music/i.test(leanTail) && /subtitles/i.test(leanTail) && /no watermark/i.test(leanTail), leanTail);
check('seedance lean tail: carries phone-mic audio + derived ambient', /phone-mic audio/i.test(leanTail), leanTail);
check('seedance lean tail idempotent', applySeedanceLeanTail(leanTail, dnaLean, undefined) === leanTail);
// Legacy direct cdance path (applyModelPositionBlocks) also drops the obsolete negation pair.
const cdanced = applyModelPositionBlocks('Raw iPhone look, she grins.', 'cdance_2');
check('legacy cdance path drops the obsolete negation pair', !/no smoothness, no stabilization/i.test(cdanced), cdanced);

// ── skin texture + plastic tells (Part F) ──
const sdSkin = ensureSkinTexture('Fill the fitted dress with her curvy figure. Keep face and background exactly.');
check('SD skin clause appended', /visible pores/.test(sdSkin) && /not airbrushed/.test(sdSkin), sdSkin);
check('SD skin clause idempotent', ensureSkinTexture(sdSkin) === sdSkin);
check('plastic tell "perfect skin" caught', lintPlasticTells('flawless look with perfect skin and glowing catchlight', 'sdPrompt', 0).length >= 1);
check('"perfect timing" is NOT a plastic tell', lintPlasticTells('she nails the perfect timing on the beat drop', 'nbPrompt', 0).length === 0);
check('autofix neutralizes poreless/flawless', !/poreless|flawless/i.test(autofixNbSlop('flawless poreless smooth skin glow')));

// ── NB realism bake ──
const dnaWithTells = {
  camera: {}, aesthetic: {
    promptAnchor: 'x', grade: 'raw ungraded, warm indoor auto-exposure',
    realismTells: ['sensor-noise-in-shadows', 'imperfect-headroom'],
  },
} as unknown as FormatDna;
const nbBaked = ensureNbRealism('She stands at the counter smiling.', dnaWithTells);
check('NB realism tells baked with grade', /Shot look:/.test(nbBaked) && /sensor grain/.test(nbBaked) && /imperfect headroom/.test(nbBaked), nbBaked);
check('NB realism idempotent', ensureNbRealism(nbBaked, dnaWithTells) === nbBaked);

// ── short anchor preference ──
const dnaShortAnchor = {
  camera: {}, aesthetic: { promptAnchor: 'a'.repeat(200), promptAnchorShort: 'raw handheld iPhone vlog, ungraded, NOT cinematic' },
} as unknown as FormatDna;
check('promptAnchorShort preferred over long anchor',
  ensureAesthetic('She turns from the rail.', dnaShortAnchor).startsWith('raw handheld iPhone vlog'));

// ── caps: reproduce mode ──
check('reproduce multi cap = 1100', motionCharCap('MULTI_CLIP', false, 'reproduce') === 1100);
check('reproduce dialogue cap = 1300', motionCharCap('MULTI_CLIP', true, 'reproduce') === 1300);
check('adapt caps', motionCharCap('MULTI_CLIP', false) === 900 && motionCharCap('MULTI_CLIP', true) === 1100);
check('lint honors reproduce cap', !lintMotionPrompt('x'.repeat(650), SAV_PROFILE, 'MULTI_CLIP', 0, undefined, 'reproduce').some((v) => v.problem.includes('cap')));

// ── trim map + post-processing (Part G) ──
const trim = buildTrim(1.4, 2.0, [{ atSec: 3.35, kind: 'downbeat' }, { atSec: 5.1, kind: 'drop' }]);
check('trim generates ≥5s (Kling floor)', trim.generatedDurationSec >= 5, String(trim.generatedDurationSec));
check('trim slice window matches clip duration', Math.abs((trim.useOutSec - trim.useInSec) - 1.4) < 0.01);
check('trim lands on beat (3.4 cut vs 3.35 downbeat)', trim.landsOnBeat && trim.cutOnBeatAtSec === 3.35, JSON.stringify(trim));
const trimOff = buildTrim(1.4, 2.0, [{ atSec: 4.5, kind: 'downbeat' }]);
check('trim flags off-beat cut', !trimOff.landsOnBeat);
const pp = buildPostProcessing(dnaWithTells);
check('post-processing derives from tells', pp.fps === 30 && /stronger in shadows/.test(pp.addGrain) && pp.reencodeProfile === 'phone-HEVC', JSON.stringify(pp));

// ── production route (Part B.7/G.1) ──
const heroRoute = buildProductionRoute(0, 'hero_still', 'kling_3', false);
check('hero route: nb → sd → face_restore → kling', heroRoute.map((s) => s.tool).join(',') === 'nano_banana_2,seedream_4.5,face_restore,kling_3', heroRoute.map((s) => s.tool).join(','));
const chainRoute = buildProductionRoute(2, 'prev_clip_last_frame', 'cdance_2', true);
check('chained route: per-hop face check → video → lipsync', chainRoute.map((s) => s.tool).join(',') === 'face_restore,cdance_2,lipsync', chainRoute.map((s) => s.tool).join(','));
check('chained route names the drift check', /drift/.test(chainRoute[0]!.outputAsset));

// ── fidelity linter ──
const dnaTwoBeats = {
  camera: {}, beats: [SRC_BEAT, { ...SRC_BEAT, index: 2, clipIndex: 2, startSec: 3.4, endSec: 5.0 }],
  audio: { syncType: 'none' }, textOverlays: { present: false },
} as unknown as FormatDna;
const shortIdeation = { beats: [{ clipIndex: 0, durationSec: 1.4, action: 'laughs', motionBeat: 'bounce', motionPrompt: 'medium shot, hold ~1.4s, she blinks', dialogue: undefined }] } as unknown as Ideation;
// (the two same-scene beats above now merge into ONE segment — mismatch needs an
// unmergeable pair: camera angle change forces 2 segments vs the 1-beat ideation)
const dnaTwoSegs = {
  ...dnaTwoBeats,
  beats: [SRC_BEAT, { ...SRC_BEAT, index: 2, clipIndex: 2, startSec: 3.4, endSec: 5.0, cameraAngle: 'overhead' }],
} as unknown as FormatDna;
check('fidelity lint catches segment-count mismatch in reproduce',
  lintFidelity(shortIdeation, dnaTwoSegs, 'reproduce').some((v) => v.problem.includes('generation segments')));
check('same-scene beats merging means a 1-beat ideation is VALID for a 2-beat dna',
  !lintFidelity(shortIdeation, dnaTwoBeats, 'reproduce').some((v) => v.problem.includes('generation segments')));
const deadZone = { beats: [{ clipIndex: 0, durationSec: 4, action: 'stands', motionBeat: 'none', motionPrompt: 'she stands', dialogue: undefined }] } as unknown as Ideation;
check('fidelity lint catches >2s dead zone', lintFidelity(deadZone, dnaTwoBeats, 'adapt').some((v) => v.problem.includes('dead zone')));

// ── identity descriptor STRIP (Jul 26 fix — strip, don't brick the run) ──
const leakyNb = 'A young woman in a mexican-style kitchen laughs while plating tacos.';
const strippedNb = stripIdentityDescriptors(leakyNb, SAV_PROFILE);
check('descriptor strip removes leaked words', !lintNbPrompt(strippedNb, SAV_PROFILE, 0).some((v) => v.problem.includes('descriptor')) || lintNbPrompt(leakyNb, SAV_PROFILE, 0).length === 0, strippedNb);
const savLeak = 'A platinum blonde half-brazilian girl smiles at the counter.';
const savStripped = stripIdentityDescriptors(savLeak, SAV_PROFILE);
check('sav descriptors stripped clean', lintNbPrompt(savStripped, SAV_PROFILE, 0).length === 0, savStripped);
check('strip leaves no double spaces', !/\s{2}/.test(savStripped));

// ── micro-expression GUARANTEE (Jul 26 fix — own text without blink words gets the tail too) ──
const weakMicro = ensureMicroExpression('Waist-up selfie angle, she talks to the lens.', 'waist-up', 'eyes widen in delight');
check('micro guarantee: non-blink micro text still gets blink tail', /blink|gaze|breath/i.test(weakMicro) && /eyes widen/i.test(weakMicro), weakMicro);

// ── default continuity lock ──
const dnaForLock = {
  setting: { locationType: 'farmhouse kitchen', timeOfDay: 'morning', lighting: 'window light', keyProps: ['cast-iron pot'], colorPalette: '', mood: 'cozy' },
  wardrobeRole: { role: 'athleisure', garments: [], stylingNotes: '' },
  aesthetic: { colorTempK: 'warm ~3000K' }, camera: {},
} as unknown as FormatDna;
const defLock = buildDefaultContinuityLock(dnaForLock);
check('default continuity lock built from DNA', defLock.setDescription.includes('farmhouse kitchen') && defLock.colorTempK === 'warm ~3000K', JSON.stringify(defLock));

// ── v3.3 generation segments (Jul 27 — Khian's 0.88s-clips fix) ──
const mkBeat = (i: number, start: number, end: number, over: Record<string, unknown> = {}) =>
  ({ ...SRC_BEAT, index: i, clipIndex: i, startSec: start, endSec: end, ...over }) as Beat;
const fastBeats = [
  mkBeat(0, 0, 0.9), mkBeat(1, 0.9, 2.1), mkBeat(2, 2.1, 3.0), mkBeat(3, 3.0, 4.5),
  mkBeat(4, 4.5, 9.2, { cameraAngle: 'overhead' }), mkBeat(5, 9.2, 10.0),
];
const segs = planSegments(fastBeats);
check('sub-second beats merge into one take', segs.length === 3 && segs[0]!.beatIndices.join(',') === '0,1,2,3', JSON.stringify(segs));
check('camera-angle change breaks the segment', segs[1]!.beatIndices.join(',') === '4');
const longBeats = [mkBeat(0, 0, 3), mkBeat(1, 3, 6), mkBeat(2, 6, 9), mkBeat(3, 9, 12)];
const segsCap = planSegments(longBeats);
check('segment span capped at 8s source', segsCap.length === 2 && segsCap[0]!.beatIndices.join(',') === '0,1', JSON.stringify(segsCap));
const wsBeat = mkBeat(1, 0.9, 2.0, { shotSize: 'WS' });
check('ECU→WS shot jump breaks (no punch-in possible)', planSegments([mkBeat(0, 0, 0.9, { shotSize: 'ECU' }), wsBeat]).length === 2);
check('CU→MS merges (punch-in-able)', planSegments([mkBeat(0, 0, 0.9, { shotSize: 'CU' }), mkBeat(1, 0.9, 2.0, { shotSize: 'MS' })]).length === 1);

const bare3 = 'She cooks through the sequence, laughing between bites.';
const timed = ensureSegmentTimeline(bare3, fastBeats, [0, 1, 2, 3]);
// FABLE5 §6: Seedance-friendly PHASE-WORD flow ("First … then … finally …"), not "0.0-0.9s" timestamps
// (exact trim seconds live in editPlan.slices). The take must still carry N-1 ordered steps.
check('multi-beat take gets internal TIMELINE injected (phase-words)', /TIMELINE:/.test(timed) && /\bFirst,/.test(timed) && /\bfinally\b/.test(timed) && !/0\.0-0\.9s/.test(timed), timed);
check('timeline injection idempotent', ensureSegmentTimeline(timed, fastBeats, [0, 1, 2, 3]) === timed);
check('single-beat take untouched', ensureSegmentTimeline(bare3, fastBeats, [4]) === bare3);

const segDna = {
  camera: {}, beats: fastBeats, setting: { locationType: 'kitchen', timeOfDay: 'day', lighting: 'window', keyProps: [], colorPalette: '', mood: 'warm' },
  wardrobeRole: { role: 'casual', garments: [], stylingNotes: '' },
  audio: { beatMap: [{ atSec: 0.9, kind: 'downbeat' }, { atSec: 2.1, kind: 'accent' }, { atSec: 3.0, kind: 'downbeat' }, { atSec: 4.5, kind: 'drop' }] },
  loop: { isSeamless: false, mechanism: 'none' },
} as unknown as FormatDna;
const segIdeation = {
  beats: [{ clipIndex: 0, durationSec: 4.5, sourceBeatIndices: [0, 1, 2, 3], motionPrompt: 'x', nbPrompt: 'x', sdPrompt: 'x' }],
  editPlan: { clips: [{ clipIndex: 0, durationSec: 4.5, purpose: 'hook', transitionOut: 'hard' }], assembly: [] },
} as unknown as Ideation;
applyEditPlanFidelity(segIdeation, segDna);
const segClip = segIdeation.editPlan!.clips[0]!;
check('segment clip gets one slice per covered source beat', (segClip.slices ?? []).length === 4, JSON.stringify(segClip.slices));
check('slices tile the take (0.3 lead, contiguous)', segClip.slices![0]!.useInSec === 0.3 && segClip.slices![1]!.useInSec === 1.2, JSON.stringify(segClip.slices!.slice(0, 2)));
check('all slices share one generated take ≥5s', segClip.slices!.every((s) => s.generatedDurationSec === segClip.slices![0]!.generatedDurationSec && s.generatedDurationSec >= 5));
check('slice cuts land on the beat map', segClip.slices!.every((s) => s.landsOnBeat), JSON.stringify(segClip.slices));
check('segment plan text lists takes + timelines', buildSegmentPlanText(fastBeats, segs).includes('ONE continuous take') && buildSegmentPlanText(fastBeats, segs).includes('Segment 3'));

// ── mangled-marker re-injection (Jul 26 — rewrite echoed "CAMERA(source):" but dropped tokens) ──
const mangled = 'She laughs mid-stir. CAMERA(source): , hold ~1.4s.';   // marker survived, shot size lost
const reinjected = ensureBeatCameraPhysics(mangled, SRC_BEAT);
check('mangled CAMERA(source) block gets missing tokens re-injected', reinjected.toLowerCase().includes('medium shot'), reinjected);

// ── dialogue embed enforced, not asked (Jul 26) ──
const dlgLine = 'come taste this before I change my mind';
const noDlg = ensureDialogueEmbedded('Selfie angle, she stirs the pot and smirks at the lens.', dlgLine, 'cdance_2');
check('missing dialogue EMBEDDED (cdance double-quote style, §6)', noDlg.includes(`"${dlgLine}"`) && !noDlg.includes(`{${dlgLine}}`), noDlg);
check('embedded dialogue passes the self-contained lint',
  !lintMotionPrompt(noDlg, SAV_PROFILE, 'MULTI_CLIP', 0, dlgLine).some((x) => x.problem.includes('dialogue')), noDlg);
const hasDlg = `She grins — she says, lips synced: "${dlgLine}" — steam rising.`;
check('present dialogue untouched', ensureDialogueEmbedded(hasDlg, dlgLine, 'kling_3') === hasDlg);
check('dialogue embed idempotent', ensureDialogueEmbedded(noDlg, dlgLine, 'cdance_2') === noDlg);
check('no dialogue → unchanged', ensureDialogueEmbedded('She spins once.', undefined, 'kling_3') === 'She spins once.');

// ── NB banned phrases: negation-aware (Jul 26 — house style mandates "NOT professional photography") ──
const bannedNeg = SAV_PROFILE.toolRules.nb.bannedPhrases.find((p) => p.includes(' ')) ?? 'professional photography';
check('negated banned phrase passes NB lint',
  lintNbPrompt(`Raw iPhone footage aesthetic, candid kitchen scene — NOT ${bannedNeg}.`, SAV_PROFILE, 0).length === 0,
  JSON.stringify(lintNbPrompt(`Raw iPhone footage aesthetic — NOT ${bannedNeg}.`, SAV_PROFILE, 0)));
check('positive banned phrase still fails NB lint',
  lintNbPrompt(`Beautiful ${bannedNeg} of her at the counter.`, SAV_PROFILE, 0).some((x) => x.problem.includes('banned phrase')));
check('"no heavy makeup"-style negation passes',
  lintNbPrompt('Natural look, no heavy makeup, soft natural lighting.', SAV_PROFILE, 0).length === 0,
  JSON.stringify(lintNbPrompt('Natural look, no heavy makeup, soft natural lighting.', SAV_PROFILE, 0)));

// ── universal input sanitize (Jul 26 PROHIBITED_CONTENT fix) ──
const spicy = 'visible nipples protruding through tight fabric, braless, see-through top emphasizing breast contour and cleavage';
const tame = applyUniversalSanitize(spicy);
check('universal sanitize neutralizes all input-filter trippers',
  !/nipple|braless|see[- ]?through|breast|cleavage/i.test(tame), tame);
check('universal sanitize leaves normal text alone',
  applyUniversalSanitize('she stirs the pot in a tight pink crewneck') === 'she stirs the pot in a tight pink crewneck');

// ── LEGACY BACK-COMPAT: archived goldens (pre-v3 rows) must still parse ──
const repoRoot = join(new URL('.', import.meta.url).pathname, '..');
for (const f of ['docs/golden-test-1-formatdna.json', 'docs/golden-test-1-pro-formatdna.json']) {
  const p = join(repoRoot, f);
  check(`golden exists: ${f}`, existsSync(p));
  if (!existsSync(p)) continue;
  const data = JSON.parse(readFileSync(p, 'utf8')) as { format?: unknown };
  const r = FormatDnaSchema.safeParse(data.format ?? data);
  check(`legacy golden still parses: ${f}`, r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3)));
}
const goldensDir = join(repoRoot, 'docs/goldens');
if (existsSync(goldensDir)) {
  for (const f of readdirSync(goldensDir).filter((x) => x.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(join(goldensDir, f), 'utf8')) as { format?: unknown };
    const r = FormatDnaSchema.safeParse(data.format ?? data);
    check(`goldens/${f} still parses`, r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3)));
  }
}

// ── FABLE5 humanization injectors (§1–4, §7) ──
const idle = ensureIdleBehavior('She wipes the counter and glances at the lens.');
check('idle behavior appended', /idle motion|weight shift|no frozen pose/i.test(idle));
check('idle behavior idempotent', ensureIdleBehavior(idle) === idle);
check('idle block does not self-flag as a freeze-word (negated)', /no frozen pose between actions/i.test(idle));

const ambBar = ensureAmbientSound('She leans on the counter.', { setting: { locationType: 'the Rusty Spur honky-tonk', mood: 'rowdy' } } as unknown as FormatDna, undefined);
check('bar ambient derived', /murmur|clink|chatter/i.test(ambBar), ambBar);
const ambRanch = ensureAmbientSound('She sits on the step.', { setting: {} } as unknown as FormatDna, { setDescription: 'open Texas pasture at golden hour' } as ContinuityLock);
check('ranch ambient derived from continuity lock', /birds|breeze|animals/i.test(ambRanch), ambRanch);
check('ambient idempotent', ensureAmbientSound(ambBar, { setting: { locationType: 'bar' } } as unknown as FormatDna, undefined) === ambBar);

const staticCam = ensureStaticCameraDefault('She turns to the camera and laughs.');
check('static-camera default injected when no move present', /no pans, no tilts, no zooms/i.test(staticCam), staticCam);
check('static-camera default idempotent', ensureStaticCameraDefault(staticCam) === staticCam);
check('static-camera default NOT injected over a sourced pan', ensureStaticCameraDefault('Quick handheld pan right as she spins.') === 'Quick handheld pan right as she spins.');

check('strip "full" body-word', stripBodyWordFull('Shape the dress to her full hips and naturally full bust. Keep face.') === 'Shape the dress to her natural hips and naturally curvy bust. Keep face.');
check('"full body" framing preserved', stripBodyWordFull('Full body visible, feet in frame.') === 'Full body visible, feet in frame.');

const accented = ensureAccentDelivery('She says, lips synced: "you actually came".', 'you actually came', 'soft warm Texas drawl, not theatrical');
check('accent injected on spoken line', /Voice: soft warm Texas drawl/i.test(accented), accented);
check('accent idempotent (drawl sentinel)', ensureAccentDelivery(accented, 'you actually came', 'soft warm Texas drawl, not theatrical') === accented);
check('no accent when no dialogue', ensureAccentDelivery('She spins.', undefined, 'soft warm Texas drawl') === 'She spins.');

// ── FABLE5 §9 humanization LINT (Part 1.9) — fires on tells, never on good house style ──
const badFraming = lintMotionPrompt('Waist-up front angle, subject fills 60%, she turns.', SAV_PROFILE, 'MULTI_CLIP', 0);
check('lint fires on portrait framing (waist-up/fills 60%)', badFraming.some((x) => /portrait-framing/.test(x.problem)), JSON.stringify(badFraming));
const badFreeze = lintMotionPrompt('A man stares at her, then she holds still.', SAV_PROFILE, 'MULTI_CLIP', 0);
check('lint fires on freeze words (stares at / holds still)', badFreeze.some((x) => /freeze-word/.test(x.problem)), JSON.stringify(badFreeze));
const badExpr = lintMotionPrompt('She reacts with pure disgust then a confident smirk.', SAV_PROFILE, 'MULTI_CLIP', 0);
check('lint fires on over-directed expression labels', badExpr.some((x) => /over-directed expression/.test(x.problem)), JSON.stringify(badExpr));
// House style must NOT trip the new lints: "heavy-lidded stare" (noun) is legit; negations pass.
const houseStyle = lintMotionPrompt(SAV_PROFILE.toolRules.video.confirmedWorkingExamples[0]!, SAV_PROFILE, 'ONE_SHOT', 0);
check('house-style example still passes the new humanization lint', houseStyle.length === 0, JSON.stringify(houseStyle));
const negatedTells = lintMotionPrompt('She keeps moving, NOT frozen, no waist-up framing, she never stares at the lens.', SAV_PROFILE, 'MULTI_CLIP', 0);
check('negated tells pass the humanization lint', !negatedTells.some((x) => /portrait-framing|freeze-word|over-directed/.test(x.problem)), JSON.stringify(negatedTells));

// ── GPT-image-2 moderation-safe sanitizer (§9 / log 19) ──
const modBelle = sanitizeImageModeration(BELLE_PROFILE.identityLock.closer);
check('sanitizer removes youth wording from Belle closer', !/youthful|zero signs of aging|early[- ]?20s/i.test(modBelle), modBelle);
check('sanitizer keeps the face-match lock intact', /Match the uploaded reference image face exactly/i.test(modBelle));
const modBad = sanitizeImageModeration('A youthful 22-year-old girl in a tight corset with a sweetheart neckline, heavy-lidded sultry gaze.');
check('sanitizer clears the known trigger stack', !/youthful|\d{2}[- ]?year[- ]?old|\bgirl\b|\btight\b|corset|sweetheart|heavy[- ]lidded|sultry/i.test(modBad), modBad);
check('sanitizer idempotent', sanitizeImageModeration(modBad) === modBad);
check('sanitizer does not touch "cowgirl"', /cowgirl/i.test(sanitizeImageModeration('western cowgirl outfit')));

if (failures) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nALL COMPILER TESTS PASS');
