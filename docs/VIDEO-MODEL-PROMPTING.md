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
- Char budget: multi-clip 550 (750 with dialogue), one-shot 1200.
