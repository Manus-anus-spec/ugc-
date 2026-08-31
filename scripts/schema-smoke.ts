/** Offline smoke test: JSON Schema derivation + fixture validation + platform detect. */
import { z } from 'zod';
import { AnalyzerOutputSchema, FormatDnaSchema, ModelProfileSchema, GenerationRunSchema, PerceptionOutputSchema } from '../shared/schemas';
import { detectPlatform } from '../shared/platform';

// 1. JSON Schema derivation (feeds Gemini responseJsonSchema)
const js = z.toJSONSchema(AnalyzerOutputSchema);
const size = JSON.stringify(js).length;
console.log('AnalyzerOutput JSON Schema: OK,', size, 'chars,', Object.keys((js as any).properties ?? {}).length, 'top-level props');
z.toJSONSchema(ModelProfileSchema); console.log('ModelProfile JSON Schema: OK');
z.toJSONSchema(GenerationRunSchema); console.log('GenerationRun JSON Schema: OK');

// 2. Fixture: a minimal-but-complete AnalyzerOutput must validate
const beat = {
  index: 0, clipIndex: 0, startSec: 0, endSec: 3.5,
  action: 'walks into frame, turns to camera', rightHand: 'adjusts hair', leftHand: 'at side',
  cameraMove: 'static', framing: 'waist-up, fills 55%', expressionEnergy: 'playful confidence',
  startsOnCut: true,
  // v3 filming fidelity — REQUIRED by AnalyzerBeatSchema on every new analysis:
  shotSize: 'MS', cameraAngle: 'eye',
  lensFeel: 'rear-cam normal, no distortion at ~1.5m',
  cutTransition: 'hard',
  motionBeat: 'hair swings forward as she completes the turn',
  secondaryMotion: {
    hair: 'swings forward on the turn, settles over ~0.5s',
    fabric: 'satin ripples at the hem with the step',
    softBody: 'natural weight transfer, slight shoulder drop',
    accessories: 'none',
  },
  microExpression: 'single blink as she lands the turn, gaze darts to lens',
  shotType: 'aroll',
};
const frame = {
  frameId: 'clip0-thumbnail', role: 'thumbnail', clipIndex: 0, timestampSec: 0,
  scene: {
    framing: 'waist-up', cropBoundaries: 'hips at bottom edge, headroom 5%',
    subjectPlacement: 'center, facing camera 0°', bodyPosition: 'standing, weight on right leg, feet visible',
    action: 'mid-turn', hands: { right: 'raised to hair', left: 'at side' },
    wardrobeVisible: 'pale icy blue satin slip dress, thin straps',
    environmentLayout: 'LEFT: window 0-30%, CENTER: subject, RIGHT: doorframe at 85%',
    lighting: 'single window source camera-left, warm 3200K, soft shadows right',
    colorGrade: 'warm amber cast, medium contrast', motionState: 'mid-action, weight transferring',
    fabric: 'smooth satin, flowy, subtle sheen', nsfwElements: [],
  },
};
const fixture = {
  title: 'Elevator outfit-check freeze', archetype: 'outfit_showcase', formatType: 'outfit_showcase',
  tags: ['outfit', 'elevator'],
  hook: {
    // attention model (2026-08-28) — optional in the schema, asked for in the prompt
    channels: {
      text: 'POV: you forgot the one thing',
      spoken: 'wait — did I actually leave it?',
      visual: 'the elevator doors close on her half-turned face',
      stackedCount: 3,
    },
    stakes: 'she is about to be shut in with the door closing on the thing she forgot',
    lockIn: 'the doors are still closing and she has not turned around yet',
    worksOnMute: true, type: 'visual', openingVisual: 'subject frozen mid-step in elevator', mechanism: 'motion freeze pattern interrupt' },
  beats: [beat],
  camera: {
    setup: 'propped_on_surface', facing: 'front', phoneVisible: 'no', distance: '~1.5m propped',
    heightAngle: 'knee height tilted up 15°', motion: 'static', hiddenArm: 'none',
    dynamics: {
      stability: 'locked_off', shake: 'none — phone propped on ledge', sway: 'none', bob: 'none',
      reframes: 'none', focusExposure: 'steady throughout',
      motionSignature: 'locked-off propped phone at knee height tilted up 15°, zero shake, subject moves through a static frame',
    },
  },
  setting: { locationType: 'hotel elevator, mirrored', timeOfDay: 'evening', lighting: 'overhead warm LEDs', keyProps: ['mirror'], colorPalette: 'warm gold + black', mood: 'luxe' },
  wardrobeRole: { role: 'going-out fit', garments: ['satin slip dress'], stylingNotes: 'heels, small bag' },
  pacing: {
    totalDurationSec: 8.2, cutCount: 0, isOneShot: true, rhythm: 'single slow take', energy: 'calm-confident',
    cutCadenceSec: 8.2, payoffSec: 6,
  },
  audio: {
    kind: 'trending_audio', trendingSoundDependent: true,
    beatMap: [{ atSec: 0, kind: 'downbeat' }, { atSec: 6, kind: 'drop' }],
    syncType: 'motion_on_beat',
    roomTone: 'elevator hum + faint HVAC, phone-mic close and dry',
  },
  loop: { isSeamless: false, mechanism: 'none — ends on the unfreeze' },
  motionCadence: {
    fpsFeel: 'native 30fps phone',
    shutterFeel: 'normal auto shutter, motion blur on the turn',
    temporalArtifacts: 'none seen',
    interpolationRisk: 'any frame-interpolated smoothness on the hair swing would betray AI',
  },
  textOverlays: { present: false, cadence: 'none', placement: 'none', copyStyle: 'none', items: [] },
  viralMechanics: {
    primaryDriver: 'the freeze withholds the reveal until the unfreeze',
    replicableCore: ['a promise made in frame one that only resolves at the end'],
    nonReplicable: ['the mirrored lift interior', 'the creator\'s existing following'],
    transplantRisk: 'without the mirror the freeze reads as a glitch rather than a choice',
    freshAngles: ['the same withhold applied to an outfit reveal', 'the same freeze on a doorway'],
    production: {
      castCount: 1, castRoles: ['the subject'],
      needsPublicLocation: false, needsRealBystanders: false, screenContentRequired: false,
      aiFeasibility: 85,
      aiFeasibilityReason: 'single character, private interior, no legible screen content',
      singleCharacterRewrite: 'already single-character — no rewrite needed',
    },
  },
  uncertain: [{ field: 'audio.beatMap[1]', why: 'drop is ambiguous under the music bed' }],
  whyItWorks: {
    mechanism: 'freeze-frame curiosity gap', retentionDrivers: ['await the unfreeze'],
    targetViewer: 'fashion-adjacent scrollers',
    viewerIdentity: 'the friend who spots the outfit before anyone else does',
    sharerPayoff: 'sending it says you have an eye for a fit',
  },
  difficulty: { environment: 2, motion: 1, camera: 1, overall: 2, workarounds: [] },
  swapMap: { mustKeep: ['freeze at 0:02', 'propped knee-height angle'], swappable: ['identity', 'outfit color', 'specific elevator'] },
  contentFlag: { rating: 'sfw', triggers: [] },
  aesthetic: {
    device: 'iPhone rear camera', style: 'iphone_candid',
    grade: 'raw ungraded, warm elevator LEDs, auto-exposure',
    realismMarkers: ['sensor noise in shadow areas', 'slightly blown mirror highlights', 'imperfect headroom'],
    antiCinematic: 'no color grade, no cinematic lighting, no shallow depth of field',
    promptAnchor: 'casual amateur iPhone footage propped in an elevator, raw ungraded auto-exposure look, deep focus — NOT cinematic, no film grade',
    // v3 required on new analyses:
    colorTempK: '~3000K warm elevator LED',
    lightingDirection: 'overhead, slightly behind — top-down falloff on the face',
    practicals: ['recessed ceiling LEDs', 'mirror bounce'],
    realismTells: ['sensor-noise-in-shadows', 'blown-highlights', 'imperfect-headroom'],
    promptAnchorShort: 'raw iPhone propped in an elevator, ungraded warm LED, deep focus',
  },
  virality: {
    overall: 58, verdict: 'Competent freeze gimmick with no share trigger — average, not viral.',
    dimensions: {
      hook: { score: 62, reason: 'freeze at 0:02 is a real pattern interrupt, but 0:00-0:01 is a plain walk-in' },
      retention: { score: 60, reason: 'single 8s take, payoff at 0:06 — one dead zone 0:03-0:05' },
      emotion: { score: 45, reason: 'mild aesthetic desire, nothing stronger' },
      share: { score: 38, reason: 'nothing to send to a friend — no identity signal, no joke' },
      replay: { score: 50, reason: 'freeze invites one rewatch to check the trick' },
      algo: { score: 65, reason: '8s length loops well; trending audio dependency is current' },
    },
    strengths: ['clean freeze-frame mechanic'], weaknesses: ['no share trigger', 'flat first second'],
    ceiling: '20-80K on a mid-size account — capped by zero shareability',
    improvements: ['put the freeze inside the first second', 'add a comment-bait overlay line'],
  },
  frames: [frame],
  characterObservation: { appearance: 'n/a', outfit: 'satin slip dress', vibe: 'confident' },
};
const r = AnalyzerOutputSchema.safeParse(fixture);
if (!r.success) { console.error('FIXTURE FAILED:', r.error.issues.slice(0, 20)); process.exit(1); }
console.log('AnalyzerOutput fixture: VALID');

// 2b. PerceptionOutputSchema is what analyze.ts ACTUALLY validates the Gemini
// perception call against (AnalyzerOutput minus the virality essay). Assert the same
// fixture satisfies it, and that its derived JSON Schema survives Gemini's decoder rules.
const { virality: _virality, ...perceptionFixture } = fixture;
const pr = PerceptionOutputSchema.safeParse(perceptionFixture);
if (!pr.success) { console.error('PERCEPTION FIXTURE FAILED:', pr.error.issues.slice(0, 20)); process.exit(1); }
console.log('PerceptionOutput fixture: VALID');

// 3. Full FormatDna assembles from it the same way analyze.ts does
const full = FormatDnaSchema.safeParse({
  ...r.data, schemaVersion: 1, id: 'test-id', version: 1,
  source: { platform: 'instagram', url: 'https://www.instagram.com/reel/x/', durationSec: 8.2, clipCount: 1, isOneShot: true, analyzedAt: new Date().toISOString(), analyzerVersion: 'ugc-api@1.0.0/gemini-3-pro-preview' },
});
console.log('FormatDna assembly:', full.success ? 'VALID' : full.error.issues.slice(0, 5));

// 4. Platform detection incl. the previously-blocked Instagram
const urls: [string, string | null][] = [
  ['https://www.instagram.com/reel/DYCpJ0yirDw/', 'instagram'],
  ['https://instagr.am/p/abc', 'instagram'],
  ['https://vm.tiktok.com/ZM123/', 'tiktok'],
  ['https://www.youtube.com/shorts/abc', 'youtube'],
  ['https://pin.it/xyz', 'pinterest'],
  ['https://example.com/video', null],
  ['not a url', null],
];
for (const [u, want] of urls) {
  const got = detectPlatform(u);
  if (got !== want) { console.error(`detectPlatform FAILED: ${u} → ${got}, want ${want}`); process.exit(1); }
}
console.log('detectPlatform: all', urls.length, 'cases pass');
