/**
 * The built-in CHARACTER-NEUTRAL profile — the default for /generate (Khian, 2026-07-22):
 * analyze → generate our own version, model-agnostic. Prompts address "the subject /
 * the reference image"; no creator identity exists anywhere in the output. Model-specific
 * profiles remain an optional layer on top (pass profileId to use one).
 * Not stored in D1 — compiled in, so it can never be edited into carrying identity.
 */
import type { ModelProfile } from '../../../shared/contract';

const UNIVERSAL_SANITIZE: [string, string][] = [
  ['\\blingerie\\b', 'fitted intimate wear'],
  ['\\bbikini\\b', 'swimwear'],
  ['\\bbra\\b', 'fitted top'],
  ['\\bpanties\\b', 'fitted bottoms'],
  ['\\bunderwear\\b', 'undergarments'],
  ['\\bnude\\b', 'minimal clothing'],
  ['\\bnaked\\b', 'unclothed'],
  ['\\btopless\\b', 'upper body uncovered'],
  ['\\bcleavage\\b', 'neckline'],
  ['\\bsexy\\b', 'attractive'],
  ['\\bseductive\\b', 'confident'],
  ['\\bsensual\\b', 'alluring'],
  ['\\berotic\\b', 'intimate'],
  ['\\bprovocative\\b', 'bold'],
  ['\\bstripper\\b', 'dancer'],
  ['\\bstripping\\b', 'undressing'],
  ['\\bdropping a robe\\b', 'removing outerwear'],
  ['\\btwerk\\b', 'dance move'],
  ['\\bthong\\b', 'minimal bottoms'],
  ['\\bbutt\\b', 'lower body'],
  ['\\bboobs?\\b', 'upper body'],
  ['\\bbreasts?\\b', 'upper body'],
  ['\\bass\\b', 'lower body'],
  ['\\bnsfw\\b', 'mature content'],
];

export const NEUTRAL_PROFILE: ModelProfile = {
  schemaVersion: 1,
  id: 'neutral',
  name: 'Character-neutral',
  version: 1,
  refs: { strategy: 'single_ref_base64' },
  identityLock: {
    opener: 'The subject from the reference image. Raw iPhone footage aesthetic.',
    closer: 'The subject is completely alone. No other person visible. Match the reference image face exactly — do not alter facial features, face shape, skin tone, or hair. NOT professional photography. No phone visible in frame, no device in hand.',
    strippedDescriptors: [],
  },
  looks: {
    makeup: {},
    hair: {},
    wardrobeDefaults: {},
  },
  world: {
    locationWhitelist: [],   // unconstrained — reinvent settings freely from the format
    locationBanlist: [],
    persona: 'the subject — a short-form UGC creator',
    audienceICP: '',         // neutral mode targets the DNA’s own whyItWorks.targetViewer
  },
  voice: {
    captionStyle: 'short casual lowercase IG caption, 3-10 words, 1 emoji max',
    overlayStyle: 'viral IG reel overlay: first person, casual, under 15 words, engineered to trigger comments/shares',
    exampleOverlays: [],
    bannedWords: [],
  },
  toolRules: {
    nb: {
      structureNotes: 'Order: opener → scene/action (the subject MUST face the camera; describe exact body position and both hands) → clothing as SEEN at role level (fabric, cut, exact color shade — never identity) → ONE clear expression described as feeling → hair BEHAVIOR/state only (e.g. "hair tied back", "hair swings loose") — never color/length/texture as identity → camera setup line → lighting with exact source → 1-2 imperfect real props → standing lock if full-body ("Both feet flat on floor, legs straight, standing upright — NOT kneeling, NOT squatting, NOT bending.") → closer. For third-person/propped environmental frames add the anti-portrait block: place the subject off-center by describing the frame ("she stands small near the doorway at the right of the frame; empty wall fills the left half") + "NOT centered, environmental composition, full body visible with feet in frame, lots of negative space, casual composition as if not intentionally framed."',
      bannedPhrases: [
        'age numbers', 'nationality', 'arm extended', 'hand holding phone',
        'studio lighting', 'bokeh', 'DSLR', 'cinematic', 'ring light',
      ],
      mandatoryBlocks: [],
    },
    sd: {
      mandatory: true,
      frameTypeTemplates: {
        FULL_FRONT: 'Enhance the body naturally within the outfit — realistic proportions, natural curves, realistic skin texture. Keep face and background exactly.',
        FULL_SIDE: 'Natural silhouette in profile with realistic proportions. Keep face and background exactly.',
        BACK: 'Natural proportions from behind, realistic fabric fit. Keep hair and background exactly.',
        UPPER_BODY: 'Proportional natural enhancement of the upper body only. Keep face, hair, and background exactly.',
        HEAD_SHOULDERS: 'Enhance skin to a natural realistic texture and tone. Keep face, hair, and background exactly.',
        UNIFORM: 'Fit definition expressed only through the garment fabric. Keep face and background exactly.',
        CONFINED: 'Natural proportions within the tight framing — realistic skin texture. Keep face and background exactly.',
      },
      bannedPhrases: [],
    },
    video: {
      bannedWords: ['flash', 'phone in hand', 'holds phone', 'breathing', 'natural speed'],
      cameraLines: {
        self_held_selfie: 'selfie angle at arm\'s length, natural handheld micro-shake, framing drifts with her movement',
        mirror_selfie: 'mirror selfie, phone moves naturally with the body',
        propped_on_surface: 'placed camera, static locked-off, room visible around the subject',
        third_person: 'handheld phone held by a friend at chest height with a slight downward tilt, slightly shaky, the camera reacts to her movement and settles',
        camera_put_down: 'placed camera, static after set-down, both hands free',
      },
      faceForwardRequired: true,
      confirmedWorkingExamples: [],
    },
  },
  contentPolicy: {
    nsfwAllowed: true,
    sanitizeMap: UNIVERSAL_SANITIZE,
  },
};
