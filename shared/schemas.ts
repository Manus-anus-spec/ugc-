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
/** Operator feedback on a finished run. A SECOND, INDEPENDENT axis from `status`
 *  (draft|approved|produced) — the two vocabularies are deliberately not merged, so
 *  "where is this in the pipeline" and "was it any good" never collide. Stored in its
 *  own columns (migration 0004), never in the run's output JSON. */
export const GenerationVerdictSchema = z.enum(['up', 'down', 'shipped']);
export const DifficultyScoreSchema = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
]);

export const SdFrameTypeSchema = z.enum([
  'FULL_FRONT', 'FULL_SIDE', 'BACK', 'UPPER_BODY', 'HEAD_SHOULDERS', 'UNIFORM', 'CONFINED',
]);

// ── Filming-fidelity primitives (v3 "reproduce the filming" upgrade) ──
export const ShotSizeSchema = z.enum(['ECU', 'CU', 'MS', 'WS']);
/** aroll = the subject carries the shot; broll = a CUTAWAY insert (hands-only,
 *  food/product close-up, environment detail) — the pacing tool of real UGC, and
 *  cheaper for us to produce: no face, no identity lock, no body pass. */
export const ShotTypeSchema = z.enum(['aroll', 'broll']);
export const CameraAngleSchema = z.enum(['eye', 'low', 'high', 'overhead', 'pov']);
export const CutTransitionSchema = z.enum(['hard', 'match', 'whip', 'jump']);
// 'reproduce' = transplant one source's filming 1:1; 'adapt' = reinvent one source's surface;
// 'synthesize' (FABLE5 §10) = fuse the MECHANISMS of N high-scoring library blueprints into ONE
// genuinely-new format (the "fresh video" / surprise-me engine), copying no concrete detail.
export const FidelityModeSchema = z.enum(['reproduce', 'adapt', 'synthesize']);
export const FirstFrameSourceSchema = z.enum(['hero_still', 'prev_clip_last_frame', 'fresh_nb']);

/** Reproducible camera-real "tells", constrained so each maps to a canned NB token +
 *  a canned motion token in rules.ts (REALISM_TELL_TOKENS). Free-form markers stay in
 *  aesthetic.realismMarkers for description; THESE drive deterministic injection. */
export const RealismTellSchema = z.enum([
  'sensor-noise-in-shadows', 'motion-blur-on-fast-moves', 'blown-highlights',
  'autofocus-breathing', 'imperfect-headroom', 'fluorescent-flicker', 'rolling-shutter',
]);

/** What moves BESIDES the subject's primary action — hair/fabric/soft-tissue/jewelry
 *  inertia. A generated beat wants 1–2 NATURAL secondary cues (e.g. hair on a head-turn,
 *  fabric on a weight-shift) — NOT all four. Too many cues make video models animate the
 *  clothing/accessories over the person (FABLE5 humanization, guide §7). The analyzer may
 *  observe all four; the generator caps to the 1–2 most natural (rules.ts ensureSecondaryMotion). */
export const SecondaryMotionSchema = z.object({
  hair: z.string(),          // "hair swings forward as she leans, settles over ~0.5s" | "tied back, static"
  fabric: z.string(),        // "apron ripples with each arm move" | "rigid denim, minimal"
  softBody: z.string(),      // natural soft-tissue inertia on action beats, as observed
  accessories: z.string(),   // "hoop earrings swing on the head turn" | "none"
});

/** Canonical format taxonomy — the filterable library axis (free-form archetype stays as flavor). */
export const FormatTypeSchema = z.enum([
  'talking_head', 'skit', 'pov', 'grwm', 'transformation', 'outfit_showcase',
  'walk_and_talk', 'mirror_selfie', 'text_monologue', 'vlog_moment', 'reaction',
  'tutorial', 'lifestyle_montage', 'thirst_trap', 'other',
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
  /** v3 honesty stamps: the fps the video was actually sampled at (every timing field
   *  is only as precise as this grid) + how much to trust the timings (drops to 'low'
   *  when Gemini ignored our fps request or the numeric gate needed a forced repair). */
  samplingFps: z.number().optional(),
  timingConfidence: z.enum(['high', 'medium', 'low']).optional(),
  /** PROVENANCE OF THE TIMINGS (2026-08-31). 'measured' = the client supplied frame-exact
   *  cuts (ffmpeg) and the beat boundaries are those cuts. 'estimated' = derived from a
   *  sampled Pass A. Absent on rows analysed before this existed.
   *
   *  This is not decoration. Beat timings drive per-beat prompts and the retention critique's
   *  timestamps, and a reader has no other way to tell a frame-exact boundary from a ±1s
   *  guess. Recording it means the two are never silently mixed. */
  cutSource: z.enum(['estimated', 'measured']).optional(),
  /** Whether a client-supplied transcript was used, and how far it was trusted. Recorded
   *  because a transcript is ANOTHER MODEL'S OUTPUT, not an observation — a hallucinated line
   *  entering the DNA unmarked would become permanent library ground truth. */
  transcriptSource: z.enum(['none', 'client_high', 'client_low', 'client_no_speech']).optional(),
});

// ─────────────────────────────────────────────────────────────
// Camera language (ports worker-v4.2.0.js §0 — the best IP in the old prompt)
// ─────────────────────────────────────────────────────────────
export const CameraSetupKindSchema = z.enum([
  'self_held_selfie', 'mirror_selfie', 'propped_on_surface', 'third_person', 'camera_put_down',
]);

/** Canonical footage-style taxonomy — what KIND of camera content this is. */
export const FootageStyleSchema = z.enum([
  'iphone_selfie_vlog',      // front camera, talking/mouthing at arm's length
  'iphone_third_person_vlog',// friend-filmed rear camera, casual
  'iphone_skit',             // acted scene, cuts, amateur staging
  'iphone_candid',           // caught-in-the-moment, no acknowledgment of camera
  'iphone_mirror',           // mirror content, phone visible
  'professional',            // actual produced footage — rare in our library
  'other',
]);

/**
 * The LOOK of the footage — device, style, grade. Separate from camera physics:
 * physics = how the camera MOVES; aesthetic = what the image LOOKS like it was
 * shot on. Both must survive into motion prompts or video models default to
 * their cinematic house style ("shot like a movie" — the #1 realism killer).
 */
export const FootageAestheticSchema = z.object({
  device: z.string(),              // "iPhone front camera" | "iPhone rear camera" | "pro mirrorless"
  style: FootageStyleSchema,
  grade: z.string(),               // "raw ungraded, auto-exposure, slightly blown window highlights"
  realismMarkers: z.array(z.string()), // pixel evidence of realness: sensor noise, motion blur, clipped highlights, smudged lens…
  antiCinematic: z.string(),       // the NOT-line: "no color grade, no cinematic lighting, no shallow depth of field"
  promptAnchor: z.string(),        // ONE paste-ready phrase locking a video model to this look
  // v3 filming-fidelity additions — optional so pre-v3 rows keep parsing:
  colorTempK: z.string().optional(),        // CATEGORICAL, evidence-bound: "warm indoor ~3000K" — never invented precision
  lightingDirection: z.string().optional(), // "key from window camera-left, soft ceiling fill, shadows fall right"
  practicals: z.array(z.string()).optional(),   // visible in-frame light sources: "fridge interior light", "TV glow"
  realismTells: z.array(RealismTellSchema).optional(),  // constrained tells → canned NB/motion tokens (rules.ts)
  promptAnchorShort: z.string().optional(), // ~90-char compression of promptAnchor for char-tight motion prompts
});

/**
 * The handheld PHYSICS of the shot — what makes phone footage feel real.
 * Extracted from pixels so a video model can reproduce the exact camera feel,
 * not just the setup. motionSignature is the paste-ready distillation.
 */
export const CameraDynamicsSchema = z.object({
  stability: z.enum(['locked_off', 'held_steady', 'natural_handheld', 'energetic_handheld', 'walking', 'running']),
  shake: z.string(),                // amplitude + rhythm in physical terms: "constant 1-2px micro-jitter, faster during gestures"
  sway: z.string(),                 // slow drift/lateral sway: "gentle side-to-side sway ~1s cycle" | "none"
  bob: z.string(),                  // vertical bob from walking/breathing: "step-synced bob while walking" | "none"
  reframes: z.string(),             // deliberate recomposes: "one downward reframe at 0:04 to follow the plate" | "none"
  focusExposure: z.string(),        // autofocus hunts, exposure adaptation: "brief focus hunt at 0:02, exposure dips when window enters"
  motionSignature: z.string(),      // ONE compiled sentence, video-prompt-ready, that reproduces this exact camera feel
});

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
  dynamics: CameraDynamicsSchema.optional(),  // optional so pre-v2 rows keep parsing; analyzer MUST fill it
});

// ─────────────────────────────────────────────────────────────
// VIRALITY — the brutally honest scorecard. Calibrated 0-100, never inflated.
// ─────────────────────────────────────────────────────────────
export const ViralityDimensionSchema = z.object({
  score: z.number(),                // 0-100 on the calibrated rubric
  reason: z.string(),               // brutal, pixel-specific justification — never generic praise
});

/** Which calibration produced a score.
 *
 *  WHY THIS MATTERS MORE THAN IT LOOKS: virality_score drives the surprise sampler as
 *  score², so scores from different rubrics are not interchangeable — mixing them silently
 *  reweights the whole library.
 *    '1' — every score produced before 2026-08-28.
 *    '2' — adds the Four-S hook evaluation.
 *    '3' — RECALIBRATION. Measured on the live library, rubric 1/2 scored 41% of a
 *          hand-curated set of proven performers under 40, because the instruction told the
 *          scorer to assume failure and to break every tie downward. That is the wrong prior
 *          for a corpus of winners, and it is actively costly: the sampler weights by score²,
 *          so a wrongly-low score buries a good blueprint. Rubric 3 keeps the absolute
 *          yardstick, the evidence rule and the no-credit-for-polish rule, and replaces the
 *          flop prior + always-lower tie-break with evidence-led scoring.
 *  Rows are rescored EXPLICITLY via POST /admin/rescore-virality, never automatically — the
 *  operator decides when to spend on it, and this field is what keeps the two calibrations
 *  distinguishable in the meantime instead of quietly incomparable. */
export const RUBRIC_VERSION = '3';

export const ViralityScorecardSchema = z.object({
  /** Absent = rubric '1' (pre-2026-08-28). Never backfilled. */
  rubricVersion: z.string().optional(),
  overall: z.number(),              // 0-100; 50 = average posted video, 80+ = genuine viral mechanics
  verdict: z.string(),              // ONE brutal sentence — what a no-bullshit editor would say
  dimensions: z.object({
    hook: ViralityDimensionSchema,        // 0-3s scroll-stop power
    retention: ViralityDimensionSchema,   // watch-through: pacing, open loops, payoff placement
    emotion: ViralityDimensionSchema,     // emotional charge: desire, humor, envy, relatability
    share: ViralityDimensionSchema,       // share/comment/tag triggers
    replay: ViralityDimensionSchema,      // loopability + rewatch pull
    algo: ViralityDimensionSchema,        // platform fit: length, format, sound strategy, trend surf
  }),
  strengths: z.array(z.string()),   // what genuinely carries this video
  weaknesses: z.array(z.string()),  // brutal — every drag on performance, named
  ceiling: z.string(),              // realistic view-band forecast + the ONE thing capping it
  improvements: z.array(z.string()),// concrete changes that would raise the overall score
});

/** Per-ideation honest forecast — how the REMAKE will do, not the original. */
export const ViralityForecastSchema = z.object({
  score: z.number(),                // 0-100, same calibration as the scorecard
  vsOriginal: z.string(),           // honest delta vs the source video's score and why
  verdict: z.string(),              // one brutal sentence
  risks: z.array(z.string()),       // where this treatment can lose the original's magic
  boosters: z.array(z.string()),    // what to nail in production to hit the ceiling
});

/** ATTENTION MODEL (2026-08-28) — the hook as THREE SIMULTANEOUS CHANNELS, not one.
 *
 *  `hook.type` is a single enum, which quietly encodes a wrong belief: that a video has one
 *  hook. The strongest hooks fire text, speech and image at the same instant, each one
 *  independently capable of stopping the scroll — so a video that "works on mute" and a video
 *  that "works in a pocket" are different tests and a good hook passes both. Capturing the
 *  channels separately is what lets the library answer which COMBINATIONS actually score.
 *
 *  All optional: 169 formats are already stored without them, and per this repo's standing
 *  rule the analyzer is ASKED for fields in the prompt while the schema stays lenient, so a
 *  dropped field can never 502 a paid run. */
/** BLUEPRINT DISSECTION — what can be STOLEN from this video, and what cannot.
 *
 *  The gap this closes: the library recorded, in great detail, WHAT a video did — but never
 *  separated the part that transplants from the part that only worked once. So "reuse the
 *  format" and "copy the video" were indistinguishable to the generator, and the safest thing
 *  it could do was reproduce the surface. That is how you end up a copier instead of a
 *  trendsetter, and no amount of prompt polish fixes it, because the distinction was never
 *  captured in the first place.
 *
 *  Steal like an artist, made mechanical: take the MECHANISM, invent the SURFACE.
 *  All optional — 169 formats are already stored without it. */
export const ViralMechanicsSchema = z.object({
  /** The ONE thing that actually made it work. If you removed this, it would have died. */
  primaryDriver: z.string(),
  /** What TRANSPLANTS to a different creator, niche, product or country. Mechanisms, not
   *  props: "the reveal is withheld until the last 0.5s" transplants; "she opens a Labubu
   *  box" does not. */
  replicableCore: z.array(z.string()),
  /** What worked ONLY here and cannot be transplanted: this creator's existing fame, a real
   *  pet or child, a location nobody else has, a moment in a news cycle, a trend that has
   *  since died, genuine luck. Naming these is what stops the generator copying them. */
  nonReplicable: z.array(z.string()),
  /** What BREAKS when the mechanism is moved somewhere else — the failure mode to design
   *  around, not a disclaimer. */
  transplantRisk: z.string(),
  /** NEW directions this mechanism supports that the original never did. The point is a
   *  fresh video built on a proven engine, not a re-skin of this one. */
  freshAngles: z.array(z.string()),

  /** CAN WE ACTUALLY BUILD IT? (2026-08-31)
   *
   *  Deliberately part of viralMechanics rather than a sibling block: "needs a real
   *  bystander" is already a nonReplicable fact, and two structures describing the same
   *  thing drift apart (this repo has the scar — a second copy of the virality rubric in
   *  routes/admin.ts silently undid a recalibration).
   *
   *  WHY IT MATTERS MORE THAN IT LOOKS: virality_score drives the surprise sampler as score²,
   *  so a high score on a format we physically cannot produce does not merely waste
   *  attention — it OUTCOMPETES formats we can build. A 62-scoring prank needing a prankster,
   *  an unwitting stranger and a public location will beat a 55-scoring format we could
   *  actually shoot. That is the same class of error as a miscalibrated score, wearing a
   *  different hat. */
  /** OPTIONAL in storage, REQUIRED in the analyzer prompt — the standing rule in this repo,
   *  which I broke when first adding this and had to fix on 2026-09-01. `production` shipped
   *  two days after the rest of viralMechanics, so any format analysed in that window has
   *  viralMechanics WITHOUT production, and a required nested field made those rows fail
   *  validation outright. A required field inside an optional parent is still a breaking
   *  change for anything written in between. The prompt carries a detailed paragraph
   *  demanding it, which is where the enforcement belongs. */
  production: z.object({
    /** How many distinct people must appear. Our models are single AI characters with no
     *  locked co-star, so anything above 1 is a real constraint, not a detail. */
    castCount: z.number().int(),
    castRoles: z.array(z.string()),
    needsPublicLocation: z.boolean(),
    needsRealBystanders: z.boolean(),
    /** Legible on-screen content (a phone screen, a chat, a QR code). i2v models cannot
     *  render legible text, so these beats need compositing after generation. */
    screenContentRequired: z.boolean(),
    /** 0-100: how buildable is this by a SINGLE AI-generated character with no co-star,
     *  no real bystanders and no real location? Independent of how good the video is. */
    aiFeasibility: z.number(),
    aiFeasibilityReason: z.string(),
    /** THE MOST VALUABLE FIELD HERE. How to get the SAME mechanic with ONE character.
     *  A rejected format should still leave behind something buildable: "make the model the
     *  victim — she scans the code herself, filmed by an off-camera friend" collapses a
     *  two-hander with strangers into a single-character shot. Required, not optional: a
     *  format we cannot build and cannot rewrite is worth knowing about explicitly. */
    singleCharacterRewrite: z.string(),
  }).optional(),
});

export const HookChannelsSchema = z.object({
  /** On-screen text in the first ~2s — the overlay a muted viewer reads. '' = none present. */
  text: z.string().optional(),
  /** The first spoken words — what a viewer scrolling with sound hears. */
  spoken: z.string().optional(),
  /** The visual event itself — what a viewer sees before reading or hearing anything. */
  visual: z.string().optional(),
  /** How many of the three independently stop a scroll — expected 0-3. The number that
   *  matters most in this whole block.
   *
   *  NO .min()/.max() ON PURPOSE, though not for the reason it first appears. Numeric
   *  minimum/maximum are NOT rejected by Gemini: z.number().int() already emits them at
   *  ±MAX_SAFE_INTEGER, and beats[].index / clipIndex / pacing.cutCount have carried them
   *  across 169 successful live analyses. The concern is narrower — a TIGHT range is a real
   *  constraint on constrained decoding rather than a no-op, and this schema is fed to
   *  Gemini as a responseJsonSchema. Unverified decoding risk on a paid endpoint buys
   *  nothing here: the range is stated in the prompt, and an out-of-range value is a data
   *  curiosity while a 400 on every analyze is an outage. Enforced by a test in
   *  tests/gemini-parsing.test.ts. */
  stackedCount: z.number().int().optional(),
});

export const HookSchema = z.object({
  type: z.enum(['visual', 'text', 'question', 'mid_action', 'pattern_interrupt', 'audio']),
  openingVisual: z.string(),        // what is literally on screen at 0:00
  firstLineOrText: z.string().optional(),
  mechanism: z.string(),            // WHY it stops the thumb
  coherenceWithCaption: z.string().optional(),
  // ── attention model ──
  channels: HookChannelsSchema.optional(),
  /** STAKES — why the viewer should care, established inside ~2s. The most commonly missing
   *  ingredient: a hook can be visually arresting and still lose the scroll because nothing
   *  is at stake. "Her whole tray is about to tip" is stakes; "she is cooking" is not. */
  stakes: z.string().optional(),
  /** LOCK-IN (≈2-5s) — what holds attention AFTER the hook fires and BEFORE the payoff
   *  lands. The bridge across which most videos are actually lost. */
  lockIn: z.string().optional(),
  /** Does the hook survive without sound? A muted-autoplay feed is the default condition. */
  worksOnMute: z.boolean().optional(),
});

// ── Beat = the atomic unit of the shot list ──
/** A person in the source video OTHER than the main subject (2026-08-31).
 *
 *  The app had no concept of a second person. Yesterday's feasibility work added
 *  production.castCount, so we now know a video NEEDS two people — but nothing described
 *  them, so the scene still could not be built. This is the missing half.
 *
 *  Why appearance IS described here, when it is deliberately NEVER described for the main
 *  subject: the subject's identity comes from locked reference images, and describing her in
 *  text fights those refs (that is what identityLock and stripIdentityDescriptors exist to
 *  prevent). A second person has no reference image, so text is the only thing the generator
 *  has to go on. Opposite rules for opposite reasons. */
export const CastMemberSchema = z.object({
  /** Stable id used by beat.speaker — 'subject' is reserved for the main character. */
  id: z.string(),
  /** cameraman, friend, interviewer, passerby, victim, shop staff… */
  role: z.string(),
  /** Full physical description, since no reference image exists for this person. Empty
   *  string if they are heard but never seen (an off-camera friend filming). */
  appearance: z.string(),
  wardrobe: z.string(),
  /** True when they never appear in frame — the commonest case in real UGC, and it matters
   *  because an off-camera person needs no visual generation at all, only a voice. */
  offCamera: z.boolean().optional(),
});

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
  /** WHO is speaking — 'subject' or a cast[].id. Optional so pre-2026-08-31 rows parse.
   *  Without it, dialogue in a two-person video is unattributable, and the lip-sync plan
   *  cannot know whose mouth to animate — it would default to the model even when the line
   *  belongs to an off-camera friend. */
  speaker: z.string().optional(),
  /** How the line is said — tone/energy, not facial muscles. Kept separate from the words
   *  so the words can be reproduced verbatim while the delivery is re-aimed at our model. */
  delivery: z.string().optional(),
  onScreenText: z.string().optional(),
  startsOnCut: z.boolean(),
  // v3 filming fidelity — optional so pre-v3 rows keep parsing; REQUIRED on new
  // analyses via AnalyzerBeatSchema (the pre-v2 optional pattern):
  shotSize: ShotSizeSchema.optional(),
  cameraAngle: CameraAngleSchema.optional(),
  lensFeel: z.string().optional(),          // "front-cam wide, mild face distortion at arm's length"
  cutTransition: CutTransitionSchema.optional(),  // how this beat ENTERS at startSec
  motionBeat: z.string().optional(),        // THE appeal-carrying motion of the beat ("chest bounces as she laughs")
  secondaryMotion: SecondaryMotionSchema.optional(),
  microExpression: z.string().optional(),   // blink / gaze dart / breath / weight shift actually observed
  shotType: ShotTypeSchema.optional(),      // aroll | broll — B-roll cutaways drive pacing/tension
  brollSubject: z.string().optional(),      // broll only: WHAT the insert shows ("hands rolling husks tight, steam rising")
  sourceBeatIndex: z.number().int().optional(),   // provenance when derived from another beat (micro-pass merges)
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

// ── Pacing + audio (named so AnalyzerOutputSchema can require the v3 additions) ──
export const PacingSchema = z.object({
  totalDurationSec: z.number(),
  cutCount: z.number().int(),
  isOneShot: z.boolean(),
  rhythm: z.string(),             // "cuts every ~0.8s on beat" | "single slow take"
  energy: z.string(),
  // v3 — optional for pre-v3 rows:
  cutCadenceSec: z.number().optional(),   // MEDIAN seconds between cuts (numeric twin of rhythm)
  payoffSec: z.number().optional(),       // when the hook's promised payoff actually lands
  /** HOW IT ENDS (2026-08-31). 'abrupt' = cuts mid-action like a casually uploaded clip;
   *  'resolved' = lands and settles; 'loop' = designed to run back into frame one.
   *  A CLEAN, resolved ending is one of the most reliable tells that footage was produced
   *  rather than captured — and nothing recorded this before, so every remake inherited a
   *  tidy ending by default. */
  endBehavior: z.enum(['abrupt', 'resolved', 'loop']).optional(),
});

export const AudioBeatMapEntrySchema = z.object({
  atSec: z.number(),
  kind: z.enum(['downbeat', 'drop', 'accent']),
});

export const AudioDnaSchema = z.object({
  kind: z.enum(['trending_audio', 'voiceover', 'ambient', 'silent_text_overlay', 'original_dialogue']),
  genre: z.string().optional(),
  bpmEstimate: z.number().optional(),
  mood: z.string().optional(),
  voiceoverStyle: z.string().optional(),
  trendingSoundDependent: z.boolean(),
  lipSync: z.boolean().optional(),   // does the creator MOUTH the audio on camera? (drives the lip-sync route)
  syncNotes: z.string().optional(),  // "cuts land on drops"
  // v3 — optional for pre-v3 rows:
  beatMap: z.array(AudioBeatMapEntrySchema).optional(),  // timestamped musical events the cut map references
  syncType: z.enum(['cut_on_beat', 'motion_on_beat', 'none']).optional(),
  roomTone: z.string().optional(),   // ambient signature: "kitchen hum + faint street noise"
});

/** Does the video loop, and how — replay mechanics are generation-relevant. */
export const LoopSchema = z.object({
  isSeamless: z.boolean(),
  loopPointSec: z.number().optional(),   // where the end hands back to the start
  mechanism: z.string(),                 // "last pose matches opening pose" | "audio phrase wraps" | "none"
});

/** How the footage FEELS temporally — what a video model must reproduce to avoid the AI-smooth look. */
export const MotionCadenceSchema = z.object({
  fpsFeel: z.string(),               // "native 30fps phone" | "24fps-ish with judder"
  shutterFeel: z.string(),           // "normal auto shutter, motion blur on fast moves"
  temporalArtifacts: z.string(),     // "rolling shutter wobble on whip pans" | "none seen"
  interpolationRisk: z.string(),     // what would betray AI here: "any frame-interpolated smoothness on the hair flip"
});

// ─────────────────────────────────────────────────────────────
// FORMAT DNA — durable, model-independent (brief §4a). THE library asset.
// ─────────────────────────────────────────────────────────────
export const FormatDnaSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  version: z.number().int(),
  title: z.string(),                // human name, e.g. "Elevator outfit-check freeze"
  archetype: z.string(),            // free-form flavor label ("bait_and_switch")
  formatType: FormatTypeSchema.optional(),  // canonical taxonomy axis — analyzer MUST fill; optional for pre-v2 rows
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
    /** What is happening BEHIND the subject (2026-08-31): independent people, movement,
     *  activity. The generator's humanization law 8 already DEMANDS a live background, but
     *  the analyzer never recorded what the source did — so the generator invented one from
     *  nothing instead of transplanting a pattern that demonstrably worked. */
    backgroundActivity: z.string().optional(),
  }),
  wardrobeRole: z.object({          // role, never identity
    role: z.string(),               // "athleisure" | "going-out fit" | "work uniform"
    garments: z.array(z.string()),
    stylingNotes: z.string(),
  }),
  pacing: PacingSchema,
  audio: AudioDnaSchema,
  loop: LoopSchema.optional(),                 // v3 — analyzer MUST fill; optional for pre-v3 rows
  motionCadence: MotionCadenceSchema.optional(),  // v3 — analyzer MUST fill; optional for pre-v3 rows
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
  /** Everyone in the video BESIDES the main subject (2026-08-31). Empty array is the normal
   *  case for solo UGC and is meaningful: it says "solo", not "not checked". */
  cast: z.array(CastMemberSchema).optional(),
  /** Blueprint dissection (2026-08-29): what transplants vs what only worked once.
   *  Optional so all 169 stored formats keep parsing; asked for on every new analysis. */
  viralMechanics: ViralMechanicsSchema.optional(),
  /** WHAT THE ANALYZER COULD NOT DETERMINE (2026-08-31).
   *
   *  The output format used to reward a confident answer for every field, and a schema with
   *  no way to say "I could not see that" applies quiet pressure to invent one. Measured
   *  case: a transcription pass on a music-only clip produced a fluent Turkish sentence that
   *  was never spoken. An explicit place to say "unknown" costs nothing and removes the
   *  pressure — a named gap is far more useful downstream than a confident fabrication,
   *  because a gap can be checked and a fabrication cannot.
   *
   *  Empty array is a legitimate answer for a clean, well-lit, unambiguous clip. */
  uncertain: z.array(z.object({
    field: z.string(),        // dotted path, e.g. "beats[2].dialogue"
    why: z.string(),          // what blocked it: off-screen, too fast, occluded, no audio
  })).optional(),
  whyItWorks: z.object({            // the teaching layer — the ~80% that must survive ideation
    mechanism: z.string(),          // retention/psychological driver
    retentionDrivers: z.array(z.string()),
    targetViewer: z.string(),
    shareCommentTrigger: z.string().optional(),
    /** IDENTITY, not demographics. `targetViewer` answers "who watches this"; this answers
     *  "who does the viewer get to BE by watching or sharing it". People act on identity and
     *  emotional outcome, not on features — so an ideation aimed at a demographic reads
     *  generic while one aimed at an identity lands. */
    viewerIdentity: z.string().optional(),
    /** WHY SHARING MAKES THE SHARER LOOK GOOD. The real share mechanic: nobody forwards a
     *  video to help the creator, they forward it because posting it says something
     *  flattering about them (funny, in-the-know, tasteful, righteous). Distinct from
     *  shareCommentTrigger, which is about what prompts the comment. */
    sharerPayoff: z.string().optional(),
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
  virality: ViralityScorecardSchema.optional(),  // analyzer MUST fill; optional for pre-v2 rows
  aesthetic: FootageAestheticSchema.optional(),  // analyzer MUST fill; optional for pre-v2.2 rows
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
/** v3: a NEW analysis must fill every filming-fidelity field on every beat. */
export const AnalyzerBeatSchema = BeatSchema.extend({
  shotSize: ShotSizeSchema,
  cameraAngle: CameraAngleSchema,
  lensFeel: z.string(),
  cutTransition: CutTransitionSchema,
  motionBeat: z.string(),
  secondaryMotion: SecondaryMotionSchema,
  microExpression: z.string(),
  shotType: ShotTypeSchema,
});

export const AnalyzerOutputSchema = FormatDnaSchema.omit({
  schemaVersion: true, id: true, version: true, source: true,
}).extend({
  // Required for NEW analyses (optional in the stored schema only so pre-v2/v3 rows keep parsing):
  formatType: FormatTypeSchema,
  virality: ViralityScorecardSchema,
  aesthetic: FootageAestheticSchema.extend({
    colorTempK: z.string(),
    lightingDirection: z.string(),
    practicals: z.array(z.string()),
    realismTells: z.array(RealismTellSchema),
    promptAnchorShort: z.string(),
  }),
  camera: CameraSetupSchema.extend({ dynamics: CameraDynamicsSchema }),
  beats: z.array(AnalyzerBeatSchema),
  pacing: PacingSchema.extend({ cutCadenceSec: z.number(), payoffSec: z.number() }),
  audio: AudioDnaSchema.extend({
    beatMap: z.array(AudioBeatMapEntrySchema),
    syncType: z.enum(['cut_on_beat', 'motion_on_beat', 'none']),
    roomTone: z.string(),
  }),
  loop: LoopSchema,
  motionCadence: MotionCadenceSchema,
});

/**
 * v3 SPEND SPLIT: the perception call returns everything EXCEPT the virality essay,
 * which runs as a separate TEXT-ONLY call on the fast model over the extracted DNA
 * (never re-grounds Pro over the whole clip — see gemini.ts SPEND_CAP_FIX history).
 */
export const PerceptionOutputSchema = AnalyzerOutputSchema.omit({ virality: true });

/** Pass A (boundary+motion map): the ONLY thing the fast high-fps scan returns. */
export const BoundaryMapSchema = z.object({
  cutTimestamps: z.array(z.number()),      // seconds, on the sampling-fps grid
  motionBeatWindows: z.array(z.object({ startSec: z.number(), endSec: z.number() })),
});

/** Micro-pass output: sub-second body motion inside one motion window. */
export const MotionWindowDetailSchema = z.object({
  windows: z.array(z.object({
    startSec: z.number(),
    endSec: z.number(),
    motionBeat: z.string(),
    secondaryMotion: SecondaryMotionSchema,
  })),
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
    /** §2 (Aug 17): the per-model REF KIT — 4 tight face crops + 3 approved HEADLESS body
     *  crops, living at the model root `_LOCKED/` (NOT under 03-content/ — §5). Every
     *  image-generation call attaches ALL of them as base64; the production route names
     *  them so executors can't skip the attachment. Optional: pre-kit profiles keep parsing. */
    refKit: z.object({
      faceCrops: z.array(z.string()),   // paths/ids of the 4 locked face crops
      bodyCrops: z.array(z.string()),   // paths/ids of the 3 approved headless body crops
    }).optional(),
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
  /**
   * The model's PHYSICAL BUILD — feeds the Seedream body pass ONLY (never NB/motion
   * prompts; the identity firewall still owns the face). Optional: profiles without
   * it fall back to the neutral SD templates.
   */
  body: z.object({
    build: z.string(),              // "fit hourglass, natural bust, toned waist"
    proportions: z.string(),        // bust/waist/hip balance, shoulder line, leg length
    skin: z.string(),               // texture + tone behavior ("natural texture, visible pores, soft tan lines")
    heightVibe: z.string().optional(),      // "reads ~5'6, long-legged"
    sdEnhancementNotes: z.string(), // exactly how the Seedream pass should shape the body
    /** §2 (Aug 17): COMMAND-style body descriptor for the GPT-Image body-match LEAD —
     *  hedges ("natural, not exaggerated") render LEAN on GPT-image, so this one COMMANDS
     *  the shape ("full round bust that sits high, deeply snatched waist, curvy hips").
     *  The LEAD injector caps it with "curvy but LEAN, NOT thick, NOT a BBL" automatically.
     *  Optional: falls back to `${build}; ${proportions}`. */
    leadDescriptor: z.string().optional(),
  }).optional(),
  world: z.object({
    locationWhitelist: z.array(z.string()),
    locationBanlist: z.array(z.string()),
    persona: z.string(),            // "young woman who works as a flight attendant"
    backstory: z.string().optional(),       // her story/lore — grounds ideation in who she is
    audienceICP: z.string(),        // "men 35-50+, American, financially stable"
    /**
     * GriffinOFM Content Persona Framework (2026-08-17): kills "niche". A niche =
     * THEME (emotional lane, congruent across every post → FANS) + VEHICLE (what she
     * films, swappable → VIEWS). Cascade: Roots (persona traits + look + resources) →
     * Strategy (theme · usp · vehicles) → Execution (formatMenu) → Synthesis
     * (brandStatement · idealFan · ideationPrompt). Sits BESIDE persona/backstory/
     * audienceICP (which stay as roots) and governs theme/hook/vehicle/format/delivery
     * ONLY — identity/body/wardrobe/continuity locks are untouched by this layer.
     * Optional: pre-framework D1 profiles keep parsing; omitted → generator behaves
     * exactly as before (no Theme Governor, no persona-biased draw).
     */
    contentPersona: z.object({
      personaTraits: z.array(z.string()).length(3),  // 2 core traits + 1 outlier (the uncopyable bit)
      resources: z.string(),          // filming reality: filmer? location? camera-confidence? cadence → sets the FORMAT MENU
      theme: z.string(),              // emotional lane, CONGRUENT across every post
      usp: z.string().optional(),     // hard-to-copy standout; DON'T invent if none
      vehicles: z.array(z.string()),  // what she films; swappable
      formatMenu: z.array(z.string()),// allowed formats given resources
      brandStatement: z.string(),     // "She is a [traits] [look] whose content is [theme]+[vehicle] that feels like [payoff] for [ideal fan]."
      idealFan: z.string(),           // who opens the wallet (not follower intent)
      ideationPrompt: z.string(),     // reusable line the synth path runs
    }).optional(),
  }),
  voice: z.object({
    captionStyle: z.string(),       // "3-8 words lowercase, 1 emoji max, no apostrophes"
    overlayStyle: z.string(),
    exampleOverlays: z.array(z.string()),
    bannedWords: z.array(z.string()),
    hashtagPool: z.array(z.string()).optional(),
    // Spoken-delivery accent injected into every on-camera dialogue line so she doesn't
    // sound generic (FABLE5 §4.3). e.g. "soft warm Texas drawl, not theatrical". Optional
    // so pre-accent D1 profiles keep parsing; omitted → no accent clause is added.
    accent: z.string().optional(),
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
/** One step of the machine-readable production graph for a beat:
 *  NB → SD → face-restore → video → (lipsync). face_restore is an explicit node —
 *  the documented SD face-drift fix, never an implied side step. */
export const ProductionRouteStepSchema = z.object({
  step: z.number().int(),           // 1-based order
  tool: z.enum(['gpt_image_2', 'nano_banana_2', 'seedream_4.5', 'face_restore', 'kling_3', 'cdance_2', 'lipsync']),
  inputAsset: z.string(),           // "hero still from beat 0" | "prev clip last frame" | "SD output"
  outputAsset: z.string(),          // what this step produces, named so later steps can reference it
  promptField: z.string(),          // which BeatGeneration field feeds it: "nbPrompt" | "sdPrompt" | "motionPrompt" | "none"
  /** Aug 17: step runs only when its condition is met (e.g. the Seedream body pass
   *  fires ONLY if GPT-Image-2 did not resolve the body). Omitted = unconditional. */
  conditional: z.boolean().optional(),
  /** §3 (Aug 17): what the executor does when GPT-Image-2 flags "content sensitive" —
   *  the strip→retry→route-to-Seedream→NB-fallback chain, spelled out per step so the
   *  flow never just fails. Executors follow this text; the filter is stochastic. */
  onModerationFlag: z.string().optional(),
});

export const BeatGenerationSchema = z.object({
  clipIndex: z.number().int(),
  sourceFrameId: z.string().optional(),  // FormatDNA.frames inspiration, if any — beats are
                                         // re-imagined, so this is provenance, not a 1:1 FK
  timestamp: z.string(),            // "0:00-0:05"
  action: z.string(),
  camera: z.string(),
  expression: z.string(),
  dialogue: z.string().optional(),
  /** 'subject' or a cast id — mirrors BeatSchema.speaker into the generated beat so the
   *  production route and lip-sync plan know whose line it is. */
  speaker: z.string().optional(),
  nbPrompt: z.string(),             // NanoBanana first-frame/still prompt (identity-locked)
  chatgpt2Prompt: z.string().optional(),  // alt image tool, when requested
  sdPrompt: z.string(),             // Seedream delta — MANDATORY, never empty (type-enforced)
  sdFrameType: SdFrameTypeSchema,
  motionPrompt: z.string(),         // Kling/CDance clip prompt
  motionPromptCharCount: z.number().int(),  // enforced ≤310/clip (multi) or 800-1200 (one-shot Kling)
  // v3 filming fidelity — optional so stored pre-v3 runs keep parsing; REQUIRED on
  // new runs via the generator output schema (routes/generate.ts):
  shotSize: ShotSizeSchema.optional(),
  cameraAngle: CameraAngleSchema.optional(),
  durationSec: z.number().optional(),
  cutType: CutTransitionSchema.optional(),      // how this clip ENTERS in the edit
  motionBeat: z.string().optional(),            // the appeal-carrying motion this clip must contain
  secondaryMotion: SecondaryMotionSchema.optional(),
  microExpression: z.string().optional(),
  startsOnCut: z.boolean().optional(),
  shotType: ShotTypeSchema.optional(),          // broll beats skip identity lock / SD pass / face QA
  brollSubject: z.string().optional(),
  sourceBeatIndex: z.number().int().optional(), // which dna.beats[i] this reproduces (first covered beat)
  /** v3.3 SEGMENTS: sub-4s source beats are grouped into ONE continuous-take
   *  generation (video models can't generate below ~5s; real creators shoot one
   *  take and chop it). These are ALL the source beats this generation covers —
   *  the motionPrompt carries their internal timeline; editPlan slices[] cuts
   *  the take back into the source cadence. */
  sourceBeatIndices: z.array(z.number().int()).optional(),
  firstFrameSource: FirstFrameSourceSchema.optional(),  // hero_still | prev_clip_last_frame | fresh_nb
  productionRoute: z.array(ProductionRouteStepSchema).optional(),
  /** Part B self-challenge (2026-08-17): what the baked-in critique pass changed on this
   *  beat's motionPrompt (e.g. "added subtitle ban"). Optional — absent means no fixes. */
  challengeLog: z.array(z.string()).optional(),
});

/**
 * How to physically assemble the final video from the generated clips —
 * the editing structure the operator follows in CapCut/Canva.
 */
/** THE TRIM MAP — how sub-second cut cadence gets reproduced when video models can't
 *  generate below ~5s (Kling floor): generate LONG, slice to cadence ON THE BEAT in edit. */
export const TrimSpecSchema = z.object({
  generatedDurationSec: z.number(), // what to actually generate (≥5s for Kling)
  useInSec: z.number(),             // slice window inside the generated clip…
  useOutSec: z.number(),
  cutOnBeatAtSec: z.number().optional(),  // final-timeline position of the outgoing cut (audio.beatMap ref)
  landsOnBeat: z.boolean(),
});

/** Phone-ify the export — the last mile that makes an AI clip read as camera footage. */
export const PostProcessingSchema = z.object({
  fps: z.number(),                  // 30 — phone native; never leave a model's 24/25 default
  addGrain: z.string(),             // "fine sensor grain, stronger in shadows" | "none — source already noisy"
  addHandheldShake: z.string(),     // "2-4px micro-shake overlay on locked shots" | "none — already handheld"
  rollingShutterOnPans: z.boolean(),
  motionBlurAmount: z.string(),     // "natural 180° shutter feel on fast moves"
  reencodeProfile: z.string(),      // "phone-HEVC"
  aspect: z.string(),               // "9:16 phone crop"
});

export const EditPlanSchema = z.object({
  clips: z.array(z.object({
    clipIndex: z.number().int(),
    durationSec: z.number(),
    purpose: z.string(),            // "hook — freeze on the stare", "payoff reveal"
    transitionOut: z.string(),      // "hard cut on beat" | "none (last clip)"
    // v3 — optional for stored pre-v3 runs:
    beatMapIndex: z.number().int().optional(),  // which audio.beatMap event the outgoing cut lands on
    trim: TrimSpecSchema.optional(),
    /** v3.3: when one generated take covers SEVERAL source beats, each slice is one
     *  cut chopped from it (jump-cut technique). trim stays = slices[0] for compat. */
    slices: z.array(TrimSpecSchema).optional(),
  })),
  assembly: z.array(z.string()),    // ordered edit steps incl. caption/text-overlay placement
  captionsNote: z.string().optional(),
  // v3 — optional for stored pre-v3 runs:
  loopPlan: z.string().optional(),  // how the edit closes the loop ("end on the opening pose, hard cut to 0:00")
  postProcessing: PostProcessingSchema.optional(),
});

/** Generated ONCE per ideation, inherited by every beat — cross-shot continuity is
 *  the #1 "AI" tell in stitched multi-clip video. */
export const ContinuityLockSchema = z.object({
  setDescription: z.string(),       // the ONE set, concrete: "small sunlit farmhouse kitchen, butcher-block counters"
  wardrobeExact: z.string(),        // exact garments incl. colors — identical in every beat
  hairExact: z.string(),            // exact style + state
  lightingExact: z.string(),        // sources + direction + behavior, held constant
  colorTempK: z.string(),           // categorical: "warm indoor ~3000K"
  timeOfDay: z.string(),
  keyProps: z.array(z.string()),    // props that must persist across clips
});

/**
 * The lip-sync production route for this ideation — which tool, which order,
 * exact steps. Only meaningful when the treatment has mouthed audio/dialogue.
 */
export const LipSyncPlanSchema = z.object({
  needed: z.boolean(),
  audioSource: z.string(),          // "rip the trending sound (ssstik) — post with the ORIGINAL platform audio re-attached"
  route: z.string(),                // recommended tool/pipeline for THIS clip's kind of audio
  steps: z.array(z.string()),       // exact production steps start→finish
  fallback: z.string().optional(),  // plan B if the primary tool fights the content
});

/** One of the ~3 treatments: keeps whyItWorks + swapMap.mustKeep, reinvents the rest. */
/** The ideation's explicit answer to "why would a stranger stop, stay, and share this".
 *
 *  WHY IT EXISTS: the app was producing competent scene descriptions with no stated
 *  attention thesis, and nothing forced the generator to name one. A brief that cannot say
 *  what is at stake, what holds the 2-5s gap, and why sharing flatters the sharer is a brief
 *  that produces slop. Required of the LLM by the generator prompt; optional on the stored
 *  IdeationSchema so every run from before 2026-08-28 keeps parsing. */
export const AttentionPlanSchema = z.object({
  // ── the Four S's of the hook ──
  subject: z.string(),        // what this is about, legible in ONE glance
  stakes: z.string(),         // why a stranger should care within ~2s (most commonly absent)
  speed: z.string(),          // how the hook lands fast — and what was CUT to get there
  simplicity: z.string(),     // the single idea, plus what was deliberately left out
  // ── the three hook channels, because a hook is not one thing ──
  // The feed autoplays MUTED, so text + visual must carry it with no sound at all, and the
  // spoken line then has to reward turning sound on.
  hookText: z.string(),       // on-screen overlay in the first ~2s
  hookSpoken: z.string(),     // the first words heard
  hookVisual: z.string(),     // the event seen before anything is read or heard
  // ── the rest of the attention arc ──
  lockIn: z.string(),         // what holds attention from the hook to the payoff (≈2-5s)
  viewerIdentity: z.string(), // who the viewer gets to BE — identity, never a demographic
  sharerPayoff: z.string(),   // why POSTING this flatters the person who posts it
});

/** What this ideation TOOK from the source and what it INVENTED — the trendsetter test,
 *  made explicit and checkable rather than hoped for.
 *
 *  Required of the LLM, optional in storage (139 runs predate it). Forcing the generator to
 *  name its own borrowed mechanism and its own invented surface is what makes the difference
 *  between reuse and copying legible: if surfaceInvented is thin, the idea IS a re-skin, and
 *  that is now visible on the card instead of buried in a prompt. */
export const TransplantPlanSchema = z.object({
  /** The proven MECHANISM taken from the source — why it works, stated abstractly. */
  mechanismTaken: z.string(),
  /** The surface built fresh for this creator: subject, setting, props, dialogue, payoff.
   *  This is the part that must NOT resemble the source. */
  surfaceInvented: z.string(),
  /** What was deliberately LEFT BEHIND because it was unrepeatable — the source's fame,
   *  its trend window, its specific person or place. */
  leftBehind: z.string(),
  /** One honest line: why a viewer who saw the original would not call this a copy. */
  whyNotACopy: z.string(),
});

export const IdeationSchema = z.object({
  index: z.number().int(),          // 0..N within the run
  title: z.string(),                // short name of this angle
  angle: z.string(),                // one-paragraph: what this treatment does differently
  keptFromOriginal: z.array(z.string()),   // which mustKeep items are honored (traceability)
  reinvented: z.array(z.string()),         // which swappable surfaces were re-imagined, and how
  /** Theme Governor (2026-08-17): how this ideation honors the profile's contentPersona
   *  theme. Required by the prompt when world.contentPersona is set; optional here so
   *  pre-framework rows and persona-less profiles keep parsing. */
  themeFit: z.string().optional(),
  /** ATTENTION PLAN (2026-08-28) — the ideation's explicit answer to "why would anyone stop,
   *  stay, and share this". Required by the generator prompt; optional here so every stored
   *  run from before this existed keeps parsing.
   *
   *  This exists because the app was generating competent scene descriptions with no stated
   *  attention thesis. A brief that cannot name its own stakes, its lock-in, and why sharing
   *  flatters the sharer is a brief that produces slop — and until now nothing forced the
   *  generator to name any of the three. */
  attentionPlan: AttentionPlanSchema.optional(),
  transplantPlan: TransplantPlanSchema.optional(),
  /** Seedance 2.0 structured prompt, DERIVED from this ideation's enforced beats (2026-08-31).
   *  Server-built, never LLM-written — see worker/src/generate/seedance.ts for why. Stored as
   *  unknown because its shape is the video tool's contract, not ours, and pinning it here
   *  would mean a schema migration every time Seedance changes a field name. */
  seedancePrompt: z.unknown().optional(),
  /** REALITY CHECK findings (2026-09-01) — does the scene physically make sense?
   *
   *  Separate from lint violations on purpose. Lint asks "is this phrased like AI?" and its
   *  failures route through the rewrite loop. These ask "could this actually happen?", and
   *  the warnings are for the OPERATOR to judge before spending money on a clip — a legible
   *  phone screen is not a prompt defect, it is a production instruction (composite it), and
   *  no rewrite can fix it. */
  realityCheck: z.array(z.object({
    beatIndex: z.number().int(),
    severity: z.enum(['blocking', 'warn']),
    kind: z.string(),
    issue: z.string(),
  })).optional(),
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
  lipSyncPlan: LipSyncPlanSchema.optional(),  // required for new runs (generator schema); optional for old rows
  editPlan: EditPlanSchema.optional(),        // required for new runs (generator schema); optional for old rows
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
  virality: ViralityForecastSchema.optional(),  // required for new runs (generator schema); optional for old rows
  continuityLock: ContinuityLockSchema.optional(),  // v3 — required for new runs; optional for old rows
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
  fidelityMode: FidelityModeSchema.optional(),  // v3 — 'reproduce' (default) | 'adapt' | 'synthesize'; optional for old rows
  // synthesize mode: the library blueprints whose mechanisms were fused (formatId is the primary/anchor).
  sourceFormatIds: z.array(z.string()).optional(),
  formulaExtracted: z.string(),     // the format's formula, shared across ideations
  ideations: z.array(IdeationSchema),
  createdAt: z.string(),
  generatorVersion: z.string(),
  // ── operator feedback (migration 0004) ──
  // These live in their own D1 COLUMNS, not inside the stored output blob: the blob is
  // written once at generation time and a verdict arrives later, so persisting it there
  // would mean rewriting the run JSON on every thumb. GET /generations/:id merges the
  // columns onto the response, which is why they are optional here.
  verdict: GenerationVerdictSchema.optional(),
  verdictNote: z.string().optional(),
  verdictAt: z.string().optional(),
  verdictIdeation: z.number().int().optional(),   // which of the 3 cards was judged
});

/** PATCH /generations/:id body. `note` is capped so a pasted essay cannot bloat the row. */
export const GenerationVerdictPatchSchema = z.object({
  verdict: GenerationVerdictSchema,
  ideationIndex: z.number().int().min(0).max(50).optional(),
  note: z.string().max(2000).optional(),
});

// ─────────────────────────────────────────────────────────────
// QA LOOPBACK (Part H) — the render-inspection verdict for a generated still/clip.
// Optional/hero-only (each check is a paid Pro vision call).
// ─────────────────────────────────────────────────────────────
export const QaVerdictSchema = z.object({
  readsAsAI: z.number(),                    // 0-100; 100 = screams AI-generated
  faceMatchScore: z.number().nullable(),    // vs the provided reference sheet; null when none attached
  fidelityToSource: z.number().nullable(),  // vs the source beat's filming spec; null when no source beat
  tells: z.array(z.object({
    tell: z.string(),                       // "plastic poreless skin on the cheeks"
    severity: z.enum(['minor', 'moderate', 'fatal']),
    where: z.string(),                      // where in the frame/clip
  })),
  fixes: z.array(z.object({
    field: z.enum(['nbPrompt', 'sdPrompt', 'motionPrompt', 'postProcessing', 'recast']),
    change: z.string(),                     // the targeted edit to regenerate THIS beat
  })),
  verdict: z.string(),                      // one brutal sentence: post it or regenerate it
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

/** CLIENT-MEASURED GROUND TRUTH for POST /analyze (2026-08-31).
 *
 *  WHY: Gemini samples video at ~1 frame/sec unless told otherwise and, as
 *  routes/analyze.ts has documented from the start, "INVENTS every sub-second cut and motion
 *  timing". The multi-pass design fights that and still landed 0.26-1.29s off on a measured
 *  test clip. ffmpeg measures cuts exactly, locally, in about a second, for zero tokens.
 *  Paying a model to estimate something a local tool can measure is the wrong trade.
 *
 *  Everything here is OPTIONAL. Send nothing and the pipeline behaves exactly as before.
 *
 *  A NOTE ON TRUST, which differs per field: cuts from ffmpeg are a MEASUREMENT and are
 *  treated as authoritative. A transcript is a MODEL OUTPUT from someone else's model and is
 *  not — on the brief's own test clip, faster-whisper produced a fluent Turkish sentence for
 *  a music-only video. So a transcript carries a confidence and can be disregarded, and it is
 *  always marked as client-supplied in the stored DNA rather than passed off as observed. */
export const GroundTruthSchema = z.object({
  /** Frame-accurate cut times in seconds, ascending. From ffmpeg scene-detect. */
  sceneCuts: z.array(z.number()).optional(),
  durationSec: z.number().optional(),
  fps: z.number().optional(),
  dimensions: z.string().optional(),
  transcript: z.array(z.object({
    start: z.number(),
    end: z.number(),
    text: z.string(),
    confidence: z.number().optional(),
  })).optional(),
  /** 'no_speech' is a MEANINGFUL value, not an absence: it tells the analyzer there is
   *  nothing to hear, which is what stops it inventing dialogue. */
  transcriptConfidence: z.enum(['high', 'low', 'no_speech']).optional(),
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
  formatType: FormatTypeSchema.nullable(),
  viralityScore: z.number().nullable(),
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
