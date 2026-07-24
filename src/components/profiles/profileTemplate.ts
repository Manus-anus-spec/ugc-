/**
 * Template for a brand-new model profile — sane production defaults (mirrors the
 * worker's built-in neutral profile) so adding a new girl is a 5-minute form fill,
 * not a JSON authoring session. Everything here is editable in the form or the
 * advanced JSON panel.
 */
import type { ModelProfile } from '@shared/contract';

export function newProfileTemplate(id: string, name: string): ModelProfile {
  return {
    schemaVersion: 1,
    id,
    name,
    version: 0,   // server bumps to 1 on first save
    refs: { strategy: 'single_ref_base64' },
    identityLock: {
      opener: 'Refer to the girl in the reference images. Raw iPhone footage aesthetic.',
      closer: 'The subject is completely alone. No other person visible. Match the reference image face exactly — do not alter facial features, face shape, skin tone, or hair. NOT professional photography. No phone visible in frame, no device in hand.',
      strippedDescriptors: [],
    },
    looks: {
      makeup: { default: 'natural everyday makeup, soft glam' },
      hair: { default: 'styled as in the reference images' },
      wardrobeDefaults: {},
    },
    body: {
      build: '',
      proportions: '',
      skin: 'natural realistic skin texture with visible pores',
      sdEnhancementNotes: 'Enhance the body naturally within the outfit — realistic proportions, natural curves. Keep the face exactly.',
    },
    world: {
      locationWhitelist: [],
      locationBanlist: [],
      persona: '',
      backstory: '',
      audienceICP: '',
    },
    voice: {
      captionStyle: 'short casual lowercase IG caption, 3-10 words, 1 emoji max',
      overlayStyle: 'viral IG reel overlay: first person, casual, under 15 words, engineered to trigger comments/shares',
      exampleOverlays: [],
      bannedWords: [],
    },
    toolRules: {
      nb: {
        structureNotes: 'Order: opener → scene/action (the subject MUST face the camera; describe exact body position and both hands) → clothing as SEEN at role level (fabric, cut, exact color shade — never identity) → ONE clear expression described as feeling → hair BEHAVIOR/state only — never color/length/texture as identity → camera setup line → lighting with exact source → 1-2 imperfect real props → standing lock if full-body → closer.',
        bannedPhrases: ['age numbers', 'nationality', 'arm extended', 'hand holding phone', 'studio lighting', 'bokeh', 'DSLR', 'cinematic', 'ring light'],
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
          self_held_selfie: 'selfie angle, natural handheld micro-shake, phone drifts with movement',
          mirror_selfie: 'mirror selfie, phone moves naturally with the body',
          propped_on_surface: 'placed camera, full body visible, static locked-off',
          third_person: 'friend-filmed handheld at eye level, subtle natural micro-shake',
          camera_put_down: 'placed camera, static after set-down, both hands free',
        },
        faceForwardRequired: true,
        confirmedWorkingExamples: [],
      },
    },
    contentPolicy: {
      nsfwAllowed: true,
      sanitizeMap: [
        ['\\blingerie\\b', 'fitted intimate wear'],
        ['\\bbikini\\b', 'swimwear'],
        ['\\bnude\\b', 'minimal clothing'],
        ['\\bsexy\\b', 'attractive'],
        ['\\bseductive\\b', 'confident'],
      ],
    },
  };
}
