# Seedance 2.0 / Kling — Amateur iPhone UGC Prompting (researched 2026-07-24)

Why remakes came out "shot like a movie": video models read an unstated style as
"make it cinematic". The app now enforces the fixes below automatically (aesthetic
anchor first, cinematizer lint, model-specific rules) — this doc is the manual
reference for hand-written prompts and future tuning.

## The three laws

1. **First-frame dominance.** Image-to-video takes its STYLE from the input image;
   the prompt is a correction layer. Bake amateur into the NanoBanana/Seedream still
   (auto-exposure, blown highlights, faint sensor grain, imperfect framing, real skin
   texture). A clean pretty still = a cinematic video, whatever the prompt says.
   In the motion prompt, do NOT re-describe the scene — describe motion, camera,
   expression, dialogue only, and defend the look ("keep the raw phone look of the
   first frame").
2. **Earliest strong instruction wins (Seedance).** The look declaration goes FIRST:
   `Raw handheld iPhone footage, all camera settings automatic, no post-color grading,
   natural handheld jitter, flat natural lighting, deep focus, imperfect framing —
   NOT cinematic, no film look, no stabilization.`
3. **Lighting words are the strongest cinematizer.** "dramatic/moody/golden glow"
   will win against everything else. Use "flat natural lighting", "natural daylight".

## DO (proven on Seedance 2.0)

"raw handheld iPhone footage, all camera settings automatic" · "autofocus
occasionally hunts / autofocus breathing" · "automatic white balance shifts" ·
"flat image / flat indoor lighting (not cinematic)" · "lens flare, edge chromatic
aberration, slight overexposure, motion blur" (as imperfections) · "hand shake,
misaligned framing, clumsy zooms, occasional face cut-off framing" · "filmed by the
subject herself at arm's length / by a friend, reactive not professional" ·
"realistic skin texture (pores, stray hairs), no beauty filter" · "documentary-level
natural imperfections" · "no BGM, natural environmental sound, slight microphone
distortion" · for real mess the load-bearing negation pair: **"no smoothness, no
stabilization"** (without it Seedance drifts gimbal-smooth).

## DON'T (flips to movie mode)

cinematic · beautiful/stunning/epic/masterpiece · 8K/4K HDR/ultra-sharp · shallow
depth of field / bokeh (phones = deep focus) · dramatic/moody lighting · film grain /
35mm / anamorphic / color graded / teal-and-orange · "fast" on more than one element ·
vague "dynamic camera" · smooth lateral tracking / dolly / crane / orbit / glide.
Litmus test: if the prompt reads like a film trailer it fails; if it reads like one
creator briefing another before filming, it's right.

## Seedance 2.0 specifics

- Structure: look → subject (@Image 1 binding) → shots ("Shot 1 / Shot 2" storyboard)
  → audio → constraints. ~60-80 words per single shot; short structured > long poetic.
- ONE camera behavior per shot (stacking pan+push destabilizes). Camera-motion and
  subject-action in SEPARATE sentences.
- No hard timings ("0-3s") — officially unstable; let pacing be natural.
- **Dialogue: curly braces** — `she says casually {exact line}` + "voice sounds like
  a phone microphone, natural room tone, no BGM". Music in （）, SFX in <>.
- No negative-prompt field — constraints are inline at the END: "keep it
  subtitle-free, avoid generating any text or subtitles, no watermark". 9:16 + speech
  spawns spontaneous subtitles — always include the subtitle ban.
- Refs: 4-5 assets max; headshot + full-body (never multi-view sheets — twins/drift);
  earlier in prompt = stronger binding.

## Kling deltas (secondary model)

- Defaults smooth/cinematic; push toward mess explicitly: "handheld phone footage,
  handheld micro-shake, slight autofocus breathing, flat indoor lighting (not
  cinematic), phone camera look not commercial, minor framing imperfections".
- Put the camera instruction LAST (Kling weights trailing camera language best) —
  opposite of Seedance.
- Dialogue: bracketed speaker labels — `[Her: casual voice]: "line"`.
- Iteration deltas work: "Make it less cinematic and more like phone footage."

## What the app enforces automatically

- Analyzer extracts `aesthetic` (device/style/grade/realismMarkers/antiCinematic/
  promptAnchor) from every video — vlog vs skit vs selfie is classified.
- Every generated motionPrompt opens with the DNA's promptAnchor (deterministic
  injection if the LLM drops it; house default anchor for pre-aesthetic rows).
- Camera physics (motionSignature) injected if missing.
- Cinematizer lint: positive "cinematic/bokeh/film grain/…" fails the run (allowed
  only inside NOT/no negations).
- nbPrompt instruction bakes grade + realismMarkers into the first frame.
- Char budget: multi-clip 900 (1100 with dialogue), one-shot 1400 (reproduce +200).

## FABLE5 humanization layer (2026-08-14) — makes prompts read HUMAN by default

The engine now enforces the 11-principle humanization guide
(`~/Downloads/AI_Video_Prompting_Claude vs Gpt.docx`) so the operator no longer
hand-fixes prompts in ChatGPT. Split across the two layers:

**Taught in the instruction (`prompt.ts` HUMANIZATION LAWS)** — reaction-not-prescription
(never name an expression; let it emerge), freeze→continuation (no dead frames),
bystander sequences (notice→glance→look away, never "staring"), hands-need-a-reason,
continuous flow (beats reference the previous beat), background alive-but-secondary,
anti-portrait framing with numbers (~35–45%, room visible, chest-height, slight downward
tilt), and — ADAPT mode only — an establishing beat 0 + a text-overlay hook (REPRODUCE
mode keeps 1:1 filming fidelity, so the hook rides the overlay, not a new beat).

**Enforced deterministically (`rules.ts`, post-LLM, additive + idempotent)** —
`ensureIdleBehavior` (blinking/weight-shifts/relaxed hands/no-frozen-pose),
`ensureAmbientSound` (location-derived: bar=murmur/clinks, ranch=birds/breeze,
diner=utensils…), `ensureStaticCameraDefault` (see below), `ensureSecondaryMotion`
capped at **1–2 cues** (too many animate the clothing over the person),
`ensureAccentDelivery` (`profile.voice.accent` on every on-camera line), and
`stripBodyWordFull` on the SD pass (§3 below).

**Enforced by lint (fails → one-rewrite loop, negation-aware)** — portrait-framing terms
("waist-up"/"front angle"/"fills 60%"), freeze verbs ("stares at"/"holds still"/
"maintains eye contact"), and over-directed expression labels ("pure disgust"/"confident
smirk"/…). Conservative lists, verified against the guide's gold-standard AFTER + the
house `confirmedWorkingExamples` so they never flag a good prompt.

### §2 CINEMATIC-vs-HANDHELD classifier (the "how do we identify it" table)

Default every clip to **static amateur phone**. A camera MOVE is allowed ONLY when the
SOURCE genuinely had one (reproduce). Lint/rewrite the left column; force the right.

| CINEMATIC (ban / rewrite)                                   | iPhone / SNAPCHAT HANDHELD (force)                         |
|-------------------------------------------------------------|-----------------------------------------------------------|
| pan, tilt, push-in, dolly, crane, orbit, glide, track, zoom | static, locked-off, micro-shake only                      |
| smooth, stabilized, gimbal                                  | "no smoothness, no stabilization" (load-bearing, Seedance)|
| shallow depth of field, bokeh, blurred background           | deep focus, everything in focus, cluttered real background|
| dramatic/moody/golden-hour glow, rim light                  | flat natural lighting, natural daylight, harsh overhead   |
| symmetrical / centered / composed framing                   | off-center, subject ~35–45%, imperfect headroom, slight tilt |
| 4K/8K/HDR, film grain, 35mm, anamorphic, slow-motion        | vertical 9:16, natural 30fps phone motion blur, raw/candid|
| eye-level hero framing                                      | chest/shoulder height, slight 5–10° downward tilt         |

`ensureStaticCameraDefault` appends *"Static handheld, only natural micro-shake — no
pans, no tilts, no zooms, no push-ins"* to any beat with no camera-move verb and no
static declaration. To "reveal" something, cut to a **separate static insert clip** —
never tilt/pan to it (§2B).

### §6 Seedance 2.0 is the PRIMARY target

`chooseVideoModel` now defaults every ideation to `cdance_2` (Seedance 2.0) — ≤15s clips,
stitched multi-clip in the edit. `kling_3` stays a fully-supported fallback seam (pass
`preferKling`; all Kling code paths — trailing camera block, dialogue label — remain live).
**Timing:** Seedance parses hard "0.0-0.9s:" timestamps as unstable, so reproduce-mode
multi-beat takes now carry a **phase-word** internal timeline ("First … then … finally …");
the exact per-beat trim seconds live in `editPlan.clips[].slices` (computed deterministically
from the source) and are applied when the take is chopped — fidelity kept in the edit.

### §3 "full" body-word ban

The word "full" over-amplifies Seedream ("full bust/hips/thighs" dramatizes the body).
Removed from all seed `sd.frameTypeTemplates` and stripped from every generated `sdPrompt`
(`stripBodyWordFull`) → "natural/curvy/shapely/soft" + "realistic proportions, NOT
exaggerated". "full body/frame/length" (framing) is preserved.

### §4 per-profile data

`voice.accent` (spoken-delivery descriptor) injected into every on-camera line. Wardrobe
palette rotation + distinct-location spreading across the 3 variants ride the per-variant
`VARIANT_HINTS` (variants are independent invocations, so diversity is instruction-driven,
not cross-variant state).

## Aug 17 2026 — ONE-SHOT ENGINE + live-session corrections (supersede §6 where they conflict)

- **ONE-SHOT LAW:** ≤15s in one continuous scene = ONE Seedance take (MAX_SEGMENT_SRC_SEC=15),
  ALL modes incl. reproduce — source cut cadence is recreated by slicing the take
  (editPlan slices), never by separate generations. Splits only on a-roll↔b-roll or >15s
  → fewest/longest BALANCED takes, none under 5s. Dialogue skits across scenes stay multi-take.
- **"no smoothness, no stabilization" is REINSTATED** in the Seedance lean tail — Khian's
  Aug 17 live hose/watermelon session proved it load-bearing on 2.0 (drifts gimbal-smooth
  without it). §6's "1.x workaround" reading is superseded.
- **Dialogue = CURLY BRACES** `she says casually {line}` (tone outside) — §6's double-quote
  reading is superseded; braces re-validated live. Mouth-busy beats (eating/drinking) route
  their line to OFF-CAMERA VO — never lip-sync (the dialogue field is labeled "VO (…)").
- **Choreography-sheet structure** (one-shot, up to 1200 chars): LOOK declaration first
  (defend the first frame, don't re-describe the scene) → phases in continuous flow
  ("First … then … finally …") → ONE camera behavior per phase, camera and action in
  separate sentences → ambient + phone mic → constraints last (subtitle/watermark ban).
- **PROP-PHYSICS LAW:** any emitting/pouring prop needs its SOURCE named in the first frame
  and already-active at clip start (visible nozzle, water running; cut-face, no spawned knife).
- **SELF-CHALLENGE pass** (rules.ts `challengeMotionPrompt`): deterministic, negation-aware
  final critique — guarantees negation pair, subtitle ban, ambient, curly braces; logs to
  `beat.challengeLog`. Cross-beat verbatim camera-line duplicates → one-rewrite loop.
- **Image side:** GPT-Image-2 one-shot first frame (ref kit: 4 face + 3 headless body crops
  from the model root `_LOCKED/`, all base64) + §2 body-match LEAD (command the shape;
  "Curvy but LEAN, NOT thick, NOT a BBL." cap); Seedream = conditional body/wardrobe
  add-back only. Verbatim anti-slop suffix on every image prompt (`ANTI_SLOP_SUFFIX`).
  Moderation: strip → retry once → route descriptors to Seedream → NB fallback (route
  step `onModerationFlag`); swimwear+water → tank base + required Seedream swap.
