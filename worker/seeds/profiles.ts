/**
 * Seed ModelProfiles. Every Sav literal here is lifted from sav-viral-scanner.js
 * (SAV_IDEA_SYSTEM_PROMPT :1849-1986, SAV_BASE_PROMPT :44-46, sheet ids :41-42,
 * sanitizeMap :2046-2071) — the generator itself is 100% profile-driven.
 * naomi + niko-default are editable stubs (plan §9 Q5) — structure valid, values thin.
 */
import type { ModelProfile } from '../../shared/contract';

const SAV_CLOSER =
  'She is completely alone. No other person visible. Match the uploaded reference image face exactly — do not alter facial features, face shape, skin tone, freckles, or hair. No under-eye bags, no eye creases, no forehead lines, no nasolabial folds. Zero signs of aging. NOT professional photography. No phone visible in frame, no device in hand.';

const SANITIZE_MAP: [string, string][] = [
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

export const SAV_PROFILE: ModelProfile = {
  schemaVersion: 1,
  id: 'sav',
  name: 'Sav',
  version: 1,
  refs: {
    faceSheetId: '28593900-cd19-4e6f-a470-f9df3d660e8b',
    bodySheetId: 'c3d906c9-93b7-413c-9d59-31b5a4bc211b',
    strategy: 'sheet_ids',
  },
  identityLock: {
    opener: 'Refer to the girl in the reference images. Raw iPhone footage aesthetic.',
    closer: SAV_CLOSER,
    strippedDescriptors: [
      'half[- ]brazilian', 'platinum blonde', 'sandy[- ]?blonde', 'green eyes',
      'freckle[sd]?', '2[0-3][- ]year[- ]old', 'brazilian', 'olive skin',
    ],
  },
  looks: {
    makeup: {
      default: 'Light-medium coverage foundation, softly contoured cheekbones, defined natural brows, individual lashes, mascara, soft nude gloss lip.',
      uniform: 'Full coverage foundation, softly contoured cheekbones, filled defined brows with subtle highlight beneath the arch, individual false lashes, thin winged eyeliner, warm nude lip.',
    },
    hair: {
      default: 'loose wavy curls, down',
      uniform: 'slicked-back bun, two loose face-framing strands',
      pool: 'slightly damp, natural',
    },
    nails: 'almond-shaped nails in nude, soft pink, french, or coral',
    wardrobeDefaults: {
      'work uniform': 'United Airlines flight attendant uniform: dark navy V-neck dress, cobalt blue scarf, silver wings pin on LEFT CHEST',
      'going-out fit': 'fitted ruched bodycon mini dress, exact color per scene, ribbed or smooth knit — never satin, linen, or flowing fabric',
      'casual': 'ribbed knit fitted lounge set',
      'athleisure': 'fitted two-piece outfit',
      'swim': 'fitted two-piece outfit',
    },
    workContextRatio: '20-30% uniform / 70-80% off-duty',
  },
  world: {
    locationWhitelist: [
      'hotel room', 'hotel bathroom (marble/gold)', 'airline lavatory (NO mirror in prompt)',
      'elevator mirror selfie', 'pool', 'villa', 'outdoor terrace', 'beach',
      'apartment balcony', 'restaurant bathroom', 'outdoor cafe', 'airport terminal',
      'airplane galley/cabin',
    ],
    locationBanlist: ['mansion', 'yoga studio', 'generic gym', 'dark rooms', 'landmark backgrounds'],
    persona: 'a young woman who works as a flight attendant — fashion/lifestyle Instagram creator',
    audienceICP: 'Men 35-50+, American, financially stable',
  },
  voice: {
    captionStyle: '3-8 words, all lowercase, 1 emoji max, no apostrophes, no exclamation points',
    overlayStyle: 'first person, casual, self-deprecating or ICP-calling, under 15 words, engineered to trigger comments/debate/shares',
    exampleOverlays: [
      'the guys who just stare and dont say hi are always the cutest',
      'he offered to carry my bag like that was gonna work',
      'getting ready for plans i will cancel in 20 minutes',
    ],
    bannedWords: ['babe', 'hun', 'bb'],
    accent: 'light, natural American accent — clear and unremarkable, not theatrical',
  },
  toolRules: {
    nb: {
      structureNotes: '12-step order: opener → scene/action (she MUST face camera; "taking a selfie style image" for selfie content) → clothing (fabric, cut, exact color, neckline) → ONE expression from: heavy-lidded direct gaze | mouth slightly open caught | half-smile one corner | direct neutral stare | eyes slightly closed head back | tongue tip between lips → hair (per look key) → makeup (per look key, MANDATORY) → nails → camera → lighting (exact source) → 1-2 imperfect real props → standing lock if full-body ("Both feet flat on floor, legs straight, standing upright — NOT kneeling, NOT squatting, NOT bending.") → closer.',
      bannedPhrases: [
        'age numbers', 'nationality', 'arm extended', 'hand holding phone',
        'mid-laugh head tilted back', 'satin', 'linen', 'flowing',
        'studio lighting', 'bokeh', 'DSLR', 'cinematic', 'ring light',
      ],
      mandatoryBlocks: [
        'Both feet flat on floor, legs straight, standing upright — NOT kneeling, NOT squatting, NOT bending. (full-body frames only)',
      ],
    },
    sd: {
      mandatory: true,
      frameTypeTemplates: {
        // "full" removed (Aug-14, improvement-log item 1): the word makes Seedream
        // over-dramatize the body — "natural / soft + realistic NOT exaggerated" reads
        // correct every time. autofixSdBodyWord() re-cleans this at runtime for any live
        // profile still carrying "full".
        FULL_FRONT: 'Fill the [clothing] with her natural curves — defined narrow waist with visible indent, toned midsection, natural upper body proportions, soft thighs, realistic proportions NOT exaggerated. Keep face and [background].',
        FULL_SIDE: 'S-curve silhouette with natural proportions — defined waist, soft natural curves in profile, realistic NOT exaggerated. Keep face and background.',
        BACK: 'Natural lower-body proportions with defined waist from behind, realistic NOT exaggerated. Keep hair and background.',
        UPPER_BODY: 'Proportional natural enhancement of the upper body only — keep face, hair, and background exactly.',
        HEAD_SHOULDERS: 'Enhance skin to natural warm tone. Keep face, hair, and background.',
        UNIFORM: 'Waist definition only, expressed through the uniform fabric fit. Keep face and background.',
        CONFINED: 'Natural proportions within the tight framing — realistic skin texture. Keep face and background.',
      },
      bannedPhrases: [],
    },
    video: {
      bannedWords: ['flash', 'phone in hand', 'holds phone', 'breathing', 'natural speed'],
      cameraLines: {
        self_held_selfie: 'selfie angle, natural handheld micro-shake, phone drifts with movement',
        mirror_selfie: 'mirror selfie, phone moves naturally with her body',
        propped_on_surface: 'placed camera at hip height, full body visible, static',
        third_person: 'friend-filmed handheld at eye level, subtle natural micro-shake',
        camera_put_down: 'placed camera, static after set-down, full body visible',
      },
      faceForwardRequired: true,
      confirmedWorkingExamples: [
        'She kneels on white bed in black fitted outfit looking up at camera, bites lower lip and holds it, rolls shoulders back arching spine confidently, shifts weight rocking forward then back, one hand runs up her own thigh, head tilts to one side heavy-lidded stare, amber lamp casts warm side light, camera drifts with natural handheld micro-movement',
        'She stands at mirror holding phone, arm stays extended across her upper body throughout, sways hips side to side rhythmically shifting weight between legs, body rolls in confident wave, subtle playful smirk grows, chin dips eyes look up, warm chandelier glow, phone moves with body, mirror selfie',
      ],
    },
  },
  contentPolicy: {
    nsfwAllowed: true,
    sanitizeMap: SANITIZE_MAP,
  },
};

export const NAOMI_PROFILE: ModelProfile = {
  ...structuredClone(SAV_PROFILE),
  id: 'naomi',
  name: 'Naomi',
  refs: { strategy: 'single_ref_base64' },   // NB Pro single-ref + base64 method (no sheet ids)
  identityLock: {
    opener: 'Refer to the girl in the reference image. Raw iPhone footage aesthetic.',
    closer: 'She is completely alone. No other person visible. Match the uploaded reference image face exactly — do not alter facial features, face shape, skin tone, or hair. Zero signs of aging. NOT professional photography. No phone visible in frame, no device in hand.',
    strippedDescriptors: [],
  },
  world: {
    locationWhitelist: ['apartment', 'city street', 'cafe', 'rooftop bar', 'hotel room', 'beach'],
    locationBanlist: ['mansion', 'yoga studio', 'generic gym', 'dark rooms', 'landmark backgrounds'],
    persona: 'a young woman lifestyle creator',   // TODO Khian: Naomi persona + world (plan §9 Q5)
    audienceICP: 'Men 35-50+, American, financially stable',
  },
  looks: {
    ...structuredClone(SAV_PROFILE.looks),
    wardrobeDefaults: {
      'going-out fit': 'fitted bodycon mini dress, exact color per scene',
      'casual': 'fitted knit lounge set',
      'athleisure': 'fitted two-piece outfit',
      'swim': 'fitted two-piece outfit',
    },
    workContextRatio: undefined,
  },
};

export const BELLE_PROFILE: ModelProfile = {
  ...structuredClone(SAV_PROFILE),
  id: 'belle',
  name: 'Belle',
  refs: { strategy: 'single_ref_base64' },   // NB nano-banana-2 single/base64 ref method (face + body sheets)
  identityLock: {
    opener: 'Candid amateur iPhone photo of the SAME woman shown in the reference image. Raw iPhone footage aesthetic.',
    closer: 'She is completely alone. No other person visible. Match the uploaded reference image face exactly — do not alter her face, face shape, copper-red hair, heavy natural freckles, or green blue-green eyes. Keep her youthful early-20s look, zero signs of aging. Realistic natural skin texture with visible pores and freckles, NOT airbrushed, NOT over-smoothed. NOT professional photography, NOT studio lighting.',
    strippedDescriptors: [
      'copper[- ]?red', 'ginger', 'freckle[sd]?', 'green[- ]?eyes', 'blue[- ]?green eyes',
      '2[0-3][- ]year[- ]old', 'texan', 'redhead',
    ],
  },
  looks: {
    ...structuredClone(SAV_PROFILE.looks),
    makeup: {
      default: 'Light natural everyday makeup — freckles showing through, mascara, groomed auburn brows, soft nude-rose lip.',
      uniform: 'Soft country glam — subtle bronze eye, individual lashes, freckle-forward, warm nude lip.',
    },
    hair: {
      default: 'long loose copper-red waves, down',
      uniform: 'copper waves under a cowboy hat, or a loose braid',
      pool: 'slightly damp copper waves, natural',
    },
    wardrobeDefaults: {
      'signature': 'cowgirl/western: Daisy Dukes denim shorts, cowboy boots, fitted western/plaid shirt tied at the waist, cowboy hat',
      'going-out fit': 'fitted bodycon mini dress or a going-out western fit, exact color per scene',
      'casual': 'fitted ribbed tank and denim shorts, or a fitted knit set',
      'athleisure': 'fitted two-piece outfit',
      'swim': 'fitted two-piece outfit',
      'ranch work': 'fitted plaid shirt, denim cutoffs, boots',
    },
    workContextRatio: '20-30% cowgirl/western signature / 70-80% off-duty ranch lifestyle',
  },
  world: {
    locationWhitelist: [
      'Twin Oaks Ranch porch', 'ranch corral / cattle fence', 'horse stable / barn',
      'open Texas pasture', 'faded red 1970s Chevy pickup (tailgate)', 'dirt road',
      'the Rusty Spur honky-tonk (mechanical bull, neon, dance floor)', 'rodeo arena',
      'rustic farmhouse kitchen', 'farmhouse bedroom', 'hay field at golden hour',
    ],
    locationBanlist: ['mansion', 'yoga studio', 'generic gym', 'dark rooms', 'landmark backgrounds', 'city skyline'],
    persona: 'a 22-year-old Texas ranch girl — fiery freckled redhead, animal-softie, rodeo/barrel-racing, Southern cooking; visual-first lifestyle Instagram creator',
    audienceICP: 'Men 35-50+, American, financially stable',
  },
  voice: {
    captionStyle: 'warm and playful with a light Texas drawl, mostly lowercase, occasional y\'all / ain\'t / fixin\' to / darlin\', 1 country emoji, no over-punctuation',
    overlayStyle: 'first person, warm with a wink, country-specific, under 15 words, engineered to trigger comments/debate/shares',
    exampleOverlays: [
      'me n Cash beat the boys barrel time again dont tell em it was easy',
      'told mama Buford got loose on the highway never seen a woman move that fast',
      'got my horse my dog n mamas cookin what do i need a man for',
    ],
    bannedWords: ['babe', 'hun', 'bb'],
    accent: 'soft warm Texas drawl, not theatrical',
  },
  contentPolicy: {
    nsfwAllowed: false,   // SFW IG account for now (pivot: NSFW/Telegram later)
    sanitizeMap: SANITIZE_MAP,
  },
};

export const NIKO_DEFAULT_PROFILE: ModelProfile = {
  ...structuredClone(NAOMI_PROFILE),
  id: 'niko-default',
  name: 'Niko — template',
  refs: { strategy: 'sheet_ids' },   // TODO Niko: face/body sheet ids + world + voice (plan §9 Q5)
  world: {
    locationWhitelist: [],
    locationBanlist: [],
    persona: 'TEMPLATE — set the model persona here',
    audienceICP: 'TEMPLATE — set the target audience here',
  },
};

export const SEED_PROFILES = [SAV_PROFILE, NAOMI_PROFILE, BELLE_PROFILE, NIKO_DEFAULT_PROFILE];
