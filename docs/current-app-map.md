# UGC Reverse-Engineer — Architecture Map + Shortfall Analysis

## 1. Architecture map

Three deployed pieces plus a browser app. Nothing is co-located; they're glued together by hard-coded URLs in the frontend (`App.tsx:31-33`).

**Frontend** — `/Users/mac/Desktop/ugc-/src/App.tsx` (1646 lines, single component), Vite/React, `main.tsx` mounts `<App/>`. Hosted on **GitHub Pages** (git remote `github.com/Manus-anus-spec/ugc-.git`; the proxy's CORS allowlist is `manus-anus-spec.github.io`, `worker-v4.2.0.js:334-338`), **not** Cloudflare Pages. Three backends it talks to:
- `PROXY_URL` = `ugc-worker.khian-moclou.workers.dev` (analysis)
- `LIBRARY_URL` = `sav-viral-scanner.khian-moclou.workers.dev` (primary library + "Make for Sav" generation)
- `CONTENT_LIBRARY_URL` = `sav-content-library.khian-moclou.workers.dev` (secondary "full-brief" library)

**Analyze proxy worker** — `/Users/mac/Desktop/worker-v4.2.0.js` (the "ugc-worker"). Cloudflare Worker. `POST /analyze` resolves the video source (uploaded file, or YouTube/TikTok/Instagram/Pinterest URL via tikwm/RapidAPI/scrape helpers, `worker-v4.2.0.js:244-328`), uploads it to the **Gemini File API** (`uploadToGemini` 502-531, polls `pollUntilActive`), then calls **gemini-2.5-flash** streaming with a giant `SYSTEM_INSTRUCTION` (lines 1-238). Returns one JSON blob `{result, finishReason, validation, fileUri, mimeType}`. Has completeness validation + auto-retry loops for missing NB/Seedream/Kling sections (742-781) and a `POST /retry` endpoint.

**Content-library worker** — `/Users/mac/Desktop/Desktop/Aruna Talent - files/Sav Brain/workers/sav-content-library/worker.js`. Cloudflare Worker + **KV namespace `LIBRARY`**. Stores full briefs (`POST /add`), serves `GET /list`, `/entry/:id`, `/brief/:id`, `/prompts`, `/stats`, `DELETE /entry/:id`. This is what "both operators' Claudes read each session" (its header comment).

**Viral-scanner worker** — `/Users/mac/Desktop/Desktop/Aruna Talent - files/Sav Brain/workers/sav-viral-scanner/sav-viral-scanner.js` (2129 lines). Cloudflare Worker + **KV `FORMAT_LIBRARY`** and **KV `PENDING_VIDEOS`**. Multi-purpose: (a) the app's primary library CRUD at `/library` (1248-1278); (b) `POST /generate-sav-idea` — the "Make for Sav" generation backend (1988+); (c) an entirely separate cron-driven TikTok/IG scraper → Telegram approve → real Higgsfield image/video generation pipeline (68-125, 400-851); (d) a served HTML library UI at `/ui`; (e) a hardcoded June Telegram auto-poster (1130-1232).

**Data flow (the app's happy path):**
```
video/URL → ugc-worker /analyze → Gemini Flash → markdown breakdown
  → App.tsx auto-save: regex-parse markdown → LibraryItem
     → sav-viral-scanner /library (KV FORMAT_LIBRARY)   [primary copy]
     → sav-content-library /add   (KV LIBRARY)          [second copy, remapped]
  → user clicks "Make for [model]"
     → sav-viral-scanner /generate-sav-idea → Gemini Flash (JSON) → SavPrompts
     → saved back to both libraries
```
Note two parallel libraries in two KV stores holding overlapping data.

## 2. The analysis / extraction

The **actually deployed** prompt is `SYSTEM_INSTRUCTION` in `worker-v4.2.0.js:1-238`. (App.tsx also contains its own `SYSTEM_INSTRUCTION` at lines 532-652 — this is **dead code**, never sent anywhere; the worker uses its own.)

The deployed prompt is, in fairness, extremely deep on paper — 18 sections (§0 Camera Setup, §1 Format, §2 Ad-Type, §3 NSFW flag, §4 Camera, §5 Environment, §6 Character, §7 Action, §8 Energy, §9 Script, §10 Audio, §11 Text, §12 Hook, §13 Ready-to-use prompts, §14 B-roll, §15 CapCut, §16 Difficulty, §17 Narrative, §18 Viral score). §0 forces a filming-setup determination first (`worker-v4.2.0.js:5-39`) and §13 demands a JSON-first internal frame breakdown, 4-frame extraction (Thumbnail/Opening/Middle/Closing), and per-frame NB + Seedream + Kling prompts (lines 87-217). Key instruction to note:

> "CHARACTER APPEARANCE RULE (HIGHEST PRIORITY…): NEVER describe the person's physical appearance in ANY prompt… The reference image IS the character." (`worker-v4.2.0.js:91`)

**How deep does it actually go?** The prompt is deep; the execution is shallow, for three reasons:
- It runs on **gemini-2.5-flash** at `temperature 0.2` (`worker-v4.2.0.js:366-370`), not Pro. Flash reliably misses fine visual detail — the exact reason the owner feels it "misses essentials."
- Output is **freeform markdown**, not structured JSON. All downstream value depends on regex scraping (see §5).
- The 18-section, multi-frame demand routinely overruns, hence the elaborate `validateAnalysis` + three sequential auto-retries (`worker-v4.2.0.js:437-472, 742-781`). Partial outputs are normal.

## 3. The library data model

Two shapes, because there are two libraries.

**Primary (`FORMAT_LIBRARY` via sav-viral-scanner)** stores the raw `LibraryItem` the frontend builds (`App.tsx:36-52`): `id, savedAt, sourceUrl, formatType, hookText, fullAnalysis, nbPrompt, klingPrompt, savPrompts?, thumbnail?, isOneShot?, duration?, clipCount?, sdPrompt?, sdFrameType?`. Save is a dumb passthrough — `handleLibrarySave` just `put`s whatever JSON arrives and prepends the id to an `index` key (`sav-viral-scanner.js:1261-1269`). `GET /library` returns the array of full items (1248-1258).

**Secondary (`LIBRARY` via sav-content-library)** — `buildEntry` (`worker.js:36-98`) constructs a much wider record: prompts (`nb_prompt, sd_prompt, sd_frame_type, kling_prompt, kling_prompts[], additional_clip_prompts[], seedance_prompt, video_prompt`), video meta (`video_model, video_format, video_duration, clip_count, is_one_shot`), structured breakdown (`camera, environment, outfit, expression, lighting, action_breakdown, production_brief[], audio_plan, text_overlays[], editing_notes`), virality (`hook_analysis, why_it_works, formula_extracted, creative_brief`), `caption_options[]`, `full_analysis` (whole markdown), plus `raw` (the entire incoming body, duplicated).

- `GET /list` → `{count, index}` (id/name/category/model/added stubs); `?full=true` → full entries; `?model=sav` filters (`worker.js:120-136`).
- `GET /prompts` → `{count, briefs}` — the "complete brief for every entry" Claude loads each session, echoing nearly every field including `full_analysis` (`worker.js:147-198`).

The design intent ("nothing dropped, full_analysis is ultimate source of truth") is sound. The problem is what actually populates the structured fields — see §5(b).

## 4. The generation step

"Make for [model]" → `apiGenerateSavIdea` (`App.tsx:179`) → `sav-viral-scanner /generate-sav-idea` (`handleGenerateSavIdea`, `sav-viral-scanner.js:1988`).

It flattens the library item into a text block (2001-2035), runs a **sanitizer** that rewrites ~25 NSFW words to euphemisms to dodge Gemini's input filter (`bikini→swimwear`, `lingerie→fitted intimate wear`, etc., 2046-2074), then calls **gemini-2.5-flash** with `responseMimeType: "application/json"`, `temperature 0.7`, all four safety categories `BLOCK_NONE` (2089-2098), driven by `SAV_IDEA_SYSTEM_PROMPT` (1849-1986).

Output JSON (rendered in `App.tsx:1398-1609`) covers a full production plan: `formulaExtracted, whyItWorks, creativeBrief, faceForwardNote, videoModel (kling_3.0|cdance), videoModelReason, videoFormat, videoDuration, clipCount, productionBrief[] (per-clip timestamp/action/camera/expression/dialogue/nbPromptForClip), audioPlan, editingNotes, nbPrompt, sdPrompt, sdFrameType, videoPrompt, additionalClipPrompts[], textOverlays[3], caption, hashtags[5], qaChecklist`.

**Tools targeted:** NanoBanana Pro (still image, 12-step prompt structure, 1892-1906), Seedream 4.5 / "SD" (mandatory body-enhancement delta, 1908-1915), and a video model chosen between **Kling 3.0** and **"CDance" (Seedance 2.0)** with an explicit selection rubric (1858-1879). A hard "face-forward" rule reverses any sequence that opens on the subject's back (1886-1890).

Separately, the viral-scanner's Telegram approve path (`handleInstagramApprove` / `handleLegacyApprove`, 400-668) actually *submits* jobs to Higgsfield (`nano_banana_pro`, `kling_3.0`) and returns real media — but the app never uses this; it only emits prompt text.

## 5. SHORTFALLS

### (a) Analysis "misses the essentials to a tee"
- **Wrong model tier.** Analysis runs on gemini-2.5-flash (`worker-v4.2.0.js:366`). The prompt asks for frame-level fabric/lighting/geometry precision that Flash cannot reliably perceive. This is the single biggest cause of shallow output.
- **Freeform markdown, not structured output.** Unlike the generation step, `/analyze` does not set `responseMimeType: json` and has no schema. Everything depends on the model formatting section headers exactly right, which it often doesn't — triggering the retry cascade (`worker-v4.2.0.js:742-781`) that *appends* patched sections ("## PROMPTS (Auto-Generated)", 749) instead of producing one clean document.
- **URL analysis is silently broken — field-name mismatch.** Frontend sends the URL as form field `url` (`App.tsx:847`), but the worker reads `formData.get('videoUrl')` (`worker-v4.2.0.js:626`). So for any pasted URL the worker sees no video and returns "No video file or URL provided." The entire "Paste URL" mode (YouTube/TikTok/IG/Pinterest resolvers) is dead on arrival.
- **"Reference Frames" are decorative.** `extractRefFrames` (`App.tsx:714-758`) pulls start/middle/end frames but they are only offered as downloads (1134-1154) and never sent to Gemini — they don't improve analysis.

### (b) Library "saves junk instead of the essentials to rebuild the video"
This is the most concrete defect. The structured fields pushed to the content library are parsed with the **wrong section numbers**. `apiPushToContentLibrary` (`App.tsx:155-164`) calls `extractSection(analysis, N)`, but `extractSection` (245-249) keys on `## N.` headings that match the *dead* App.tsx prompt schema, **not** the deployed worker's 18-section schema. Concretely, against the real worker output:

| Field stored | Code | Pulls worker section | Actual content stored |
|---|---|---|---|
| `camera` | `extractSection(analysis, 2)` | §2 | **Ad-Type Classification** (not camera) |
| `environment` | `extractSection(analysis, 3)` | §3 | **Content/NSFW Flag** (not environment) |
| `outfit` | `extractSection(analysis, 4)` | §4 | **Camera & Framing** (not outfit) |
| `action_breakdown` | `extractSection(analysis, 5)` | §5 | **Environment** (not action) |
| `audio_plan` | `extractSection(analysis, 8)` | §8 | **Energy & Pacing** (not audio) |
| `hook_analysis` | `extractSection(analysis, 10)` | §10 | **Audio Analysis** (not hook) |

Every labeled structured field in the shared library is mislabeled/misfiled. Camera is §4 in the real worker, environment §5, outfit §6, action §7, audio §10, hook §12.

- **Kling array is polluted with image prompts.** `extractAllKlingPrompts` (`App.tsx:285-296`) treats every fenced code block that isn't labeled ```` ```nano-banana ```` as a Kling motion prompt. The deployed worker labels frame prompts `Frame 0A NB` etc. (not with a `nano-banana` fence), so the 4-8 NanoBanana image prompts get stored as `kling_prompts[]`. The video-prompt array is garbage.
- **`extractNBPrompt` grabs the wrong thing.** It first looks for a ```` ```nano-banana ```` fence (253) that the worker doesn't emit, then falls back to "first code block in §13/§7" — which is Frame 0's prompt at best, or nothing.
- **Two libraries, duplicated data.** Same item is written to both `FORMAT_LIBRARY` and `LIBRARY`, and `sav-content-library` additionally stores the entire incoming body again under `raw` (`worker.js:96`). Storage and drift for no benefit.
- **Net effect:** the one field that's actually reliable is `full_analysis` (the raw markdown dump). Everything the library markets as "structured essentials" is either mislabeled, empty, or cross-contaminated — which is exactly the "saves junk" complaint.

### (c) Hard-coded to Sav / Naomi identity (should be model-agnostic)
- **The generation backend ignores the model selector entirely.** The frontend passes `model` ('Sav'|'Naomi') into `apiGenerateSavIdea` (`App.tsx:179-183, 961`), but `handleGenerateSavIdea` never reads it (`sav-viral-scanner.js:1988-2035`). `SAV_IDEA_SYSTEM_PROMPT` is 100% Sav: "a fashion/lifestyle Instagram creator called Sav," "flight attendant," fixed location whitelist, United-uniform makeup rules (1849-1906). Selecting "Naomi" produces Sav content.
- **Frontend content is Sav-hardcoded.** `FORMAT_OVERLAYS`/`FORMAT_CAPTIONS` are flight-attendant/"layover"/"30,000 feet"/🌙 lines (`App.tsx:357-415`); `SAV_NB_RULES` (417); `buildSavNBPrompt` strips Sav-specific tokens like "half-brazilian"/"platinum blonde" (429-434) and injects Sav's makeup block (451).
- **Worker identity constants are Sav-only:** `SAV_BASE_PROMPT` with the United uniform (`sav-viral-scanner.js:44-46`), `SAV_FACE_SHEET_ID`/`SAV_BODY_SHEET_ID` (41-42), the Gemini reel prompt hardcodes "a 21-year-old platinum blonde United Airlines flight attendant" (491, 501). Only `sav-content-library` is genuinely model-aware (it stores/filters by `model`), but it's fed by a Sav-only generator, so the field is cosmetic.

### (d) Frontend is a 1646-line monolith
`App.tsx` holds: all type defs (36-95), three API client sets (98-242), 8 regex parser/heuristic functions (245-354), Sav prompt builders + constants (357-529), the dead `SYSTEM_INSTRUCTION` (532-652), then one `App()` component (655-1646) with ~20 `useState` hooks, two `<video>`-canvas frame extractors, and ~650 lines of inline JSX for both tabs. No component decomposition, no hooks extraction, no shared config, no routing. The identity/prompt logic that belongs on the server lives here in the client.

### Other real problems
- **No auth on any endpoint; CORS `*`.** `sav-content-library` and the `/library` CRUD are world-readable/writable/deletable (`worker.js:24-28`; `sav-viral-scanner.js` library handlers). Anyone with the URL can wipe or poison the shared library.
- **Silent, non-blocking failures hide data loss.** `apiPushToContentLibrary` swallows all errors (`App.tsx:174-176`), and auto-save only `console.warn`s (894-896). The content library can silently never receive an item and the UI shows "Saved!".
- **Client-side format detection is brittle keyword-matching.** `detectFormatType` (`App.tsx:337-353`) infers category from substring hits ("gray beard", "layover"), and `extractVideoMeta`/`extractHookText` rely on exact bold-label regex (326-335, 298-324) that break the moment Flash rephrases a heading.
- **Prompt-schema drift is the root systemic bug.** Frontend parsers were written against App.tsx's embedded prompt; the deployed worker uses a differently-numbered 18-section prompt. There is no shared contract, so the two will keep diverging.
- **`sav-viral-scanner.js` is a 2129-line grab-bag** mixing the app's library API, the generation endpoint, a Telegram scraper/approver, a Higgsfield pipeline, an embedded HTML UI, and a hardcoded dated auto-post schedule (`1130-1148`). Overloaded and hard to reason about.
- **Robustness debt:** JSON parsing of Gemini output relies on try/catch + ```` ```json ```` fence regex fallback in three places (`sav-viral-scanner.js:2118-2126`, `551-556`; fine but fragile); Higgsfield polling guesses at 5+ possible response shapes for the output URL (`sav-viral-scanner.js:824-829, 608`).

## 6. What to keep vs throw out

**Keep / port forward:**
- The **deployed analysis prompt's structure** (`worker-v4.2.0.js`) — §0 camera-setup-first, the character-appearance-lock rule, 4-frame extraction, and the NB→Seedream→video split are genuinely good IP. Reuse the *content*, but emit it as **structured JSON with a schema**, not markdown.
- The **generation rubric** in `SAV_IDEA_SYSTEM_PROMPT` — Kling-vs-CDance selection, face-forward rule, mandatory SD pass, production-brief shape, QA checklist. Keep the logic, parameterize the identity.
- The **`sav-content-library` brief data model** (`worker.js` field set) — it's the right target shape. Keep it; fix what fills it.
- The **URL resolvers** (tikwm/RapidAPI/Pinterest scrape) and the **Gemini File API upload/poll** helpers in `worker-v4.2.0.js` — solid, reusable.
- Video-source ingestion UX and per-prompt copy buttons.

**Throw out / rebuild:**
- **All client-side regex parsing** (`extractSection`, `extractNBPrompt`, `extractKlingPrompt`, `extractAllKlingPrompts`, `extractHookText`, `extractVideoMeta`, `detectFormatType`, `App.tsx:245-354`). Replace by having the analysis worker return typed JSON so the client never parses prose. This kills shortfalls (a)-partial and (b) at once.
- **The dead `SYSTEM_INSTRUCTION` in App.tsx** (532-652) and the Sav-specific builders/constants (357-529) — move identity to a per-model config consumed server-side.
- **One of the two libraries.** Consolidate on `sav-content-library`; retire the `FORMAT_LIBRARY` path.
- **The Sav-hardcoded generation prompt** — replace with a model-agnostic template + a model profile object (face-sheet id, wardrobe, locations, voice, overlays) passed in per request, honoring the `model` param that's already plumbed through the UI.
- **The 1646-line `App.tsx` monolith** — split into components/hooks/api modules with a shared TypeScript contract mirroring the worker's JSON schema.
- **The field-name mismatch and unauthenticated public endpoints** must be fixed regardless of rebuild scope.

Also fix immediately in the current app if not rebuilding: `formData.append('url', …)` → `'videoUrl'` (`App.tsx:847`) to un-break URL analysis, and correct the six section numbers in `apiPushToContentLibrary` (`App.tsx:155-164`).
