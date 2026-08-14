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

## Cinematic vs iPhone/Snapchat handheld — the classifier (Aug-14)

**Seedance 2.0 is the DEFAULT motionPrompt target** (our production model; skits are
multi-clip stitched in the edit). Kling is the cost-efficient fallback seam
(`chooseVideoModel({..., preferModel:'kling_3'})`). Camera default = **STATIC amateur
phone, micro-shake only** — a move is allowed only when the SOURCE has one, and even then
expressed as real phone behavior (quick handheld pivot → slight overshoot → settles), never
a smooth cinematic move. Any REVEAL becomes its OWN static insert clip, not a tilt/pan.

| CINEMATIC (ban / rewrite)                              | iPhone / Snapchat HANDHELD (force)                 |
|--------------------------------------------------------|----------------------------------------------------|
| pan, tilt, push-in, dolly, crane, orbit, glide, zoom   | static, locked-off, natural micro-shake only       |
| smooth, stabilized, gimbal                             | "no smoothness, no stabilization" (load-bearing)   |
| shallow depth of field, bokeh, blurred background      | deep focus, everything in focus, real background   |
| dramatic / moody / golden-hour glow                    | flat natural lighting, natural daylight, harsh overhead |
| symmetrical / centered / composed framing              | off-center, subject ~35–45%, imperfect, slight tilt |
| 4K/8K/HDR, film grain, 35mm, anamorphic, slow-motion   | 9:16, natural 30fps phone motion blur, raw/candid  |
| eye-level hero framing                                 | chest/shoulder height, slight 5–10° downward tilt  |
| "waist-up" / "front angle" / "subject fills 50–60%"    | "NOT a portrait, environmental, room clearly visible" |
| named expression labels ("intense pleasure", "smirk")  | describe what she reacts to; let expression develop |
| freeze words ("stands frozen", "holds", "staring")     | "briefly looks toward…", "expression shifts as…"    |

Litmus test: if it reads like a film trailer it fails; if it reads like one creator
briefing another before filming, it's right. The engine LINTS the left column
(negation-aware — "no pans", "NOT a portrait" pass) and INJECTS the humanization blocks
(idle behavior on one-shots, location-matched ambient, spoken accent). "full" is stripped
from every SD body pass (improvement-log item 1).

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
- Char budget: multi-clip 550 (750 with dialogue), one-shot 1200.

## Humanization enforcement (Aug-14 FABLE5 overhaul)

Baked into `worker/src/generate/{prompt,rules}.ts` so prompts come out human by default —
no ChatGPT-paraphrase detour. Both layers: the LLM instruction (`prompt.ts` HUMANIZATION
LAWS) tells the model to do it; `rules.ts` guarantees it deterministically for EVERY
profile (incl. live D1) — no data migration.

- `lintHumanization()` (negation-aware, phrase-level) flags: freeze/dead-frame phrases,
  portrait framing ("waist-up"/"front angle"/"fills 50–60%"), cinematic camera moves
  (pan/tilt/push-in/dolly/zoom…), and over-directed expression labels. Gold-standard
  phrasings ("small pauses while chewing", "hold the eye contact", "no frozen pose",
  "exaggerated but playful") intentionally DO NOT fire.
- `ensureIdleBehavior()` — the natural-idle block on ONE_SHOT sheets; MULTI clips get the
  anti-freeze anchor via `ensureMicroExpression()` (kept tight for char budget).
- `ensureAmbient()` — location-matched ambience from the continuity lock (bar→clinks,
  ranch→birds/breeze, diner→utensils). Skipped for trending_audio.
- `ensureAccent()` — injects `profile.voice.accent` into on-camera dialogue delivery.
- `autofixSdBodyWord()` — strips the "full" body amplifier from every SD pass.
- `ensureSecondaryMotion()` — capped at ≤2 cues (over-listing animates clothing over the
  person). Reconciled the old schema rule that pushed all four.
- Continuity uses RELATIVE layout language, not "identical/exact composition".
- `chooseVideoModel()` defaults to Seedance 2.0; Kling reachable via `preferModel`.

Deferred (FABLE5 Part 7 — not code this pass): one-click audio extraction on analyze,
wardrobe reference-image surfacing in the brief/export, onboarding SOP (4–6 neutral face
shots). Live D1 profiles inherit the new guarantees automatically via the deterministic
injectors/autofix; re-seed them to also pick up the seed-level `accent` + "full"-free
templates.
