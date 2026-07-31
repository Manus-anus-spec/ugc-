# Seedance 2.0 (primary) / Kling (fallback) — Human, Amateur-iPhone UGC Prompting

Re-researched 2026-07-31 (official BytePlus Seedance 2.0 guide + ~25 practitioner
sources) and merged with Niko's Claude→ChatGPT paraphrase findings (the
"AI Video Prompting Guide", Jul 30). The app now enforces all of this
automatically — this doc is the manual reference for hand-written prompts and
future tuning. **The motion prompt target is Seedance 2.0** (`cdance_2` in the
schema); Kling remains a fallback behind `videoModelTarget: "kling"` on /generate.

## The three laws (unchanged)

1. **First-frame dominance.** Image-to-video takes its STYLE from the input image;
   the prompt is a correction layer. Bake amateur into the NanoBanana/Seedream still.
   In the motion prompt, do NOT re-describe the scene — motion, camera, reaction,
   dialogue only, and defend the look ("keep the raw phone look of the first frame").
2. **Earliest strong instruction wins.** Official: the model reads left→right, the
   first 20-30 words are heaviest, and camera cues buried late get dropped. Our house
   anchor (short form, ~90 chars) leads every prompt; subject+action follows
   immediately. Constraints/negations go as ONE grouped line at the END — scattered
   mid-prompt "no X" can *increase* X.
3. **Lighting words are the strongest cinematizer.** "flat natural lighting",
   "natural daylight" — never "dramatic/moody/golden glow".

## The human-performance laws (Niko's guide — now enforced in generation)

1. **Reaction, not prescription.** Never name the expression ("intense pleasure",
   "confident smirk", "shocked") — describe what she's REACTING TO and let the
   expression develop. Instant expression swaps are the #1 AI tell.
   (Lint: `intense pleasure / eyes rolling back / exaggerated bliss / shocked / stunned`.)
2. **No frozen language** — the model renders it literally as dead frames:
   `pauses · stands frozen · freezes · holds the expression/pose · briefly holds ·
   staring / stares blankly · maintains eye contact · holds still`.
   Replace with: "briefly looks toward…", "her expression shifts as…",
   "continues moving while…", "glances toward… then naturally returns her attention…".
   (Deterministic lint, negation-aware — "NO freezing" as an instruction is fine.)
3. **Preserve micro-reactions.** Don't over-correct into constant busy motion.
   Skit structure: normal action → notices → visibly reacts → notices being noticed
   → tiny reaction → plays it off. Bystanders: briefly notices → second glance →
   realizes he's been noticed → looks away → keeps walking (never "stares, shocked").
4. **Interaction physics:** half a pace closer (not lunging), prop lightly taps
   (not thrust), camera reacts with a tiny bump, smile before AND after a tease.
5. **Hands need a reason, not a script** — motivation to move (adjust prop, brush
   jacket, settle near hip); real people move, stop, and settle.
6. **Idle-behavior block on every prompt** (auto-appended): occasional blinking,
   small eye saccades, tiny breathing in the shoulders, subtle weight shifts,
   natural finger relaxation, micro facial movements — no exaggerated expressions,
   no robotic symmetry, no frozen pose between actions.
7. **Secondary motion: 1-2 cues MAX** (auto-capped). Stacking dress/neckline/belt
   descriptions makes the model animate the clothing over the person. Hair with the
   head turn + fabric with a weight shift; the rest emerges.
8. **Anti-portrait framing.** "waist-up / friend-taken / front angle" produce
   portraits. Motion prompts (environmental third-person MS-WS only): "NOT a portrait,
   NOT close-up, environmental composition, medium-wide, subject occupies ~35-45% of
   the frame, room clearly visible." NB stills: percentages are unreliable on
   NB2 — describe the FRAME instead ("she stands small near the doorway at the right
   of the frame; empty wall fills the left half"), full body with feet in frame, lots
   of negative space, "not intentionally composed". Always relative layout (camera
   height/distance/subject position/headroom/landmarks) — never "exact framing" /
   "identical composition" (diffusion reproduces relationships, not exactness).
9. **Camera = a person walking**, at chest/shoulder height with a slight 5-10° down
   tilt (not dead eye-level): spot her → walk toward → slightly shaky → catch up →
   slow → settle into conversational distance. Never "rapidly approach" (cinematic
   push-in). Sequence camera behavior as two sentences with explicit deceleration.
   NEVER repeat one camera sentence verbatim across beats — it's a tell; vary it.
10. **Real phone pans:** quick handheld pivot, uneven swing, slight overshoot then
    correction, settles naturally, operator reacts instinctively — "strong natural
    motion blur during the fastest part of the pan", never "rapid whip pan" /
    "heavy motion blur".
11. **Continuous flow, not timestamp islands.** Beats start from the previous beat's
    end position ("still chewing from the previous bite"); backgrounds alive but
    secondary (a couple talking, a server passing once) — background people never
    look at the subject.

## One-shot skeleton (long takes — what the app now emits)

Aesthetic anchor first, then labeled blocks:

```
CONTINUITY / PERFORMANCE: one continuous take, no cuts, no jump cuts — same face,
hair, outfit, set, light, camera position; action flows with no freezing/resets;
every movement begins from the previous one.
0-2s — … (flowing beats, reaction-driven)
…
ENVIRONMENT: alive but secondary; background people never look at the camera.
CAMERA: who holds the phone, height, distance, how it reacts; no artificial camera
movements, no dramatic zooms, no stabilization, no slow motion, no frame interpolation.
PERFORMANCE: idle-behavior block + physical object consistency (gravity respected).
AUDIO / DIALOGUE: room tone; dialogue with delivery; no subtitles/captions/watermark.
```

Say "one continuous take, no cuts" explicitly — Seedance may cut otherwise.
End state explicit ("settles and holds the framing naturally at the end").

## Seedance 2.0 specifics (verified vs official guide, Jul 2026)

- Register: **a director's shot brief** — natural sentences with concrete physical
  behavior; literal camera terms; zero mood adjectives / keyword tags ("8k,
  masterpiece" style stacking is a documented failure).
- ONE camera behavior per shot; camera-motion and subject-action in SEPARATE
  sentences ("camera spins around her dancing" is the canonical broken prompt).
- **Timestamps are ordering hints, not timing.** Official: precise timing ("0-3s")
  is unstable. Our reproduce-mode internal timelines survive as choreography
  ORDER; the edit's trim map recovers the exact cadence. Don't add new sub-second
  timing demands by hand.
- **Dialogue: curly braces** `she says casually {exact line}`, delivery outside;
  the braces prevent the line being burned in as a caption. ~5-10 words per line
  (≤12 words per 10s clip or the voice rushes); written pause beats between
  sentences; specify voice age/accent/energy or it drifts between clips. Seedance
  generates the speech audio natively. Front/¾ face, minimal head motion while
  speaking.
- Audio: music in `（）`, SFX in `<>`, `【】` renders on-screen text (never use).
  For UGC the literal phrase **"no music"** beats "no BGM" (both now emitted).
  "voice sounds like a phone microphone, natural room tone" + 2-3 inline diegetic
  sounds.
- Handheld mess: the negation pair **"no smoothness, no stabilization"** is
  load-bearing; escalate with "completely unstabilized, constant micro-jitters".
- Length: 60-100 words per shot; >150 words per shot = silent instruction dropout
  (after ~8 discrete requirements only 4-5 land). Long takes work as structured
  200-600-word choreography sheets (labeled blocks / Shot 1-2-3). Platform caps
  ~3,000 chars.
- Constraints: no negative-prompt field — ONE grouped ban line at the very end:
  "keep it subtitle-free, avoid generating any text or subtitles, no watermark"
  (+ "no music" for UGC). Landscape generation reduces spurious subtitles.
- Refs: 4-5 assets max (headshot + full-body; never multi-view sheets — ID drift);
  earlier in prompt = stronger binding; `@Image 1` binding syntax.

## Kling deltas (fallback — `videoModelTarget: "kling"`)

- Defaults smooth/cinematic; push toward mess explicitly: "handheld phone footage,
  handheld micro-shake, slight autofocus breathing, flat indoor lighting (not
  cinematic), phone camera look not commercial, minor framing imperfections".
- Put the camera instruction LAST (Kling weights trailing camera language) —
  opposite of Seedance.
- Dialogue: bracketed speaker labels — `[Her: casual voice]: "line"`.
- Iteration deltas work: "Make it less cinematic and more like phone footage."
- The legacy cost table (Kling for simple silent one-shots, CDance for
  dialogue/multi-clip/emotional) only applies under the kling target.

## Companion models (sanity-checked Jul 2026)

- **Seedream 4.5 Edit** (body pass): describe THE CHANGE ONLY, never re-describe the
  image. Pattern: target + change + protected list + light-matching ("…Keep the
  face, pose, hands, camera crop, and background unchanged. Match the original
  light."). One change per pass; 1-2 concrete bans inline ("do not change the face").
- **Nano Banana 2** (stills): composition is controlled by describing the frame and
  filling negative space with named content, plus explicit aspect ratio + shot-scale
  words; percentage sizing is unreliable. "candid, unposed" style descriptors give
  the uncomposed look.

## What the app enforces automatically

- Aesthetic anchor first (deterministic injection; short anchor preferred).
- Camera physics (motionSignature) injected if missing; source beat camera tokens
  re-injected in reproduce mode.
- Cinematizer lint (positive "cinematic/bokeh/film grain/…" fails the run).
- **Frozen-language lint** (pauses/frozen/staring/… — negation-aware) + **prescribed-
  expression lint** (intense pleasure/eyes rolling back/shocked/stunned…).
- **Idle-behavior block** appended to every a-roll motion prompt.
- **Secondary motion capped at 2 cues** (fallback: hair with head turns).
- Micro-expression (blink/gaze/breath) on face-showing beats.
- 30fps cadence tail; per-model position blocks (Seedance: negation pair + phone-mic
  "no music" line + subtitle-ban tail LAST; Kling: handheld block LAST).
- Dialogue embedded verbatim (curly braces on Seedance); voiceover formats stripped
  of all speech language.
- Char budget: multi-clip 900 (1100 w/ dialogue; 1100/1300 reproduce), one-shot 2400.
- videoModel: `cdance_2` (Seedance 2.0) for everything by default;
  `videoModelTarget: "kling"` restores the legacy split.
- Wardrobe: the ideation's chosen look resolves to its garment photo
  (`looks.wardrobeImages`) and ships in the brief as `wardrobeImagePath` — attach it
  to the WaveSpeed call alongside the face ref.
