/**
 * shared/schemas.ts · schemaVersion 1
 *
 * THE contract. Zod schemas are the single source of truth:
 *  - TypeScript types are inferred from these (see contract.ts)
 *  - Gemini responseSchema / responseJsonSchema is derived via z.toJSONSchema()
 *  - The worker validates every analyzer/generator output against these at runtime
 *
 * Nobody parses prose, ever. (FABLE5-PLAN §3)
 */
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────
export const PlatformSchema = z.enum(['tiktok', 'instagram', 'youtube', 'pinterest', 'upload']);
export const ContentRatingSchema = z.enum(['sfw', 'borderline', 'nsfw']);
export const VideoModelChoiceSchema = z.enum(['kling_3', 'cdance_2']);
export const VideoFormatSchema = z.enum(['ONE_SHOT', 'MULTI_CLIP']);
export const VariationStrengthSchema = z.enum(['close', 'medium', 'bold']);
export const GenerationStatusSchema = z.enum(['draft', 'approved', 'produced']);
export const DifficultyScoreSchema = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
]);

export const SdFrameTypeSchema = z.enum([
  'FULL_FRONT', 'FULL_SIDE', 'BACK', 'UPPER_BODY', 'HEAD_SHOULDERS', 'UNIFORM', 'CONFINED',
]);

// ─────────────────────────────────────────────────────────────
// Source meta
// ─────────────────────────────────────────────────────────────
export const SourceMetaSchema = z.object({
  url: z.string().optional(),
  platform: PlatformSchema,
  thumbnailUrl: z.string().optional(),
  durationSec: z.number(),
  clipCount: z.number().int(),
  isOneShot: z.boolean(),
  originalHandle: z.string().optional(),
  analyzedAt: z.string(),           // ISO timestamp
  analyzerVersion: z.string(),      // e.g. "ugc-api@1.0.0/gemini-3-pro-preview"
});

// ─────────────────────────────────────────────────────────────
// Camera language (ports worker-v4.2.0.js §0 — the best IP in the old prompt)
// ─────────────────────────────────────────────────────────────
export const CameraSetupKindSchema = z.enum([
  'self_held_selfie', 'mirror_selfie', 'propped_on_surface', 'third_person', 'camera_put_down',
]);

export const CameraSetupSchema = z.object({
  setup: CameraSetupKindSchema,
  facing: z.enum(['front', 'rear']),
  phoneVisible: z.enum(['no', 'in_mirror', 'on_surface']),
  distance: z.string(),             // "arm's length ~50cm" | "~1.5m propped"
  heightAngle: z.string(),          // "knee height tilted up 15°" — never default "eye level"
  motion: z.enum(['static', 'micro_shake', 'drift', 'put_down_then_static', 'pan_tilt']),
  hiddenArm: z.enum(['left', 'right', 'none']),
  placementNote: z.string().optional(),   // "inside open fridge looking up"
  transitions: z.string().optional(),     // cut style between clips
});

export const HookSchema = z.object({
  type: z.enum(['visual', 'text', 'question', 'mid_action', 'pattern_interrupt', 'audio']),
  openingVisual: z.string(),        // what is literally on screen at 0:00
  firstLineOrText: z.string().optional(),
  mechanism: z.string(),            // WHY it stops the thumb
  coherenceWithCaption: z.string().optional(),
});

// ── Beat = the atomic unit of the shot list ──
export const BeatSchema = z.object({
  index: z.number().int(),
  clipIndex: z.number().int(),      // which cut it belongs to (0 for one-shot)
  startSec: z.number(),
  endSec: z.number(),
  action: z.string(),               // on-screen action, action verbs
  rightHand: z.string(),
  leftHand: z.string(),
  cameraMove: z.string(),
  framing: z.string(),              // "waist-up, subject fills 60%"
  expressionEnergy: z.string(),     // feeling, not facial muscles
  dialogue: z.string().optional(),
  onScreenText: z.string().optional(),
  startsOnCut: z.boolean(),
});

export const FrameSpecSchema = z.object({
  frameId: z.string(),              // "clip0-thumbnail"
  role: z.enum(['thumbnail', 'opening', 'middle', 'closing', 'representative']),
  clipIndex: z.number().int(),
  timestampSec: z.number(),
  justification: z.string().optional(),   // required for 'middle' (enforced in prompt)
  // Identity-free scene description — the input to every image-prompt compiler.
  scene: z.object({
    framing: z.string(),
    cropBoundaries: z.string(),     // what body part at each frame edge
    subjectPlacement: z.string(),   // position in frame + orientation in degrees
    bodyPosition: z.string(),       // spine/shoulders/head/hips/weight — standing verified
    action: z.string(),
    hands: z.object({ right: z.string(), left: z.string() }),
    wardrobeVisible: z.string(),    // garments AS SEEN, role-level ("black ruched bodycon mini")
    environmentLayout: z.string(),  // composition map: left/center/right zones, depth, verticals
    lighting: z.string(),           // sources, direction, color temperature, shadows
    colorGrade: z.string(),
    motionState: z.string(),        // static vs mid-action, weight transfer
    fabric: z.string(),             // texture/behavior/finish
    nsfwElements: z.array(z.string()),  // raw observations; sanitization happens at generation
  }),
});

// ─────────────────────────────────────────────────────────────
// FORMAT DNA — durable, model-independent (brief §4a). THE library asset.
// ─────────────────────────────────────────────────────────────
export const FormatDnaSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  version: z.number().int(),
  title: z.string(),                // human name, e.g. "Elevator outfit-check freeze"
  archetype: z.string(),            // 'grwm_voiceover' | 'pov_walk_and_talk' |
                                    // 'transformation_reveal' | 'text_monologue' |
                                    // 'talking_head' | 'skit' | 'outfit_showcase' | free-form
  tags: z.array(z.string()),
  hook: HookSchema,
  beats: z.array(BeatSchema),       // beat-by-beat shot list w/ timestamps
  camera: CameraSetupSchema,
  setting: z.object({
    locationType: z.string(),       // ROLE not address: "hotel bathroom, marble"
    timeOfDay: z.string(),
    lighting: z.string(),
    keyProps: z.array(z.string()),
    colorPalette: z.string(),
    mood: z.string(),
  }),
  wardrobeRole: z.object({          // role, never identity
    role: z.string(),               // "athleisure" | "going-out fit" | "work uniform"
    garments: z.array(z.string()),
    stylingNotes: z.string(),
  }),
  pacing: z.object({
    totalDurationSec: z.number(),
    cutCount: z.number().int(),
    isOneShot: z.boolean(),
    rhythm: z.string(),             // "cuts every ~0.8s on beat" | "single slow take"
    energy: z.string(),
  }),
  audio: z.object({
    kind: z.enum(['trending_audio', 'voiceover', 'ambient', 'silent_text_overlay', 'original_dialogue']),
    genre: z.string().optional(),
    bpmEstimate: z.number().optional(),
    mood: z.string().optional(),
    voiceoverStyle: z.string().optional(),
    trendingSoundDependent: z.boolean(),
    syncNotes: z.string().optional(),  // "cuts land on drops"
  }),
  textOverlays: z.object({
    present: z.boolean(),
    cadence: z.string(),
    placement: z.string(),
    copyStyle: z.string(),
    hookLine: z.string().optional(),
    items: z.array(z.object({
      text: z.string(),
      atSec: z.number(),
      position: z.string(),
      style: z.string(),
    })),
  }),
  script: z.object({
    structure: z.string(),          // "[HOOK]/[BODY]/[CTA]"
    lines: z.array(z.object({
      atSec: z.number(),
      beatIndex: z.number().int(),
      text: z.string(),
    })),
  }).optional(),
  whyItWorks: z.object({            // the teaching layer — the ~80% that must survive ideation
    mechanism: z.string(),          // retention/psychological driver
    retentionDrivers: z.array(z.string()),
    targetViewer: z.string(),
    shareCommentTrigger: z.string().optional(),
  }),
  difficulty: z.object({
    environment: DifficultyScoreSchema,
    motion: DifficultyScoreSchema,
    camera: DifficultyScoreSchema,
    overall: DifficultyScoreSchema,
    workarounds: z.array(z.string()),
  }),
  swapMap: z.object({               // what makes it THIS format vs what's replaceable
    mustKeep: z.array(z.string()),  // "freeze-frame at 0:02", "text cadence", "propped low angle"
    swappable: z.array(z.string()), // "identity", "outfit color", "specific hallway"
  }),
  contentFlag: z.object({
    rating: ContentRatingSchema,
    triggers: z.array(z.string()),
  }),
  frames: z.array(FrameSpecSchema), // identity-free frame specs (4-frame rule for one-shots,
                                    // 3/1 per clip for multi-clip — port of worker §13)
  source: SourceMetaSchema,
  // Analysis-only observation of the original creator — NEVER enters prompts
  // (preserves worker-v4.2.0.js:91 character-appearance firewall structurally):
  characterObservation: z.object({
    appearance: z.string(),
    outfit: z.string(),
    vibe: z.string(),
  }),
});

/**
 * What the ANALYZER must return: the DNA minus everything the worker fills itself
 * (id, version, schemaVersion, source). Derived — never drifts from FormatDnaSchema.
 * Phase 2 feeds z.toJSONSchema(AnalyzerOutputSchema) to Gemini as the responseSchema.
 */
export const AnalyzerOutputSchema = FormatDnaSchema.omit({
  schemaVersion: true, id: true, version: true, source: true,
});

// ─────────────────────────────────────────────────────────────
// MODEL PROFILE — swappable identity (brief §4b). Zero identity anywhere else.
// ─────────────────────────────────────────────────────────────
export const ModelProfileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),                   // 'sav' | 'naomi' | 'niko-<model>'
  name: z.string(),
  version: z.number().int(),
  refs: z.object({
    faceSheetId: z.string().optional(),
    bodySheetId: z.string().optional(),
    strategy: z.enum(['sheet_ids', 'single_ref_base64']),  // Naomi uses NB single-ref+base64
  }),
  identityLock: z.object({
    opener: z.string(),             // "Refer to the girl in the reference images. …"
    closer: z.string(),             // face-match block, anti-aging clause, alone clause
    strippedDescriptors: z.array(z.string()),  // regexes of identity words to strip if the LLM leaks them
  }),
  looks: z.object({                 // keyed looks; format's wardrobeRole.role maps into these
    makeup: z.record(z.string(), z.string()),  // { default, uniform, pool, ... }
    hair: z.record(z.string(), z.string()),
    nails: z.string().optional(),
    wardrobeDefaults: z.record(z.string(), z.string()),  // role → concrete outfit description
    workContextRatio: z.string().optional(),   // "20-30% uniform / 70-80% off-duty"
  }),
  world: z.object({
    locationWhitelist: z.array(z.string()),
    locationBanlist: z.array(z.string()),
    persona: z.string(),            // "young woman who works as a flight attendant"
    audienceICP: z.string(),        // "men 35-50+, American, financially stable"
  }),
  voice: z.object({
    captionStyle: z.string(),       // "3-8 words lowercase, 1 emoji max, no apostrophes"
    overlayStyle: z.string(),
    exampleOverlays: z.array(z.string()),
    bannedWords: z.array(z.string()),
    hashtagPool: z.array(z.string()).optional(),
  }),
  toolRules: z.object({             // per-tool prompt-compiler config
    nb: z.object({
      structureNotes: z.string().optional(),
      bannedPhrases: z.array(z.string()),
      mandatoryBlocks: z.array(z.string()),
    }),
    chatgpt2: z.object({
      structureNotes: z.string(),
      bannedPhrases: z.array(z.string()),
    }).optional(),
    sd: z.object({
      mandatory: z.literal(true),
      frameTypeTemplates: z.record(SdFrameTypeSchema, z.string()),
      bannedPhrases: z.array(z.string()),
    }),
    video: z.object({
      bannedWords: z.array(z.string()),  // "slowly" x1 max, "flash", "phone in hand", …
      cameraLines: z.record(CameraSetupKindSchema, z.string()),
      faceForwardRequired: z.literal(true),
      confirmedWorkingExamples: z.array(z.string()),
    }),
  }),
  contentPolicy: z.object({
    nsfwAllowed: z.boolean(),
    sanitizeMap: z.array(z.tuple([z.string(), z.string()])),  // ports scanner:2046-2074
  }),
});

// ─────────────────────────────────────────────────────────────
// GENERATION — per (format, profile). IDEATION, not clone (brief §4g).
// A run returns ~3 distinct ideations; the operator picks the winner.
// ─────────────────────────────────────────────────────────────
export const BeatGenerationSchema = z.object({
  clipIndex: z.number().int(),
  sourceFrameId: z.string().optional(),  // FormatDNA.frames inspiration, if any — beats are
                                         // re-imagined, so this is provenance, not a 1:1 FK
  timestamp: z.string(),            // "0:00-0:05"
  action: z.string(),
  camera: z.string(),
  expression: z.string(),
  dialogue: z.string().optional(),
  nbPrompt: z.string(),             // NanoBanana first-frame/still prompt (identity-locked)
  chatgpt2Prompt: z.string().optional(),  // alt image tool, when requested
  sdPrompt: z.string(),             // Seedream delta — MANDATORY, never empty (type-enforced)
  sdFrameType: SdFrameTypeSchema,
  motionPrompt: z.string(),         // Kling/CDance clip prompt
  motionPromptCharCount: z.number().int(),  // enforced ≤310/clip (multi) or 800-1200 (one-shot Kling)
});

/** One of the ~3 treatments: keeps whyItWorks + swapMap.mustKeep, reinvents the rest. */
export const IdeationSchema = z.object({
  index: z.number().int(),          // 0..N within the run
  title: z.string(),                // short name of this angle
  angle: z.string(),                // one-paragraph: what this treatment does differently
  keptFromOriginal: z.array(z.string()),   // which mustKeep items are honored (traceability)
  reinvented: z.array(z.string()),         // which swappable surfaces were re-imagined, and how
  whyItWorksForProfile: z.string(), // the OG mechanism re-aimed at THIS profile's ICP
  creativeBrief: z.string(),
  videoModel: z.object({ choice: VideoModelChoiceSchema, reason: z.string() }),
  faceForwardNote: z.string().nullable(),  // sequence adjustment, or null
  videoFormat: VideoFormatSchema,
  targetDurationSec: z.number(),
  clipCount: z.number().int(),
  beats: z.array(BeatGenerationSchema),    // per-beat prompts — the portable-prompt payload
  audioPlan: z.object({
    type: z.enum(['trending_audio', 'voiceover', 'ambient', 'silent_text_overlay', 'original_dialogue']),
    description: z.string(),
    syncNotes: z.string().optional(),
  }),
  editingNotes: z.string(),
  copy: z.object({
    caption: z.string(),
    hashtags: z.array(z.string()),
    textOverlays: z.array(z.string()),     // 3 options in profile voice
  }),
  qaChecklist: z.object({
    nbChecks: z.array(z.string()),
    sdChecks: z.array(z.string()),
    videoChecks: z.array(z.string()),
  }),
  status: GenerationStatusSchema,
});

/** A generation run = one /generate call: (format, profile, strength) → ~3 ideations. */
export const GenerationRunSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  formatId: z.string(),
  formatVersion: z.number().int(),
  profileId: z.string(),
  profileVersion: z.number().int(),
  variationStrength: VariationStrengthSchema,  // close-but-fresh (default) → bold
  formulaExtracted: z.string(),     // the format's formula, shared across ideations
  ideations: z.array(IdeationSchema),
  createdAt: z.string(),
  generatorVersion: z.string(),
});

// ─────────────────────────────────────────────────────────────
// Jobs + API envelope
// ─────────────────────────────────────────────────────────────
export const JobSchema = z.object({
  id: z.string(),
  kind: z.enum(['analyze']),
  status: z.enum(['queued', 'running', 'done', 'error']),
  resultFormatId: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ApiErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  detail: z.unknown().optional(),
});

export const AnalyzeResponseSchema = z.object({
  job: z.object({ id: z.string() }).optional(),   // async path (>90s videos)
  format: FormatDnaSchema.optional(),             // sync path
});

/** Lightweight row for library lists — everything a card/filter needs, no DNA body. */
export const FormatSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  archetype: z.string(),
  hookType: z.string().nullable(),
  contentRating: ContentRatingSchema.nullable(),
  durationSec: z.number().nullable(),
  clipCount: z.number().int().nullable(),
  platform: PlatformSchema.nullable(),
  sourceUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  tags: z.array(z.string()),
  version: z.number().int(),
  schemaVersion: z.string(),        // '1' | '0-legacy' (migrated pre-rebuild entries)
  createdAt: z.string(),
  updatedAt: z.string(),
});
