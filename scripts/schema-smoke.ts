/** Offline smoke test: JSON Schema derivation + fixture validation + platform detect. */
import { z } from 'zod';
import { AnalyzerOutputSchema, FormatDnaSchema, ModelProfileSchema, GenerationRunSchema } from '../shared/schemas';
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
  title: 'Elevator outfit-check freeze', archetype: 'outfit_showcase', tags: ['outfit', 'elevator'],
  hook: { type: 'visual', openingVisual: 'subject frozen mid-step in elevator', mechanism: 'motion freeze pattern interrupt' },
  beats: [beat],
  camera: {
    setup: 'propped_on_surface', facing: 'front', phoneVisible: 'no', distance: '~1.5m propped',
    heightAngle: 'knee height tilted up 15°', motion: 'static', hiddenArm: 'none',
  },
  setting: { locationType: 'hotel elevator, mirrored', timeOfDay: 'evening', lighting: 'overhead warm LEDs', keyProps: ['mirror'], colorPalette: 'warm gold + black', mood: 'luxe' },
  wardrobeRole: { role: 'going-out fit', garments: ['satin slip dress'], stylingNotes: 'heels, small bag' },
  pacing: { totalDurationSec: 8.2, cutCount: 0, isOneShot: true, rhythm: 'single slow take', energy: 'calm-confident' },
  audio: { kind: 'trending_audio', trendingSoundDependent: true },
  textOverlays: { present: false, cadence: 'none', placement: 'none', copyStyle: 'none', items: [] },
  whyItWorks: { mechanism: 'freeze-frame curiosity gap', retentionDrivers: ['await the unfreeze'], targetViewer: 'fashion-adjacent scrollers' },
  difficulty: { environment: 2, motion: 1, camera: 1, overall: 2, workarounds: [] },
  swapMap: { mustKeep: ['freeze at 0:02', 'propped knee-height angle'], swappable: ['identity', 'outfit color', 'specific elevator'] },
  contentFlag: { rating: 'sfw', triggers: [] },
  frames: [frame],
  characterObservation: { appearance: 'n/a', outfit: 'satin slip dress', vibe: 'confident' },
};
const r = AnalyzerOutputSchema.safeParse(fixture);
if (!r.success) { console.error('FIXTURE FAILED:', r.error.issues.slice(0, 10)); process.exit(1); }
console.log('AnalyzerOutput fixture: VALID');

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
