# UGC Reverse-Engineer — Rebuild Brief (for Fable 5)

*Prepared 2026-07-21 by the orchestrator (Claude Code). Phase 0 research complete. This is the "what we really want" document to hand Fable 5 before its audit + re-architecture plan.*

---

## 0. The one-line thesis

**Match Higgsfield's analysis depth; beat them on the three things they refuse to do — portable prompts, a persistent user-owned format library, and apply-this-format-to-MY-model across MY tools.** Our current app already targets that exact wedge; it's broken in execution, not in concept.

---

## 1. Vision (owner: Khian)

Drop any viral short-form video in → the app deconstructs *what made it viral* to a tee (format, hook, motion, camera, pacing, setting, audio, text, why-it-works) → saves the **essentials** as a reusable **format** in a library → spits out **ready-to-use prompts to generate our OWN model's version** of that video using the same format, across NanoBanana/ChatGPT-2 (image) → C-dream/Seedream (body/edit) → C-dance 2.0/Kling (motion).

- **Not** copy-paste-swap-the-creator. Capture the *foundation* so any creator's version can be built from the same principles.
- Build a library of formats/motions/prompts/settings so viral content becomes effortless and repeatable — and *teaches* what viral actually is.
- **Generation = ideation, not clone:** the output is a NEW video built on the OG's blueprint (keep the ~80% that made it work, reinvent the rest), not a face-swap of the original. See §4g.
- **Scope:** internal now (Khian/Niko AI-OFM + Aruna models Sav/Naomi), architected clean so it can become a paid product later. No multi-tenant/billing work yet, but zero hard-coded creator identity.

---

## 2. Competitive wedge — validated (Higgsfield research)

Higgsfield ships this capability across 3 features: **Video Analysis** (scene-by-scene), **Virality Predictor** (hook/hold/retention + brain heatmap, ≤15s), **Ad Reference** (recreate a video's format with your avatar). Their analysis depth is the bar to match. But their limitations are our product:

| Higgsfield gap | Our play |
|---|---|
| **Deliberately HIDES raw prompts** ("internalizes cinematic decisions") | **Output portable, per-scene copy-paste prompts** for external tools |
| **Locked to their own models** (Sora 2 / Seedance) | **Bring-your-own-tool:** NanoBanana → Seedream → Kling |
| **No persistent user-owned format library**; presets are house-authored & disposable | **Tagged, versioned, searchable library YOU build** |
| **User presets store STYLE ONLY** (their own words) — not hook/pacing/narrative DNA | **Capture structural DNA:** hook + beats + camera + pacing + audio + overlays + why-it-works |
| **No format→my-character binding, no cross-tool orchestration** | **Apply a saved format to any model profile**, orchestrate face→body→motion |
| **15s cap; accuracy degrades on longer clips; URL upload not supported on MCP** | **URL-native ingestion; handle full-length reels** |
| **Black box, non-deterministic, billing-trust complaints** | **Transparent, exportable (JSON/markdown), own-your-data** |

A Reddit power-user method shows creators *still* manually reverse-engineer viral AI videos with ChatGPT + JSON prompting — **because no tool hands them portable prompts.** That is the unmet need, and it is exactly what this app is for.

---

## 3. Current app — diagnosis (audit summary)

The deployed analysis prompt is genuinely good IP (18 sections, camera-setup-first, character-appearance lock, 4-frame extraction, NB→Seedream→video split). It *feels* shallow and *saves junk* because of specific, fixable breaks:

1. **Wrong model tier** — analysis runs on **Gemini 2.5 Flash** (`worker-v4.2.0.js:366`), which can't perceive the frame-level detail the prompt demands. → shallow output.
2. **Prose, then broken scraping** — analysis returns freeform markdown; the client regex-parses it with **the wrong section numbers** (`App.tsx:155-164` vs the worker's real 18-section schema). Every "structured" library field is mislabeled (camera stores ad-type, hook stores audio, etc.). → "saves junk not essentials."
3. **Identity hard-coded to Sav** — the generator **ignores the model selector** (`sav-viral-scanner.js:1988` never reads `model`); "Make for Naomi" produces Sav content.
4. **URL analysis dead on arrival** — field-name typo (`url` vs `videoUrl`, `App.tsx:847` / `worker-v4.2.0.js:626`).
5. **Structural debt** — 1,646-line `App.tsx` monolith; two duplicate KV libraries drifting apart; no auth + CORS `*` (anyone can wipe the library); silent failures show "Saved!" on data loss.

**Keep:** the analysis prompt's *content/structure*, the generation rubric (Kling-vs-CDance selection, face-forward rule, mandatory SD pass, QA checklist), the `sav-content-library` brief shape (right target, wrong fill), the URL resolvers + Gemini File-API upload helpers.
**Throw out:** all client-side regex parsing (replace with typed JSON from the analyzer), the dead in-App prompt, the Sav-hardcoded builders, one of the two libraries, the monolith structure.

*(Full audit: `scratchpad/current-app-map.md`. Full Higgsfield research: `scratchpad/higgsfield-research.md`.)*

---

## 4. Product requirements (the "what we really want")

### 4a. Separate FORMAT DNA (durable, model-independent) from GENERATION OUTPUT (model-specific, regenerable)
This is the core data-model insight and what makes "apply any format to any model" possible.

**FORMAT DNA — the reusable essentials a library entry MUST store:**
- Format/archetype (e.g. GRWM voiceover, POV walk-and-talk, transformation reveal, text-on-screen monologue)
- Hook — type + mechanism (what stops the thumb in the first ~1s: opening visual + first line/text)
- Beat-by-beat shot list with timestamps — per beat: duration, on-screen action, camera move/angle, framing, subject expression/energy
- Camera language — motion, angles, transitions
- Setting/environment — location type, time of day, lighting
- Wardrobe/styling **as a role**, not identity ("athleisure", "going-out fit")
- Motion / energy / pacing — cut rhythm, speed, beat count
- Audio — music genre/BPM/mood OR voiceover style; trending-sound dependency (y/n)
- Text overlays — cadence, placement, copy style, hook line
- Dialogue/script structure (if any)
- **Why-it-works** — the retention/psychological mechanism (the teaching layer)
- Difficulty / effort to reproduce
- Swap-map — what MUST stay (the format) vs what you swap (identity, product, setting)

**GENERATION OUTPUT — per model profile, per tool (regenerable, not the durable asset):**
- Per-beat NanoBanana / ChatGPT-2 image prompt (first frame / stills)
- Seedream (C-dream) body/edit prompt
- Kling / C-dance 2.0 motion prompt per clip
- Caption + hashtags + on-screen text copy in the model's voice
- QA checklist

**SOURCE META:** url, platform, thumbnail, duration, clip count, original handle (optional).
**Explicitly NOT stored:** raw markdown dumps, duplicated `raw` bodies, mislabeled/empty fields.

### 4b. Model-agnostic via **model profiles**
Identity is a swappable object passed per request: face-sheet id, body-sheet id, wardrobe defaults, location whitelist, voice/caption style, overlay style. Ship profiles for Sav, Naomi, + Khian/Niko AI-OFM. The generator honors the selected profile (fixes the current "Naomi→Sav" bug).

### 4c. Structured output contract
The analyzer returns **typed JSON against a schema** — the client never parses prose again. One shared TypeScript contract mirrored by the worker. This single change kills the mislabeling + fragility class of bugs.

### 4d. Library must be
Single source of truth (retire the duplicate), tagged + searchable (by format/archetype/hook-type/model), versioned, exportable (JSON/markdown), and **authenticated** (no more world-writable endpoint).

### 4e. Ingestion
URL-native (paste TikTok/IG/YT/Reels link) **and** file upload. Fix the dead URL path.

### 4f. Frontend
De-monolith `App.tsx` into components/hooks/api modules against the shared contract.

### 4g. Generation = IDEATION, not clone (locked with Khian 2026-07-21)
The generator does NOT rebuild the OG video shot-for-shot with our model's face swapped in. It produces a NEW treatment — an *ideation* — that:
- **Keeps the ~80% that made it work:** the `whyItWorks` mechanism + everything in `swapMap.mustKeep` are preserved. This is the load-bearing DNA — the reason it stops the scroll.
- **Reinvents the swappable surface:** everything in `swapMap.swappable` (identity, specific setting, outfit color, exact action phrasing) is freely re-imagined for our character.
- **Produces ~3 distinct ideations per blueprint** ("the different ways you could make this video") so the operator picks the strongest. Over time we learn how far the drift can push before the scroll-stopping effect is lost (tune a variation-strength dial later).
- **Success test:** the generated video is original (nothing copy-pasted from the OG) yet stops the scroll via the *same mechanism*. Owner's words: "80% of what worked, made for our own character, nothing copy-pasted."

`archetype` / format-type (skit, GRWM, transformation, talking-head, outfit-showcase, …) is a **primary organizing axis** of the library, not just a tag — it's a first-class data point for finding and reusing formats.

---

## 5. DECISIONS (locked by Khian, 2026-07-21)

**D1 — Analysis engine → BUILD OUR OWN.** Gemini **Pro** tier (not Flash) + our deep prompt → **structured JSON against a schema**. Full control, portable prompts, our IP, transparent/exportable, no per-video competitor credit cost. This is the wedge and it stays ours. Door left open to *optionally* bolt on Higgsfield's Virality Predictor as an enrichment later (see D2) — but the core analysis is ours.

**D2 — Virality scoring → DEFER TO V2.** v1 = deep breakdown → library → portable prompts → own-model generation. Scoring is something Higgsfield already does well and is not our edge; ship the core wedge first. In v2, consider an optional "get viral score" action that passes a clip to Higgsfield's `virality_predictor` (credit-gated, opt-in) rather than building our own scorer.

---

## 6. Fable 5's job (Phase 1)

Given §1–§5: produce (a) an honest audit confirming/extending §3 against the live code, and (b) a **re-architecture plan** — target architecture, the shared JSON schema for FORMAT DNA + GENERATION OUTPUT, the model-profile object, the analysis-engine implementation per D1, library/auth design, and the frontend decomposition. **Plan first — no code until Khian signs off on the plan.**
