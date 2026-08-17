# v3 — Filming-Fidelity Upgrade ("reproduce the filming")

**Goal:** when the app ideates a video for a profile, it REPRODUCES the source video's
filming — camera work, cut rhythm, body-motion beats — in the profile's new setting,
so the generated video feels shot on a phone, not AI.

## What changed

### Perception (the #1 fix)
Before v3 the analyzer sent video with NO fps → Gemini sampled ~1 frame/sec and
INVENTED every sub-second cut and motion timing. Now (`routes/analyze.ts`):

| Pass | Model | Sampling | Job |
|---|---|---|---|
| A — boundary map | `GEMINI_MODEL_FAST` | ~8fps, LOW res, temp 0, ×2 runs | cut timestamps + motion windows; only cuts BOTH runs agree on survive |
| Main | Pro | ~4fps HIGH (≤60s) / 2fps (≤90s) / 1fps MEDIUM (>90s) | full DNA minus virality, grounded by the Pass-A cut map |
| B — per-shot | Pro | clipped `startOffset/endOffset`, 4fps HIGH, ≤12 calls, ≤3 concurrent | shotSize/angle/lens/motionBeat/secondaryMotion/microExpression per shot |
| Micro | FAST | 12fps LOW over 1–3s motion windows | the sub-second body motion (the jiggle) |
| Virality | FAST | text-only over the DNA | the brutal scorecard — never re-grounds Pro on pixels |

- **Token estimator** (`gemini.ts fitVideoSampling`): frames×70/140/280 tok by res;
  fps/res auto-downshift before any call can blow budget (spend-cap = #1 outage).
- **Numeric gate before acceptance**: beats monotonic, durations sum to total ±0.5s,
  boundaries land on measured cuts. Fail → ONE scoped repair (only offending windows
  re-attached at higher fps) → deterministic normalize + `timingConfidence:'low'`.
- **Honesty stamps**: `source.samplingFps` + `source.timingConfidence`. The fps-honored
  detector compares `usageMetadata.promptTokenCount` against the estimate — if Google
  silently ignores `videoMetadata.fps`, we log and stamp low confidence.

### Schema (all extensions OPTIONAL on stored rows — legacy formats still /generate)
- `beats[]`: shotSize, cameraAngle, lensFeel, cutTransition, motionBeat,
  secondaryMotion{hair,fabric,softBody,accessories}, microExpression.
- `aesthetic`: colorTempK, lightingDirection, practicals[], realismTells (ENUM →
  canned NB+motion tokens in `rules.ts REALISM_TELL_TOKENS`), promptAnchorShort.
- `pacing.cutCadenceSec/payoffSec`, `audio.beatMap[]/syncType/roomTone`,
  `loop{}`, `motionCadence{}`.
- Generation: per-beat filming fields + `firstFrameSource` + `productionRoute[]`
  (NB→SD→face_restore→video→lipsync graph, face_restore explicit); per-ideation
  `continuityLock`; editPlan `trim{}` per clip + `loopPlan` + `postProcessing{}`.

### /generate — fidelityMode
`POST /generate { formatId, profileId, variationStrength?, fidelityMode? }`
- **`reproduce` (DEFAULT)**: beats pinned 1:1 to source (count, timing, shotSize,
  angle, cutType inherited DETERMINISTICALLY — the LLM only translates the scene);
  swap = identity/wardrobe/location/dialogue only; every source motionBeat must map
  to a natural same-motion action in the new scene.
- **`adapt`**: the classic reinvent-the-surface ideation (pre-v3 behavior).

### Deterministic injectors (post-append — never eat the LLM char budget)
`rules.ts`: ensureContinuity (lock strings on every nbPrompt), ensureNbRealism
(grade + realism tells baked into the still — first-frame law), ensureSkinTexture
(SD anti-plastic clause, skin QUALITY only), ensureBeatCameraPhysics (source camera
per beat in reproduce), ensureSecondaryMotion (REQUIRED — the loudest fixable AI
tell), ensureMicroExpression (blink/gaze/breath on face beats), ensureMotionCadence
(30fps/no-interpolation tail), applyModelPositionBlocks (kling handheld tail LAST;
cdance negation pair + phone-mic + subtitle ban LAST). Plus lintPlasticTells,
lintFidelity (dead zones, weak hook, 1:1 pinning, off-beat cuts), autofix additions.
Char caps: reproduce MULTI 700 / dialogue 900 (LLM text only; injected blocks free).

### Trim map (how sub-second cadence ships)
Kling can't generate <5s. For fast-cut sources the edit plan now carries a per-clip
trim: generate ≥5s, slice `useIn→useOut` on the beat (`audio.beatMap` referenced,
`landsOnBeat` verified). Post-processing block: 30fps, grain per source tells,
shake if too stable, rolling shutter on pans when the source had it, phone-HEVC 9:16.

### /qa loopback (Part H — optional, hero posts only)
`POST /qa/{generationId}/{beatIndex}` (multipart: `media` = generated still/clip,
optional `reference` = face sheet, `ideationIndex`) → AI-tell verdict
`{ readsAsAI, faceMatchScore, fidelityToSource, tells[], fixes[] }` where fixes are
targeted per-field regeneration edits. Every call is a paid Pro vision call.

## Verified
- All compiler tests green (90+ checks incl. every new injector).
- All archived goldens (pre-v3 rows) still parse — back-compat holds.
- Live acceptance: see FABLE5-LOG.md.
