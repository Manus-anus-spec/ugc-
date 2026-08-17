# FABLE 5 — UGC App Overhaul Brief (2026-08-14)
**Mission:** make the app's generated prompts come out **human, iPhone/Snapchat-real, and non-copied BY DEFAULT** — so the operator never again has to hand-fix a prompt in ChatGPT/Claude before it produces a good video. This is instruction-string + rules + lint work in the existing engine, **not** an architecture rewrite. The Jul-21→30 rebuild (one-worker `ugc-api` + D1 + zod contract + v3 filming-fidelity) is DONE and live — do not touch it.

## STEP 0 — READ FIRST (source of truth, in order)
1. `/Users/mac/Downloads/AI_Video_Prompting_Claude vs Gpt.docx` — the 11-principle prompting guide + a real BEFORE/AFTER of one of our own app prompts. **This is the humanization spec.** (`textutil -convert txt` if needed.)
2. `docs/FABLE5-PROMPT-humanize-ugc-app.md` — the earlier staged version of this work (never applied). This brief SUPERSEDES it and adds everything learned since.
3. `docs/APP-IMPROVEMENT-LOG.md` — the running list of concrete fixes from live production (items 1–18). Every item must end up enforced by code.
4. `docs/VIDEO-MODEL-PROMPTING.md` — current camera/aesthetic rules (update this doc to match your changes).

**Primary files to edit:** `worker/src/generate/prompt.ts` (the motion/nb/sd instruction block → Gemini), `worker/src/generate/rules.ts` (bannedWords, cameraLines, lint), `shared/schemas.ts` (one or two field/comment changes), profile seed `worker/seeds/profiles.ts` + the live profiles (`voice`, `looks`, `world` rules).

**Standing rule:** propose the plan + diffs, run the golden tests, and show a BEFORE/AFTER prompt before declaring done. Keep `sdPrompt`/`motionPrompt` clean copy-paste boxes (never leak file paths, ref names, or "two-step pipeline" language). Preserve the identity firewall (face lock), the NB/SD split, and reproduce/adapt modes.

---

## PART 1 — MOTION-PROMPT HUMANIZATION (the 11 principles → enforced by code)
Translate every principle from the .docx into the app's instruction strings + banlists so the LLM produces them by default. Every generated `motionPrompt` must satisfy:
1. **Reaction, not prescription** — stop naming expressions ("pure disgust", "confident smirk", "feigned innocent"). Describe what she's *reacting to*; expressions *develop* across the beat, never instant-swap.
2. **Ban freeze words** (dead frames). Add to bannedWords: `pauses`, `stands frozen`, `holds the expression`, `briefly holds`, `staring`, `stares`, `maintains eye contact`, `freeze`, `holds still`, `hold ~Xs`. Replace-with menu: "briefly looks toward…", "her expression shifts as…", "continues moving while…", "glances toward… then returns her attention".
3. **Idle-behavior block on every prompt:** blinking, small eye saccades, breathing in the shoulders, subtle weight shifts, natural finger relaxation, micro facial movement — no exaggerated expressions, no robotic symmetry, no frozen pose between actions.
4. **Bystander reactions** = believable sequence: notices → second glance → realizes he's been noticed → looks away. Never "shocked/staring".
5. **Hands need a reason, not a script** — one motivation to move (turn a bottle, brush hair, rest near hip); do NOT script constant gestures ("real people move, stop, and settle").
6. **Secondary motion capped at 1–2 cues** (hair on a head-turn, fabric on a weight-shift). Too many makes the model animate clothing over the person.
7. **Continuous flow, not timestamp islands** — beats reference the previous beat ("still holding the bottle from before"); no per-timestamp posture resets.
8. **Background alive but secondary** — named independent extras (someone reaching for a beer, a server passing once); nobody staring at camera / performing.
9. **Add a LINT PASS** (in `rules.ts`) that FAILS/rewrites any generated prompt containing: freeze words · "waist-up"/"front angle"/"subject fills 50–60%" · **"full"** (see Part 3) · over-directed expression labels · banned cinematic tokens as positives.

### Reconcile these 3 conflicts (change, don't blind-append — the guide contradicts current rules)
- **Secondary motion:** current schema/instructions push it hard ("a beat where all four secondary cues are none is almost always wrong"). REVERSE to **1–2 cues max.** Update the schema comment AND prompt.ts.
- **"Exact/identical composition":** continuity currently leans on "identical composition". Change to **relative-layout description** (camera height, distance, subject position, headroom, background landmarks) — diffusion reproduces relative layout more reliably. Keep set/wardrobe/light continuity.
- **Repeated verbatim camera line every beat** is an AI tell — stop emitting it identically per beat; integrate camera into the flow.

---

## PART 2 — CAMERA: KILL "CINEMATIC", FORCE iPhone/SNAPCHAT HANDHELD ⭐ (Khian's #1)
The app already bans cinematic *lighting/lens* words, but generated prompts still **feel produced** because it does not forbid **camera MOVEMENT** or force amateur framing. Even a "gaze tilt down to the shoes" reads cinematic. Fix the whole camera layer:

**A. Default = STATIC amateur phone.** Every motionPrompt defaults to "static handheld, only natural micro-shake — no pans, no tilts, no zooms, no push-ins." A camera MOVE is allowed ONLY when the SOURCE genuinely had one (reproduce mode) — and even then, express it as a **real phone behavior** (quick handheld pivot → slight overshoot → settles; blur only during the fastest part), never a smooth cinematic move.

**B. Make any "reveal" its OWN static clip.** Do not tilt/pan to reveal something — cut to a separate static insert clip. (This directly fixes the shoe-reveal failure.)

**C. Build a CINEMATIC-vs-HANDHELD classifier/lint** — this is the "how do we identify it" Khian asked for. Encode both tell-lists and lint against the cinematic column:

| CINEMATIC (ban / rewrite) | iPhone / SNAPCHAT HANDHELD (force) |
|---|---|
| pan, tilt, push-in, dolly, crane, orbit, glide, tracking, zoom | static, locked-off, micro-shake only |
| smooth, stabilized, gimbal | "no smoothness, no stabilization" (load-bearing for Seedance) |
| shallow depth of field, bokeh, blurred background | deep focus, everything in focus, cluttered real background |
| dramatic/moody/golden-hour glow, rim light | flat natural lighting, natural daylight, harsh overhead |
| symmetrical / centered / composed framing | off-center, subject ~35–45%, imperfect headroom, slight tilt |
| 4K/8K/HDR, film grain, 35mm, anamorphic, slow-motion | vertical 9:16, natural 30fps phone motion blur, raw/candid |
| eye-level hero framing | chest/shoulder height, slight 5–10° downward tilt |

**D. Anti-portrait framing with numbers** (from the guide): "NOT a portrait, NOT close-up, environmental composition, medium-wide, subject occupies ~35–45%, room clearly visible." NB stills ~30–35%, lots of negative space, "not intentionally composed." Ban "waist-up/front angle" as framing terms.

**E. Model-specific weighting:** Seedance = put the raw-look declaration FIRST + "no smoothness, no stabilization"; Kling = put the handheld camera block LAST. Keep both seams.

Update `docs/VIDEO-MODEL-PROMPTING.md` with the classifier table + static-default rule.

---

## PART 3 — THE "full" BODY-WORD BAN (Seedream over-amplification)
Live finding: the word **"full"** ("full bust / full hips / full thighs") makes Seedream **over-dramatize the body** — removing it = correct every time. 
- Add **"full"/"fuller"** to a **body-word banlist** applied to every generated `sdPrompt`.
- Replace-with vocabulary: "natural / curvy / shapely / soft" + "realistic proportions, NOT exaggerated, NOT distorted." 
- The frame-template already encodes body shape — do not stack extra body specs on top (existing known-bug guard stays).

---

## PART 4 — WARDROBE VARIETY, LOCATIONS, ACCENT, AMBIENT (per-profile → generator-enforced)
1. **Wardrobe colour/style rotation.** `looks.wardrobeDefaults` was too thin + "exact color per scene" → the LLM defaulted every outfit to **red**. Every profile needs (a) a **palette** and (b) a **"vary style + colour every video, never repeat the last, don't default to one colour" rule**. The generator should **track the last-used outfit/colour across the 3 ideations and force a different one** each time.
2. **Location spreading.** Whitelists are under-used (only ~2–3 surface). The generator must **spread the 3 ideations across DISTINCT whitelist locations**, not reuse the same 2–3.
3. **Accent injection.** The app omits accent → dialogue sounds generic. Add an **accent / voice-delivery descriptor to the profile `voice` object** (e.g. Belle = "soft warm Texas drawl, not theatrical") and **inject it into every dialogue line** in the motionPrompt.
4. **Location-matched ambient sound.** Prompts only say "room tone, no BGM." **Derive scene-appropriate ambience from the chosen location** and add it to the audio line: bar = murmur/chatter/clinks; ranch/outside = birds/breeze/cicadas/distant animals; diner = utensils/booth noise; keep "phone-mic, no BGM."

*(Belle's live profile already has palette+rotation, 31 locations, "full" removed, and tuned SD templates — use it as the reference shape; make the same guarantees generator-side for ALL profiles.)*

---

## PART 5 — SCRIPT / IDEATION QUALITY (pull the right data, reproduce WITHOUT copying)
The hardest operator problem: getting a script that reproduces a source video's format without copying it. Tighten the ideation engine:
1. **Extraction = keep the MACHINE, swap all the PAINT.** From the source, PULL only: the hook mechanism (first 1–2s scroll-stop), the beat structure + escalation, the emotional TURN/payoff, the format type, the cut rhythm. SWAP every concrete detail: identity, location (whitelist), wardrobe (palette), the specific scenario/props, and dialogue (profile voice + accent). Success test: same scroll-stop mechanism, **zero recognizably-lifted concrete detail.**
2. **Force an ESTABLISHING opening beat.** Clips currently start mid-conversation → confusing. Beat 1 must establish context (she notices someone approach; the exchange starts from the top) AND emit a **text-overlay hook** (in `textOverlays`, profile voice) that states the premise in one line.
3. **Default to 2–3 short stitched clips (NOT one long take).** One long generation is expensive + drift-prone ($17 waste observed). **Seedance 2.0 clips cap at ~15s** — size each clip to its actual content (a dialogue exchange ≈ 1.5–2.5s/line), split a skit into a setup clip + insert clip + reaction clip, and stitch in the edit. Never pad a clip to the max.
4. **Canonical archetype taxonomy** — nudge the analyzer/generator toward a fixed filterable archetype list (drifts free-form today), so ideations are repeatable and searchable.

---

## PART 6 — TARGET SEEDANCE 2.0 (clips ≤15s)
Primary production model is **Seedance 2.0** — clips cap at **~15s**, so the app should assume **multi-clip skits stitched in edit**, never one long take. Make Seedance 2.0 the default motionPrompt target; keep Kling/CDance as a model-aware fallback seam (target switch, per-model cameraLines/char-caps/dialogue handling). Ground wording in how Seedance 2.0 actually parses (natural phrasing vs technical directives, continuous-motion handling, dialogue in `{curly braces}` with delivery outside, char sweet-spot, the load-bearing "no smoothness, no stabilization"). Sanity-check companions: WaveSpeed **Seedream 4.5 Edit** (body pass) + **Nano Banana** (stills). Document the Seedance 2.0 profile in `docs/VIDEO-MODEL-PROMPTING.md`. (Do NOT target Seedance 2.5 — not in use.)

---

## PART 7 — SECONDARY (lower priority; leave clean TODOs if out of scope this pass)
- **One-click audio extraction** on analyze/upload (download button/endpoint) so the operator stops re-finding audio in CapCut.
- **Wardrobe reference-image surfacing** in the brief/export (surface the chosen look's garment-image path so it can be attached to WaveSpeed alongside the face ref).
- **Onboarding realism:** require 4–6 NEUTRAL/bland face shots + defined wardrobe in the profile template (avoid the face-drift wall).
- **Profile data:** real Naomi/Niko `world`/`voice`/ref-strategy values (still stubbed); ChatGPT-2 image-template draft.

---

## PART 8 — AUTO-PIPELINE: one-click "idea → finished clips" ⭐⭐ (major feature — its own project)
**Goal:** after ideations generate, an **Execute** button on an idea card runs the ENTIRE production automatically — images → QA → video → stitch — with **auto-retry on every failure (esp. moderation)** so the operator stops app-hopping and just collects finished clips.

**Reality check (state this to Khian):** the app today generates NOTHING (prompt-compiler only), has NO model calls and NO ref storage. This feature is a new orchestration layer, not a string edit. Scope it as a **separate Fable-5 project AFTER Parts 1–6 land.** Phase it.

### Prerequisites (build first)
- **Ref store:** upload each model's face + body refs to **R2** (or stable hosted URLs) so the worker can fetch them (`_LOCKED/face-refs` + `body-refs`). App currently has no access to them.
- **Model secrets** (worker): WaveSpeed (nano-banana-2, Seedream 4.5 Edit, Seedance 2.0), OpenAI (gpt-image-2), Kling.
- **Async multi-step job engine:** extend the existing D1 jobs + SSE with per-step status + retry counters (Cloudflare Queues; needs the Paid plan for CPU).

### The pipeline (per ideation, on "Execute")
- **Stage 0 — Settings gate (optional modal / "Auto"):** image model (nano-banana default, gpt-image-2 optional), video model (Seedance 2.0), clip count, quality, **max-retries + budget cap**, show a cost estimate.
- **Stage 1 — First-frame image gen** per clip: build the moderation-safe nbPrompt (Part 3 / log item 19), call the image model with the model's face+body refs.
  - **MODERATION-RETRY LOOP (the core ask):** on a "sensitive content" error → auto-run the sanitizer (strip youth wording, `corset`→`fitted`, `tight`, `heavy-lidded`, `sweetheart`…) and retry → if still failing, **switch model** (gpt-image-2 → nano-banana-2, which has no OpenAI filter) → retry. A moderation error NEVER stops the run; it escalates down a fallback chain until a frame exists.
- **Stage 2 — Face/Body/Character QA gate (automated — reuse the Gemini vision scorer already in `qa.ts`):** check face-match to ref · body matches the body ref, not distorted, not over-amplified (the "full" issue) · hands/artifacts · age-read · IG-safe. **FAIL → regenerate that frame (back to Stage 1) up to N times, feeding the failure reason into the prompt.** Only QA-passed frames proceed.
- **Stage 3 — Body pass (only if the first frame came out slim):** Seedream with the model's tuned `frameTypeTemplates` (no "full") → re-QA.
- **Stage 4 — Video gen** per clip: QA-passed first frame + the humanized motionPrompt (static camera, accent, ambient, ≤15s Seedance 2.0) → retry/fallback on failure or moderation.
- **Stage 5 — Video QA gate:** vision-check each clip (face stability, body consistency, artifacts, matches the beat). FAIL → regenerate the clip.
- **Stage 6 — Assembly:** Phase B = output QA-passed clips + the assembly plan (order, trims, captions, audio) for the operator. Phase C = worker-side **ffmpeg stitch** into the final 9:16 with burned captions + trending audio.
- **Stage 7 — Deliver:** finished video / clip bundle appears on the card with a **download button + a QA report** (what passed, what was retried, any clip that still needs the operator).

### Bulletproofing (the "keeps retrying till it's ready" requirement)
- Every stage has a **retry budget + fallback chain** (model swap · prompt-sanitize · param adjust). Job state persists in D1 (**resumable**); progress streams via the existing SSE.
- **Hard budget cap + max-retries** so a run can't blow up cost (each full video = many paid calls — this MUST be capped).
- If a single clip exhausts retries, flag ONLY that clip "needs operator" — the rest of the video still completes.

### Phasing (ship value early)
- **Phase A (MVP, biggest time-saver):** ref store + image-gen + moderation-retry + face/body QA → one-click "all first frames, QA'd, moderation-proof." Removes most of the manual grind immediately.
- **Phase B:** + video-gen + per-clip video QA.
- **Phase C:** + worker-side stitch/caption/audio → true one-click finished video.

**Bottom line for the brief:** Parts 1–6 (prompt humanization) make each generation GOOD; Part 8 makes the whole chain AUTOMATIC. Do 1–6 first (fast, high-impact, low-risk), then Part 8 as a dedicated build once R2 + model keys + Paid plan are in place.

## PART 9 — PRIMARY IMAGE METHOD: GPT-Image-2 MULTI-REF ONE-SHOT ⭐ (record Belle's recipe, apply to all models)
The best stills we make come from a ONE-SHOT on **`openai/gpt-image-2/edit`** with a multi-ref set — **no Seedream, no face-restore, one pass.** Proven on Belle (`Belle Ai Model/03-content/_scripts/belle-generate.js` + `BELLE-CONTENT-RECIPE-LOCKED.md`). Make this the app's DEFAULT image path (replacing NB→Seedream wherever GPT-image can hold the body).

**THE RECORDED RECIPE (Belle — replicate per model):**
- **Model:** `openai/gpt-image-2/edit` (WaveSpeed), ONE pass.
- **Refs (base64, fed together):** 4 face crops (`_LOCKED/face-refs`) + 3 HEADLESS body crops (`_LOCKED/body-refs`: front/back/side, cropped from operator-APPROVED shots). The body refs are the whole trick — GPT-image-2 copies the exact approved curve, so **NO Seedream is needed** and the body never over-amplifies.
- **Prompt = IDENTITY + SCENE + CANDID + REALISM:**
  - IDENTITY: "Candid amateur iPhone photo of the SAME young woman in the reference photos. Keep her exact face identical to the face refs — **never describe her face** (refs are the lock). Her body matches the body reference photos: curvy hourglass, natural, not exaggerated."
  - SCENE: the only per-image variable.
  - CANDID: gaze off-camera, mid-action, varied expression, pulled-back framing (Part 1/2).
  - REALISM: sharp in-focus background, real skin/pores/freckles, not airbrushed, no bokeh, 9:16.
- **Moderation-safe vocabulary** (log item 19): no youth wording, no corset/tight/heavy-lidded/sweetheart.
- **Fallback:** on "sensitive content" → sanitize + retry → switch to `nano-banana-2/edit` (no OpenAI filter).
- **Per-model setup:** each model needs its own `_LOCKED/face-refs` + `_LOCKED/body-refs` (crops of approved images) in the R2 ref store. **Belle = done & tested.** Naomi / Rosalia(Jordan) / Sav = same recipe, set up + tested by the operator, one at a time; record each model's working recipe (refs + any tweak) in a per-model recipe table.

**App change:** GPT-image-2 multi-ref one-shot = default in Part 8 Stage 1; NB→Seedream only as fallback. Persist each model's proven recipe so it's repeatable.

## PART 10 — LEARNING IDEATION ENGINE (video DB + cross-video synthesis, get smarter over time)
Ideations are currently one-source and often weak/derivative. Upgrade to a LEARNING system:
1. **Ingest + database EVERY source video** with its full blueprint (hook, beat structure, why-it-works mechanism, retention drivers, swapMap) in D1 — a growing knowledge base (the library exists; enrich it + always store the "why it's viral" in plain language).
2. **Cross-video synthesis:** ideation must be able to COMBINE insights from MULTIPLE videos in the DB — hook from one, beat structure from another, a scenario angle from a third — to invent something genuinely NEW (not a reskin of one source, not "bullshit"). "Learn from the whole library → produce an original."
3. **Get better over time:** weight ideas toward patterns that scored well (Part 11), away from what flopped — continuous improvement, not static rules.

**App change:** analyzer persists a richer per-video blueprint; add a "synthesize across library" generation mode (combine N formats → 1 novel ideation) alongside single-source reproduce/adapt; inject top-scoring patterns into the generator prompt as exemplars.

## PART 11 — FEEDBACK & SELF-IMPROVEMENT LOOP (scoring + notes → the app learns from OUR results)
Close the loop so the system improves from what we actually ship:
1. **Score each generated output** (image/clip/video) in-app — 👍/👎 or 1–5.
2. **Notes field** for Khian/Niko to say WHY it was bad ("body over-amplified", "face drifted", "too cinematic", "started mid-convo").
3. **Store score + notes** against the exact prompt/DNA/profile that produced it (D1).
4. **Feed it back:** high-scoring prompts become exemplars in future generations; recurring bad-notes auto-become new lint rules / banned patterns. The hand-kept `APP-IMPROVEMENT-LOG.md` becomes a LIVE in-app dataset the generator learns from.
5. Optional: a periodic "what's failing lately" digest to promote frequent notes into permanent rules.

**App change:** add score+notes to the generation record; a retrieval step injecting top-scored exemplars + active bad-note rules into the generator prompt; a simple review UI.

## ⭐ FOR FABLE 5 — IMPROVE THIS BRIEF, DON'T JUST EXECUTE IT
Before you implement: **critique and EXPAND this brief.** Find what's missing, propose better approaches where you see them, pressure-test feasibility / cost / sequencing, and flag risks. Specifically design the cleanest architecture for: the **ref store** (R2), the **job + retry engine**, the **learning DB + cross-video synthesis**, and the **scoring/notes feedback loop**. Call out anything about realism, moderation, model-routing, cost control, or the learning loop that we haven't thought of. Return an improved plan + your proposed phasing BEFORE writing code — treat this as a starting point to make better, not a spec to follow blindly.

## VERIFICATION (required before "done")
1. Generate ONE ideation on an existing format for `belle` (and `rosalia`) BEFORE and AFTER; paste both motionPrompts.
2. Show the AFTER now exhibits: reaction-driven expressions · zero freeze words · ≤2 secondary-motion cues · **static camera default (no un-sourced pans/tilts)** · anti-portrait % framing · continuous-flow beats · idle block · **accent on dialogue** · **location-derived ambient** · **no "full" in sdPrompt** · rotated non-red wardrobe · an establishing beat + text hook. It should read like a human-fixed prompt with nobody touching ChatGPT.
3. Golden FormatDNA tests still pass; schema validates; the cinematic/"full"/freeze-word lint actually fires on a bad input.
4. Report: files changed, before/after diff, how the 3 conflicts were reconciled, the Seedance 2.0 profile applied, and anything deferred.

## NON-CODE BLOCKERS (flag to Khian — not your code work)
- Gemini spend cap / billing (gates live acceptance — verify current balance).
- Repo still on `Manus-anus-spec` → move to an Aruna org before sharing the URL (update CORS).
- Cloudflare Workers **Paid** ($5/mo → 30s CPU) to kill the 1102 failure class; optional `GEMINI_API_KEY_FALLBACK`.
