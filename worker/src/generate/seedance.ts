/**
 * Seedance 2.0 structured-prompt serializer.
 *
 * WHAT THIS IS: the app's own beat data, rendered into the JSON shape Seedance 2.0 takes, so
 * an operator can paste it straight in instead of reshaping prose by hand.
 *
 * WHY IT IS DERIVED, NOT GENERATED — the important decision here. The obvious approach is to
 * ask Gemini for the JSON. That would create a SECOND representation of the same beat, and
 * only the prose motionPrompt carries the enforcement: the item-23 hold-body directive, the
 * secondary-motion cap, the ambient line, the static-camera default, the Seedance negation
 * pair, the anti-portrait framing translation, and the humanization lint. A separately
 * generated JSON would silently drift from all of it, and the drift would be invisible
 * because both would look plausible.
 *
 * Deriving it means the JSON inherits every guarantee for free and costs zero extra tokens.
 * If a future injector is added, this output gets it automatically.
 *
 * FIELD SHAPE follows the Seedance prompt recipe Khian supplied, with two deliberate
 * departures:
 *  - `people[].appearance` for the SUBJECT stays "reference image provided". Describing her
 *    in text fights the locked refs, which is exactly what identityLock and
 *    stripIdentityDescriptors exist to prevent. Cast members DO get described, because they
 *    have no reference image and text is all the generator has.
 *  - `negative_prompt` is OUR list plus the terms harvested from the recipe, not theirs
 *    verbatim: ours is already enforced elsewhere and losing a term here would let it back in.
 */
import type { FormatDna, Ideation, ModelProfile } from '../../../shared/contract';

/** Harvested from the Seedance recipe — terms our lists did not already carry. Kept as one
 *  exported constant so the video tails and this serializer cannot drift apart. */
export const SEEDANCE_NEGATIVES = [
  'no smooth gimbal motion', 'no cinematic stabilization', 'no professional lighting',
  'no beauty filter', 'no ring light', 'no AI skin smoothing', 'no influencer posing',
  'no perfectly centered framing', 'no overly dramatic acting', 'no model behavior',
  'no slow motion', 'no music video energy', 'no fashion campaign aesthetic',
  'no drone footage feel',
];

export interface SeedancePrompt {
  format: string;
  people: { id: string; role: string; appearance: string; wardrobe: string }[];
  environment: string;
  lighting: string;
  color_grading: string;
  atmosphere: string;
  audio: string;
  pacing: string;
  background_activity: string;
  scene_events: {
    timestamp: string;
    speaker: string;
    line: string | null;
    delivery: string | null;
    action: string;
  }[];
  style: string;
  camera_logic: string;
  imperfections: string[];
  shots: { time: string; action: string; camera_behavior: string; scene_event_cue: string | null }[];
  end_behavior: string;
  negative_prompt: string;
}

const secs = (n: number): string => {
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** Build the Seedance JSON for one ideation. Pure — no I/O, no model call. */
export function buildSeedancePrompt(
  ideation: Ideation, dna: FormatDna, profile: ModelProfile,
): SeedancePrompt {
  const beats = ideation.beats ?? [];
  const total = ideation.targetDurationSec ?? dna.pacing?.totalDurationSec ?? 0;

  // Subject wardrobe comes from the ideation's own wardrobe decision where it exists,
  // else the profile default. Never the source video's — that would be copying the surface.
  const subjectWardrobe = ideation.continuityLock?.wardrobeExact
    ?? dna.wardrobeRole?.garments?.join(', ')
    ?? 'as per the attached reference frame';

  const people: SeedancePrompt['people'] = [{
    id: 'subject',
    role: 'main subject on camera',
    // NOT described on purpose — see the module header.
    appearance: 'do not describe — locked reference images are attached',
    wardrobe: subjectWardrobe,
  }];
  for (const c of dna.cast ?? []) {
    people.push({
      id: c.id,
      role: c.offCamera ? `${c.role} (OFF CAMERA — voice only, never in frame)` : c.role,
      appearance: c.offCamera ? 'never visible in frame' : (c.appearance || 'not clearly visible in source'),
      wardrobe: c.offCamera ? 'not visible' : c.wardrobe,
    });
  }

  const a = dna.aesthetic;
  const scene_events: SeedancePrompt['scene_events'] = beats.map((b, i) => {
    const start = beats.slice(0, i).reduce((sum, x) => sum + (x.durationSec ?? 0), 0);
    const spoken = b.dialogue?.trim();
    return {
      timestamp: secs(start),
      speaker: b.speaker ?? 'subject',
      // null, not "" — the recipe is explicit that a silent moment still gets an entry with
      // a null line, and an empty string reads as "said nothing audible" rather than "no
      // dialogue in this beat".
      line: spoken ? spoken.replace(/^VO\s*\([^)]*\):\s*/i, '') : null,
      delivery: spoken ? (profile.voice?.accent ?? 'natural, unperformed') : null,
      action: b.action ?? b.motionBeat ?? 'continues the previous action',
    };
  });

  const shots: SeedancePrompt['shots'] = beats.map((b, i) => {
    const start = beats.slice(0, i).reduce((sum, x) => sum + (x.durationSec ?? 0), 0);
    const end = start + (b.durationSec ?? 0);
    return {
      time: `${secs(start)}–${secs(end)}`,
      action: b.action ?? b.motionBeat ?? '',
      camera_behavior: b.camera ?? dna.camera?.dynamics?.motionSignature ?? 'static handheld, natural micro-shake',
      scene_event_cue: b.dialogue?.trim() ? secs(start) : null,
    };
  });

  const endMap: Record<string, string> = {
    abrupt: 'clip ends abruptly mid-action, like a casually uploaded phone clip — do NOT resolve or settle the shot',
    resolved: 'the action completes and the shot settles briefly before the cut',
    loop: 'the final frame runs back into the first — design the end to loop seamlessly',
  };
  const endBehavior = endMap[dna.pacing?.endBehavior ?? 'abrupt']!;

  return {
    format: `9:16 vertical, ~${Math.round(total)}s, ${ideation.videoFormat === 'ONE_SHOT' ? 'one continuous take' : `${ideation.clipCount} cuts`}, raw phone capture`,
    people,
    environment: [
      dna.setting?.locationType, dna.setting?.timeOfDay,
      dna.setting?.keyProps?.length ? `props: ${dna.setting.keyProps.join(', ')}` : '',
      dna.setting?.colorPalette,
    ].filter(Boolean).join(' · '),
    lighting: [a?.lightingDirection, a?.colorTempK, a?.practicals?.length ? `practicals: ${a.practicals.join(', ')}` : '']
      .filter(Boolean).join(' · ') || (dna.setting?.lighting ?? 'flat natural light'),
    color_grading: a?.grade ?? 'raw ungraded phone profile, auto-exposure, no cinematic grade',
    atmosphere: dna.setting?.mood ?? dna.pacing?.energy ?? 'casual, unperformed',
    audio: dna.audio?.roomTone ?? `${dna.audio?.kind ?? 'ambient'} — phone mic, no added music`,
    pacing: [dna.pacing?.rhythm, dna.pacing?.energy].filter(Boolean).join(', '),
    // Falls back to a NEGATIVE instruction rather than an empty string: an unstated background
    // is what produces a dead, empty set, and law 8 exists precisely to prevent that.
    background_activity: dna.setting?.backgroundActivity
      ?? 'background is alive but secondary — independent movement, nobody looking at camera or performing',
    scene_events,
    style: a?.promptAnchor
      ?? 'Raw casual iPhone footage. NOT cinematic. NOT stabilized. Feels like a real person filmed this on their phone.',
    camera_logic: dna.camera?.dynamics?.motionSignature
      ?? `${dna.camera?.setup ?? 'handheld phone'}, static with natural micro-shake`,
    // Our realismTells are a FIXED enum precisely so they map to deterministic prompt tokens;
    // free-form markers ride along after them.
    imperfections: [...(a?.realismTells ?? []), ...(a?.realismMarkers ?? [])],
    shots,
    end_behavior: endBehavior,
    negative_prompt: [...new Set([...SEEDANCE_NEGATIVES, a?.antiCinematic].filter(Boolean))].join(', '),
  };
}
