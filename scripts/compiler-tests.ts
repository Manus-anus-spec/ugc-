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
  sanitizeImageModeration, challengeMotionPrompt, collectRepeatedCameraLines,
  ANTI_SLOP_SUFFIX, MOUTH_BUSY, ensureBodyLead, applySwimwearWorkaround,
} from '../worker/src/generate/rules';
import { BELLE_PROFILE } from '../worker/seeds/profiles';
import { buildGeneratorInstruction, buildSynthesisDigest } from '../worker/src/generate/prompt';
import { sampleSurpriseSources } from '../worker/src/generate/surprise';
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
// Part B (Aug 17): the "no smoothness, no stabilization" pair is REINSTATED in the lean
// tail — Khian's live session proved it load-bearing on 2.0 (drifts gimbal-smooth without it).
const dnaLean = { setting: { locationType: 'kitchen' } } as unknown as FormatDna;
const leanTail = applySeedanceLeanTail('Raw iPhone look, she stirs the pot and grins.', dnaLean, undefined);
check('seedance lean tail carries the load-bearing negation pair', /no smoothness, no stabilization/i.test(leanTail), leanTail);
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
// Aug 17 one-shot image method: GPT-Image-2 one pass; Seedream body pass CONDITIONAL.
const heroRoute = buildProductionRoute(0, 'hero_still', 'kling_3', false);
check('hero route: gpt-image → (conditional sd) → face_restore → kling', heroRoute.map((s) => s.tool).join(',') === 'gpt_image_2,seedream_4.5,face_restore,kling_3', heroRoute.map((s) => s.tool).join(','));
check('seedream pass is CONDITIONAL, gpt-image + video are not',
  heroRoute.find((s) => s.tool === 'seedream_4.5')!.conditional === true
  && !heroRoute.find((s) => s.tool === 'gpt_image_2')!.conditional
  && !heroRoute.find((s) => s.tool === 'kling_3')!.conditional);
check('conditional pass says WHEN it fires', /ONLY if the body did not resolve/.test(heroRoute.find((s) => s.tool === 'seedream_4.5')!.inputAsset));
const chainRoute = buildProductionRoute(2, 'prev_clip_last_frame', 'cdance_2', true);
check('chained route: per-hop face check → video → lipsync', chainRoute.map((s) => s.tool).join(',') === 'face_restore,cdance_2,lipsync', chainRoute.map((s) => s.tool).join(','));
check('chained route names the drift check', /drift/.test(chainRoute[0]!.outputAsset));

// ── fidelity linter ──
const dnaTwoBeats = {
  camera: {}, beats: [SRC_BEAT, { ...SRC_BEAT, index: 2, clipIndex: 2, startSec: 3.4, endSec: 5.0 }],
  audio: { syncType: 'none' }, textOverlays: { present: false },
} as unknown as FormatDna;
const shortIdeation = { beats: [{ clipIndex: 0, durationSec: 1.4, action: 'laughs', motionBeat: 'bounce', motionPrompt: 'medium shot, hold ~1.4s, she blinks', dialogue: undefined }] } as unknown as Ideation;
// (the two same-scene beats above now merge into ONE segment — mismatch needs a
// genuinely unmergeable pair: a-roll ↔ b-roll (different subject) forces 2 segments.
// Aug 17: angle/size/match no longer split — only shotType or >15s do.)
const dnaTwoSegs = {
  ...dnaTwoBeats,
  beats: [SRC_BEAT, { ...SRC_BEAT, index: 2, clipIndex: 2, startSec: 3.4, endSec: 5.0, shotType: 'broll', brollSubject: 'hands plating tacos' }],
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

// ── generation segments — ONE-SHOT BY DEFAULT (Aug 17 rewrite of the Jul 27 grouper) ──
const mkBeat = (i: number, start: number, end: number, over: Record<string, unknown> = {}) =>
  ({ ...SRC_BEAT, index: i, clipIndex: i, startSec: start, endSec: end, ...over }) as Beat;
const fastBeats = [
  mkBeat(0, 0, 0.9), mkBeat(1, 0.9, 2.1), mkBeat(2, 2.1, 3.0), mkBeat(3, 3.0, 4.5),
  mkBeat(4, 4.5, 9.2, { cameraAngle: 'overhead' }), mkBeat(5, 9.2, 10.0),
];
const segs = planSegments(fastBeats);
// Acceptance 1: a fast-cut ≤15s source that previously produced 3 takes now = ONE take.
check('fast-cut ≤15s source = ONE take (was 3 segments before Aug 17)',
  segs.length === 1 && segs[0]!.beatIndices.join(',') === '0,1,2,3,4,5', JSON.stringify(segs));
check('angle change is cut cadence, NOT a take break', planSegments([mkBeat(0, 0, 4), mkBeat(1, 4, 8, { cameraAngle: 'overhead' })]).length === 1);
check('ECU→WS jump is cut cadence, NOT a take break', planSegments([mkBeat(0, 0, 0.9, { shotSize: 'ECU' }), mkBeat(1, 0.9, 2.0, { shotSize: 'WS' })]).length === 1);
check('CU→MS merges (as before)', planSegments([mkBeat(0, 0, 0.9, { shotSize: 'CU' }), mkBeat(1, 0.9, 2.0, { shotSize: 'MS' })]).length === 1);
check('a-roll ↔ b-roll ALWAYS breaks (different subject in frame)',
  planSegments([mkBeat(0, 0, 4), mkBeat(1, 4, 6, { shotType: 'broll' }), mkBeat(2, 6, 10)]).length === 3);
// Acceptance 2: >15s splits into the FEWEST, LONGEST takes — balanced, none under 5s.
const longBeats = [mkBeat(0, 0, 4.5), mkBeat(1, 4.5, 9), mkBeat(2, 9, 13.5), mkBeat(3, 13.5, 18)];
const segsCap = planSegments(longBeats);
check('18s same-scene → 2 balanced takes (9s+9s), not 15s+3s sliver',
  segsCap.length === 2 && segsCap.every((s) => s.endSec - s.startSec >= 5 && s.endSec - s.startSec <= 15),
  JSON.stringify(segsCap.map((s) => s.endSec - s.startSec)));
const beats17 = [mkBeat(0, 0, 3), mkBeat(1, 3, 6), mkBeat(2, 6, 9), mkBeat(3, 9, 12), mkBeat(4, 12, 14), mkBeat(5, 14, 17)];
const segs17 = planSegments(beats17);
check('17s → 2 takes, both ≥5s (no sliver tail)',
  segs17.length === 2 && segs17.every((s) => s.endSec - s.startSec >= 5),
  JSON.stringify(segs17.map((s) => `${s.startSec}-${s.endSec}`)));
const beats31 = Array.from({ length: 31 }, (_, i) => mkBeat(i, i, i + 1));
check('31s → 3 balanced takes ≤15s each, none under 5s',
  planSegments(beats31).length === 3 && planSegments(beats31).every((s) => s.endSec - s.startSec >= 5 && s.endSec - s.startSec <= 15),
  JSON.stringify(planSegments(beats31).map((s) => s.endSec - s.startSec)));
check('15s exactly = still one take', planSegments([mkBeat(0, 0, 7.5), mkBeat(1, 7.5, 15)]).length === 1);

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
check('segment plan text lists takes + timelines', buildSegmentPlanText(fastBeats, segs).includes('ONE continuous take') && buildSegmentPlanText(fastBeats, segs).includes('Segment 1'));
check('multi-take plan text numbers every take', buildSegmentPlanText(beats17, segs17).includes('Segment 2'));

// ── ONE-SHOT LAW present in the generator instruction (all modes) ──
for (const m of ['adapt', 'reproduce', 'synthesize'] as const) {
  const oneShotInstr = buildGeneratorInstruction(BELLE_PROFILE, 'close', 1, m, 2);
  check(`ONE-SHOT LAW in ${m} instruction`, /ONE-SHOT LAW/.test(oneShotInstr) && /FEWEST, LONGEST takes/.test(oneShotInstr) && /never plan a clip under 5s/.test(oneShotInstr));
}

// ── mangled-marker re-injection (Jul 26 — rewrite echoed "CAMERA(source):" but dropped tokens) ──
const mangled = 'She laughs mid-stir. CAMERA(source): , hold ~1.4s.';   // marker survived, shot size lost
const reinjected = ensureBeatCameraPhysics(mangled, SRC_BEAT);
check('mangled CAMERA(source) block gets missing tokens re-injected', reinjected.toLowerCase().includes('medium shot'), reinjected);

// ── dialogue embed enforced, not asked (Jul 26) ──
const dlgLine = 'come taste this before I change my mind';
const noDlg = ensureDialogueEmbedded('Selfie angle, she stirs the pot and smirks at the lens.', dlgLine, 'cdance_2');
// Part B (Aug 17): Seedance dialogue = CURLY BRACES, delivery tone outside (doc + live-validated).
check('missing dialogue EMBEDDED (cdance curly-brace style)', noDlg.includes(`{${dlgLine}}`) && !noDlg.includes(`"${dlgLine}"`), noDlg);
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

// ── §10 synthesis digest (mechanisms only — no concrete scene detail leaks) ──
const srcA = { title: 'Taco freeze', formatType: 'skit', hook: { type: 'visual', mechanism: 'freeze at 0:02' },
  whyItWorks: { mechanism: 'curiosity gap', retentionDrivers: ['await the unfreeze'], targetViewer: 'foodies' },
  beats: [{}, {}, {}], pacing: { rhythm: 'fast cuts' }, virality: { overall: 72, strengths: ['scroll-stop freeze'] } } as unknown as import('../shared/contract').FormatDna;
const srcB = { title: 'Ranch reveal', formatType: 'outfit_showcase', hook: { type: 'visual', mechanism: 'walk-in reveal' },
  whyItWorks: { mechanism: 'aspirational reveal', retentionDrivers: ['payoff at end'], targetViewer: 'lifestyle' },
  beats: [{}, {}], pacing: { rhythm: 'single take' }, virality: { overall: 65, strengths: ['clean reveal'] } } as unknown as import('../shared/contract').FormatDna;
const digest = buildSynthesisDigest([srcA, srcB]);
check('digest names both sources', /Taco freeze/.test(digest) && /Ranch reveal/.test(digest), digest);
check('digest carries mechanisms + virality strengths', /freeze at 0:02/.test(digest) && /scroll-stop freeze/.test(digest), digest);
check('digest tags archetype + score', /\[skit\]/.test(digest) && /virality 72/.test(digest), digest);

// ── §1/§5 (Aug 17): garble fixes — negation-aware autofix, protected locked blocks, idempotency ──
check('autofix keeps "NOT studio lighting" intact (was → "NOT soft natural lighting")',
  autofixNbSlop('candid kitchen, NOT studio lighting.') === 'candid kitchen, NOT studio lighting.');
check('autofix keeps "NOT airbrushed" intact (was → double-negative "NOT unretouched")',
  autofixNbSlop('real skin, NOT airbrushed.') === 'real skin, NOT airbrushed.');
check('autofix keeps "NO ring light" intact', autofixNbSlop('window lit, NO ring light.') === 'window lit, NO ring light.');
check('autofix still fixes POSITIVE slop', /flat natural light/.test(autofixNbSlop('lit by studio lighting')) && /flat natural daylight/.test(autofixNbSlop('golden hour glow on her face')));
check('§1 candid: staring-into-lens autofixed to off-lens', /off-lens/.test(autofixNbSlop('she is staring into the lens')));
check('§1 lighting bans: warm glow / rim light / soft light replaced',
  !/warm glow|rim light|soft light/i.test(autofixNbSlop('warm glow, rim light, soft lighting')));
check('universal sanitize keeps "nude-rose" makeup shade (was → "off-camera-rose")',
  applyUniversalSanitize('soft nude-rose lip') === 'soft nude-rose lip' && /off-camera/.test(applyUniversalSanitize('she is nude')));
// The live 3×-closer / eaten-freckles garble: enforce chain must be idempotent on re-entry.
const assembled = wrapIdentityLock(ensureNbRealism('Candid porch scene, she carries a hay bale.', dnaForLock), BELLE_PROFILE);
const reentry = wrapIdentityLock(ensureNbRealism(stripIdentityDescriptors(autofixNbSlop(assembled), BELLE_PROFILE), dnaForLock), BELLE_PROFILE);
const closerHead = BELLE_PROFILE.identityLock.closer.slice(0, 40);
check('re-entrant NB chain: closer appears EXACTLY once (was 3× live)',
  reentry.split(closerHead).length - 1 === 1, String(reentry.split(closerHead).length - 1));
check('re-entrant NB chain: anti-slop suffix intact + freckles NOT eaten from locked blocks',
  reentry.includes('visible pores and freckles') && /NOT airbrushed/.test(reentry) && !/pores and\s*,/.test(reentry), reentry.slice(-260));
check('strip still removes leaked descriptors OUTSIDE locked blocks',
  !/copper-red hair shines/.test(stripIdentityDescriptors('her copper-red hair shines in the sun', BELLE_PROFILE)));
check('strip lookarounds: hyphen-compound survives (blue-green eyes garble)',
  stripIdentityDescriptors('deep blue-teal water', BELLE_PROFILE) === 'deep blue-teal water');
check('secondary-motion idempotent on paraphrased header (was stacking 2×)',
  ensureSecondaryMotion('She turns. Secondary motion: her braid swings once.', undefined) === 'She turns. Secondary motion: her braid swings once.');
check('MOUTH_BUSY: "takes a bite" busy, "bites her lip" NOT busy',
  MOUTH_BUSY.test('she takes a bite of the taco') && !MOUTH_BUSY.test('she bites her lip and grins'));
check('ANTI_SLOP_SUFFIX emitted verbatim by ensureNbRealism',
  ensureNbRealism('Simple porch still.', dnaForLock).includes(ANTI_SLOP_SUFFIX));
// Live Aug 17 finding: a closer carrying "visible pores and freckles" was silently
// blocking the suffix append — the sentinel is now a suffix-unique phrase.
check('suffix still appended when the CLOSER carries similar wording',
  ensureNbRealism('Porch still. Realistic natural skin texture with visible pores and freckles, NOT airbrushed, NOT over-smoothed.', dnaForLock).includes(ANTI_SLOP_SUFFIX));
// Live Aug 17 finding: LLM echoes NEAR-copies of the closer — sentence-level protection
// must keep identity words inside any match-the-reference sentence intact.
const echoed = 'She sweeps the barn aisle. Match the reference image face exactly — do not alter her copper-red hair, heavy natural freckles, or green blue-green eyes. Warm smile.';
const echoStripped = stripIdentityDescriptors(echoed, BELLE_PROFILE);
check('paraphrased closer echo NOT garbled (sentence-level protection)',
  echoStripped.includes('copper-red hair, heavy natural freckles, or green blue-green eyes'), echoStripped);
check('paraphrased echo does not lint as a leak',
  !lintNbPrompt(`Raw iPhone footage aesthetic. ${echoed}`, BELLE_PROFILE, 0).some((x) => x.problem.includes('descriptor leaked')));

// ── §2 (Aug 17): body-match LEAD + ref kit ──
const leadProfile = {
  ...BELLE_PROFILE,
  body: {
    build: 'slim hourglass', proportions: 'balanced', skin: 'freckled natural',
    sdEnhancementNotes: 'gentle',
    leadDescriptor: 'full round bust that sits high, deeply snatched waist, curvy hips',
  },
} as ModelProfile;
const withLead = ensureBodyLead(wrapIdentityLock('She carries a hay bale across the porch.', leadProfile), leadProfile);
check('§2 LEAD injected after the opener, commands the shape + LEAN cap',
  withLead.startsWith(leadProfile.identityLock.opener)
  && withLead.indexOf('body reference photos') < withLead.indexOf('hay bale')
  && withLead.includes('deeply snatched waist') && withLead.includes('Curvy but LEAN, NOT thick, NOT a BBL.'), withLead.slice(0, 300));
check('§2 LEAD idempotent', ensureBodyLead(withLead, leadProfile) === withLead);
check('§2 no body block → prompt untouched', ensureBodyLead('Simple porch still.', BELLE_PROFILE) === 'Simple porch still.');
check('§2 LEAD survives moderation-sanitize (span-protected), curvy stripped elsewhere',
  sanitizeImageModeration(withLead).includes('curvy hips')
  && !/curvy/.test(sanitizeImageModeration('a curvy silhouette by the window')));
check('§3 new triggers: unbuttoned + stare neutralized',
  sanitizeImageModeration('unbuttoned shirt, she stares out') === 'relaxed-fit shirt, she gazes out');
const swim = applySwimwearWorkaround('She adjusts her red bikini by the pool edge.', 'Natural body pass.');
check('§3 swimwear workaround: tank base + REQUIRED sd swap',
  /fitted ribbed tank top and shorts/.test(swim.nbPrompt) && !/bikini/i.test(swim.nbPrompt)
  && /WARDROBE SWAP/.test(swim.sdPrompt) && /red bikini/.test(swim.sdPrompt) && swim.swapped, swim.sdPrompt);
check('§3 swimwear untouched without water context',
  !applySwimwearWorkaround('She models a bikini in the bedroom mirror.', 'x').swapped);
check('§3 swimwear idempotent', !applySwimwearWorkaround(swim.nbPrompt, swim.sdPrompt).swapped
  && applySwimwearWorkaround(swim.nbPrompt, swim.sdPrompt).sdPrompt === swim.sdPrompt);
const swimRoute = buildProductionRoute(0, 'hero_still', 'cdance_2', false, undefined, true);
check('§3 swim route: seedream swap pass REQUIRED (not conditional)',
  swimRoute.find((s) => s.tool === 'seedream_4.5')!.conditional === undefined
  && /REQUIRED wardrobe-swap/.test(swimRoute.find((s) => s.tool === 'seedream_4.5')!.inputAsset));
check('§3 gpt step carries the strip→retry→route→fallback flow',
  /retry ONCE clean/.test(heroRoute.find((s) => s.tool === 'gpt_image_2')!.onModerationFlag ?? '')
  && /nano-banana-2/.test(heroRoute.find((s) => s.tool === 'gpt_image_2')!.onModerationFlag ?? ''));
check('§2 route names the ref kit + _LOCKED/ path',
  /REF KIT/.test(heroRoute.find((s) => s.tool === 'gpt_image_2')!.inputAsset)
  && /_LOCKED\//.test(heroRoute.find((s) => s.tool === 'gpt_image_2')!.inputAsset));
check('§2 refKit schema accepts a kit', ModelProfileSchema.safeParse({
  ...BELLE_PROFILE,
  refs: { strategy: 'single_ref_base64', refKit: { faceCrops: ['a', 'b', 'c', 'd'], bodyCrops: ['e', 'f', 'g'] } },
}).success);

// ── Part B (Aug 17): SELF-CHALLENGE pass — negation-aware critique that never flags good prompts ──
const goodSeedance = 'Raw handheld iPhone footage. First she lifts the hay bale, then drops it. Background: birds, a light breeze, phone-mic audio — no smoothness, no stabilization, no music, no on-screen text or subtitles, no watermark, no slow motion.';
const chGood = challengeMotionPrompt(goodSeedance, 'cdance_2', undefined, false);
check('challenge: good prompt untouched (negation-aware, zero changes)', chGood.prompt === goodSeedance && chGood.changes.length === 0, chGood.changes.join('; '));
const chBare = challengeMotionPrompt('She lifts the hay bale and grins.', 'cdance_2', undefined, false);
check('challenge: bare prompt gets negation pair + subtitle ban + ambient, all logged',
  /no smoothness/i.test(chBare.prompt) && /subtitle/i.test(chBare.prompt) && /room tone|Ambient/i.test(chBare.prompt) && chBare.changes.length === 3,
  chBare.changes.join('; '));
check('challenge idempotent', challengeMotionPrompt(chBare.prompt, 'cdance_2', undefined, false).changes.length === 0);
const chQuoted = challengeMotionPrompt('She says: "howdy yall" — grinning. Background: birds, phone-mic audio — no smoothness, no stabilization, no on-screen text or subtitles.', 'cdance_2', 'howdy yall', true);
check('challenge: double-quoted dialogue converted to curly braces', chQuoted.prompt.includes('{howdy yall}') && chQuoted.changes.includes('converted dialogue to curly braces'), chQuoted.prompt);
const camAcc = new Map<string, number[]>();
collectRepeatedCameraLines('Static handheld phone propped at chest height across the kitchen counter. She stirs.', 0, camAcc);
collectRepeatedCameraLines('Static handheld phone propped at chest height across the kitchen counter. She plates it.', 1, camAcc);
collectRepeatedCameraLines('Filmed by a friend walking backwards down the barn aisle at waist height. She follows.', 2, camAcc);
const dupes = [...camAcc.values()].filter((v) => v.length >= 2);
check('challenge: verbatim camera line repeated across beats detected', dupes.length === 1 && dupes[0]!.join(',') === '0,1', JSON.stringify([...camAcc.entries()]));

// ── Content Persona Framework schema (2026-08-17): optional block, backward compatible ──
// (The SEED_PROFILES loop above already proves persona-less profiles still validate.)
const personaProfile = {
  ...BELLE_PROFILE,
  world: {
    ...BELLE_PROFILE.world,
    contentPersona: {
      personaTraits: ['warm', 'hardworking', 'unexpectedly deadpan'],
      resources: 'self-filmed + a friend on weekends, ranch + small town, high camera confidence, 3-4 posts/wk',
      theme: 'wholesome ranch-life charm with a dry comedic edge',
      vehicles: ['ranch chores', 'small-town errands', 'getting-ready moments'],
      formatMenu: ['skit', 'vlog_moment', 'pov'],
      brandStatement: 'She is a warm, hardworking, unexpectedly deadpan redhead whose content is wholesome ranch-life charm through chores-and-errands vehicles that feels like small-town comfort for men who miss simple life.',
      idealFan: 'US men 30-55 who romanticize rural life and loyal-girl warmth',
      ideationPrompt: 'What would a warm, deadpan ranch girl film today that makes a tired man smile and feel at home?',
    },
  },
};
check('profile WITH contentPersona validates', ModelProfileSchema.safeParse(personaProfile).success,
  JSON.stringify(ModelProfileSchema.safeParse(personaProfile).success ? '' : ModelProfileSchema.safeParse(personaProfile).error?.issues.slice(0, 3)));
check('contentPersona requires exactly 3 traits', !ModelProfileSchema.safeParse({
  ...personaProfile,
  world: { ...personaProfile.world, contentPersona: { ...personaProfile.world.contentPersona, personaTraits: ['only', 'two'] } },
}).success);

// ── §10 "surprise me" sampling (2026-08-17 sameness-bug fix: fresh weighted-random,
// archetype-diverse draw every press — never the same deterministic trio) ──
// Seeded LCG so this test is reproducible; production uses Math.random.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
// A library shaped like ours: 24 candidates across 6 archetypes, scores 60–85.
const TYPES = ['skit', 'thirst_trap', 'pov', 'outfit_showcase', 'vlog', 'trend_audio'];
const LIB = Array.from({ length: 24 }, (_, i) => ({
  id: `f${i}`, formatType: TYPES[i % TYPES.length]!, score: 85 - i,
}));
const libTypeOf = (id: string) => LIB.find((c) => c.id === id)!.formatType;
const draws = Array.from({ length: 6 }, (_, i) => sampleSurpriseSources(LIB, 3, new Set(), lcg(1000 + i * 7)));
const drawKeys = draws.map((d) => [...d].sort().join(','));
check('surprise draws are NOT all identical across 6 presses', new Set(drawKeys).size > 1, drawKeys.join(' | '));
check('surprise anchors rotate (dnas[0] varies)', new Set(draws.map((d) => d[0])).size > 1, draws.map((d) => d[0]).join(','));
check('every draw returns 3 sources', draws.every((d) => d.length === 3));
check('archetype spread held (3 distinct format_types per draw)',
  draws.every((d) => new Set(d.map(libTypeOf)).size === 3),
  draws.map((d) => d.map(libTypeOf).join('+')).join(' | '));
const oldTrio = new Set(['f0', 'f1', 'f2']);   // simulate don't-repeat: last run's sources
const nextDraw = sampleSurpriseSources(LIB, 3, oldTrio, lcg(42));
check('don\'t-repeat memory excludes the previous source set', nextDraw.every((id) => !oldTrio.has(id)), nextDraw.join(','));
const tiny = LIB.slice(0, 3);   // exclusion would starve the fusion → it must be ignored
check('exclusion is dropped when too few fresh candidates remain',
  sampleSurpriseSources(tiny, 3, new Set(['f0', 'f1']), lcg(7)).length === 3);
check('4-source draw works (widened SYNTHESIS_SOURCE_COUNT)', sampleSurpriseSources(LIB, 4, new Set(), lcg(99)).length === 4);
// Weighting sanity: over many draws, a top-score format should appear far more often than a bottom one.
let topHits = 0, botHits = 0;
for (let i = 0; i < 200; i++) {
  const d = sampleSurpriseSources(LIB, 3, new Set(), lcg(5000 + i));
  if (d.includes('f0')) topHits++;         // score 85
  if (d.includes('f23')) botHits++;        // score 62
}
check('score weighting biases toward quality without locking it in', topHits > botHits && topHits < 200, `top=${topHits} bot=${botHits}`);

// ── Theme Governor (Content Persona Framework, 2026-08-17) ──
const beltPersona = personaProfile as ModelProfile;
const instrPlain = buildGeneratorInstruction(BELLE_PROFILE, 'close', 1, 'synthesize', 5);
const instrGov = buildGeneratorInstruction(beltPersona, 'close', 1, 'synthesize', 5);
// Golden diff: without a persona the instruction is UNCHANGED (governor slot renders '').
check('no THEME GOVERNOR without contentPersona (golden)', !instrPlain.includes('THEME GOVERNOR') && !instrPlain.includes('themeFit'));
check('persona-less instruction keeps clean directive→profile-law join (golden)', /SYNTHESIZE[\s\S]*\n\n# THE PROFILE IS LAW/.test(instrPlain));
check('governor injected with persona, states brand statement as hard constraint',
  instrGov.includes('THEME GOVERNOR') && instrGov.includes(beltPersona.world.contentPersona!.brandStatement) && /HARD constraint/.test(instrGov));
check('governor demands themeFit + reshape-or-discard filter', /themeFit/.test(instrGov) && /RESHAPE[\s\S]*or DISCARD/.test(instrGov));
check('governor spine rule present in synthesize', instrGov.includes('SPINE RULE') && /THEME FIT, not raw hook strength/.test(instrGov));
check('governor spine rule absent in adapt/reproduce (governor still present)',
  ['adapt', 'reproduce'].every((m) => {
    const s = buildGeneratorInstruction(beltPersona, 'close', 1, m as 'adapt' | 'reproduce', 5);
    return s.includes('THEME GOVERNOR') && !s.includes('SPINE RULE');
  }));
check('governor scope line protects the locks', /does NOT change identity, face, body, wardrobe, or continuity/.test(instrGov));
check('lock sections survive governor injection (golden)',
  instrGov.includes('# THE PROFILE IS LAW') && /NEVER describe the person's physical appearance/.test(instrGov) && /identityLock text handles the face/.test(instrGov));

// ── persona-biased draw: lane bias + anchor guarantee ──
const MENU = new Set(['skit', 'vlog_moment', 'pov']);   // wholesome lane; thirst_trap/trend_audio/outfit off-menu
let offAnchor = 0, offSrc = 0, totSrc = 0;
const laneDraws: string[] = [];
for (let i = 0; i < 200; i++) {
  const d = sampleSurpriseSources(LIB, 3, new Set(), lcg(9000 + i), MENU);
  if (!MENU.has(libTypeOf(d[0]!))) offAnchor++;
  offSrc += d.filter((id) => !MENU.has(libTypeOf(id))).length; totSrc += d.length;
  if (i < 6) laneDraws.push([...d].sort().join(','));
}
check('persona: anchor (dnas[0]) NEVER off-menu', offAnchor === 0, `${offAnchor}/200`);
check('persona: off-menu sources are rare, not banned', offSrc > 0 && offSrc / totSrc < 0.3, `${offSrc}/${totSrc}`);
check('persona: draws stay fresh (not one lane-locked trio)', new Set(laneDraws).size > 1, laneDraws.join(' | '));
check('persona: no menu → behavior unchanged (same seed, same draw)',
  sampleSurpriseSources(LIB, 3, new Set(), lcg(1000)).join() === sampleSurpriseSources(LIB, 3, new Set(), lcg(1000), undefined).join());

if (failures) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nALL COMPILER TESTS PASS');
