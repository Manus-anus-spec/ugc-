# Higgsfield AI — Viral-Video Analysis / Reverse-Engineering Stack: Competitive Research

Higgsfield does not ship this as one product. The capability described is spread across **three interlocking first-party features** (all confirmed live in Higgsfield's own MCP tool schemas):

1. **Video Analysis** (`brain_activity`/`video_analysis` job) — scene-by-scene decomposition of any video.
2. **Virality Predictor** — scores a ≤15s clip and returns a "brain heatmap" (launched **May 9, 2026**).
3. **Ad Reference** — upload a viral/competitor video, auto-recreate its *format* with your own product/avatar.

They are designed as one loop: **analyze → predict → recreate → re-score**.

---

## 1. What the feature actually DOES (input → output workflow)

**A. Video Analysis** (the literal "reverse-engineer / scene-by-scene breakdown")
- **Input:** EITHER a YouTube URL (youtube.com / youtu.be) OR an uploaded video file (via media_upload).
- **Process:** Async job, queued → completed, typically **3–5 minutes**. Returns a populated `scenes` array (scene-by-scene analysis).
- **Explicit limitation baked into the tool:** *"the longer the video, the less accurate the scene-by-scene analysis becomes — short clips give the most reliable results."* (Source: Higgsfield MCP `video_analysis_create` tool contract.)
- **Output:** a structured scene-by-scene breakdown of the source video.

**B. Virality Predictor** (`brain_activity` job)
- **Input:** any clip **≤15 seconds**, vertical or horizontal, from ANY source (phone, CapCut, Premiere, or other AI models — provenance-agnostic). (Sources: pasqualepillitteri.it, quasa.io)
- **Process:** ~1–3 minutes. A "modeled audience" watches the clip while the model maps predicted neural response across vision/audio/emotion. (Source: higgsfield.ai/apps/virality-predictor meta description; pasqualepillitteri.it)
- **Output:** an interactive scoring dashboard (see §2).

**C. Ad Reference** (the "recreate it" half)
- **Input:** upload a high-performing/viral video (your own or a competitor's). Note: on MCP it requires an *uploaded file* — URL ingestion of TikTok/IG/YT is NOT supported; user must download and upload the file. (Source: Higgsfield `show_marketing_studio` tool contract, `type=ad_reference`.)
- **Process:** "The agent reads any video that worked and generates new ones built around the [format]." (Source: Higgsfield IG @higgsfield reels DYFibSKCYxo, DYCpJ0yirDw)
- **Output:** a NEW generated video that reproduces the reference's **concept, scene composition, pacing, and hook** with your own product/brand/avatar swapped in. (Source: higgsfield.ai/blog/make-100-creative-ads)

**The end-to-end loop Higgsfield markets:** generate/choose a creative → score it with Virality Predictor → read score + heatmap → jump to Ad Reference / Marketing Studio → regenerate with a different hook/pacing/hero object → re-score → only then push to paid ads. (Source: pasqualepillitteri.it §"Pair with Ad Reference"; quasa.io "generate → predict → refine")

---

## 2. DEPTH of analysis — every extraction dimension found

This is the section that defines the bar to match. Consolidated from all sources.

**Virality Predictor — scored outputs:**
- **Virality / Viral Potential Score** — aggregate 0–100 (combines hook + hold + neural activation).
- **Hook Score / Hook Strength** — how well the **first second** stops the thumb; works on opening visual signals (motion, contrast, human presence, salient object) AND coherence between the opening frame and the title/caption.
- **Hold Rate / Predicted Retention** — % of audience predicted to stay to the end (the signal platforms weight most for organic distribution).
- **Attention Curve** — a **timeline** showing focus drift / engagement patterns across the clip. (Source: quasa.io, LinkedIn/matthewotor)
- **Brain Heatmap** — predicted neural activation over a simplified anatomical map:
  - **Primary/visual cortex** — visual attention capture.
  - **Amygdala** — emotional response peaks.
  - **Dorsolateral prefrontal cortex** — rational processing / (co-activation with the above = long-term memory encoding = "viewer remembers after closing the app").
  - Warm colors = attention/emotion/episodic memory; cool colors = boredom/disengagement.
  - (Source: pasqualepillitteri.it §2)
- **Cognitive/engagement sub-dimensions** — an Engagement Score broken into ~**five cognitive dimensions** including **"Visual Pull," "Auditory Cortex,"** and others. (Source: LinkedIn/paologavazza — partial list only; Higgsfield has not published the full five publicly.)

**Video Analysis (scene-by-scene) — extracts per scene:** Higgsfield does not publish the exact per-scene field list, but the decomposition covers (from the "cinematic logic layer" and Ad Reference feature descriptions, which run on the same analysis engine):
- **Scene segmentation** (discrete scenes with timing).
- **Narrative arc / narrative structure.**
- **Pacing / shot rhythm / platform pacing (beat timing).**
- **Camera logic / camera motion** (motion constraints, camera-motion "schemas").
- **Visual emphasis / visual priorities / visual anchors.**
- **Scene composition.**
- **Hook** (opening structure).
- **Emotion / affect** ("the subtle interplay between visual rhythm and emotional resonance").
- (Sources: openai.com/index/higgsfield — "infer narrative arc, pacing, camera logic, and visual emphasis"; higgsfield.ai/blog/make-100-creative-ads — Ad Reference recreates "concept, scene composition, pacing, and hook"; higgsfield.ai/blog/How-Higgsfield-Achieved-Realism)

**How they conceptualize "virality" internally** (useful framing to match): virality = a set of **measurable, repeatable patterns**, defined by **engagement-to-reach ratio with particular focus on share velocity** ("when shares outpace likes, content shifts from passive consumption to active distribution"). They distill these into **preset "recipes"** each carrying a **specific narrative structure, pacing style, and camera logic** — ~**10 new presets created per day**, old ones cycled out as engagement wanes. (Source: openai.com/index/higgsfield)

**Adjacent analysis tools in the same family (context):**
- **"Breakdown" / AI Lens** — image analyzer: scans a photo to identify objects, brands, prices, components. (higgsfield.ai/apps/breakdown)
- **"What's Next?"** — generates 8 narrative possibilities from one scene.
- **Personal Clipper** — turns long YouTube videos into short clips (up to 20).

---

## 3. What it OUTPUTS to the user

- **Virality Predictor:** an **interactive dashboard/report** — the numeric scores + attention-curve timeline + rendered brain heatmap. Via CLI (`higgsfield run brain_activity --input clip.mp4 --report report.json`) it returns a **JSON** with the four scores plus a link to the full visual report. (Source: pasqualepillitteri.it §5)
- **Video Analysis:** a structured **scene-by-scene breakdown** (the `scenes` object) — a report/data structure, not a video.
- **Ad Reference:** a **ready-to-generate / fully generated NEW video** — it does generate a new video **in your own style/with your own character**: you attach a **product, webproduct, or avatar** (custom avatars you create, or preset avatars) and it renders the reference's format around them. You can also **edit the extracted concept** (as text or structured JSON — `edited_concept_text` / `edited_concept_json`) before regenerating. (Source: Higgsfield `show_marketing_studio` tool contract)
- **Generation engine:** the recreated video is rendered on **Higgsfield's own hosted models** — **Sora 2** (Marketing Studio / Sora 2 Trends / Click-to-Ad), **Seedance 2.0** (up to 9 reference inputs — product images + spokesperson face + voiceover + camera-style ref in one call), plus their hosted Kling/Veo. Native audio + lip sync in the same pass. (Sources: openai.com/index/higgsfield; higgsfield.ai/blog/make-100-creative-ads)

---

## 4. LIMITATIONS / what it does NOT do  (← where we differentiate)

Blunt findings:

- **No raw copy-paste prompts. This is the single biggest gap.** Higgsfield deliberately **hides the prompt layer**: *"Rather than exposing users to raw prompts, Higgsfield internalizes cinematic decision-making into the system itself."* (openai.com/index/higgsfield). The analysis is converted straight into an internal video plan — the user never receives a portable prompt they can paste into NanoBanana, Seedream, Kling, etc. outside Higgsfield.
- **Locked to Higgsfield's own generation.** The recreate step only outputs to Higgsfield-hosted models (Sora 2 / Seedance 2.0 / their Kling-Veo aggregation). You cannot take a "format recipe" and run it on your own external tool stack or your own API keys.
- **No user-built, persistent, reusable FORMAT library.**
  - `video_analysis_jobs` lists your past analyses (basic history), but there is **no curated, taggable database of reusable "viral formats"** you author and re-apply.
  - The **preset library is Higgsfield-authored** (CMS presets, ~10/day, auto-cycled out) — you consume theirs; you don't build your own persistent catalog of dissected formats.
  - **Shorts Studio presets you CAN create store STYLE ONLY** (visual look from reference media) — explicitly *"This just stores a STYLE"* — **not** hook/pacing/narrative-structure/beat logic. So even the user-created presets don't capture the deep format DNA. (Source: Higgsfield `shorts_studio_create_preset` tool contract)
- **No "apply this format to MY custom character across multiple gen tools."** You can attach an avatar inside Marketing Studio, but format application is bound to Higgsfield's presets + Higgsfield's renderers. There is no cross-tool orchestration (e.g. face on NanoBanana → body on Seedream → motion on Kling) driven by a saved format.
- **Virality Predictor hard-capped at 15 seconds.** Longer clips must be trimmed/split, breaking narrative coherence. (pasqualepillitteri.it FAQ)
- **Video Analysis accuracy degrades with length** — reliable only on short clips (own tool warning).
- **Ad Reference URL ingestion not supported on MCP** — user must manually download the source video and upload the file.
- **Black box / no reproducibility.** No published training dataset or accuracy metrics; heatmap is a statistical prediction, not real fMRI. Users report **non-determinism** ("same prompt gives different results day to day") and downtime. (reddit r/generativeAI 1sp4ivr; r/MotionDesign)
- **Not a database export.** No documented way to export the structured analysis as a reusable library across projects/teams, or to diff/version formats over time.
- **Trust/reputation baggage:** multiple "scam?" threads over "unlimited" plan claims and billing (reddit r/generativeAI 1rvaj50, 1sp4ivr), plus NSFW/likeness-abuse complaints (r/HiggsfieldAI 1qdj607).

---

## 5. Pricing / plans / credit model

Pulled live from Higgsfield's billing API (`show_plans_and_credits`, as of 2026-07-21):

- **Unified credit system** across ALL models/tools — Virality Predictor, Video Analysis, Cinema Studio, Soul, Kling, etc. all draw from the same credit pool. Video Analysis / Ad Reference generation **cost credits**; Virality Predictor was launched **free in beta preview (no credits consumed)** but is documented as credit-billed going forward. (Sources: pasqualepillitteri.it FAQ #1; quasa.io)
- **Free plan:** exists (our test account = free, 0.49 credits — could not run a paid analysis).
- **Plus:** **$49/mo** (or $39/mo billed annually, 20% off) → **1,000 credits/mo** (~4,800 images or ~200 videos).
- **Ultra (most popular):** **$129/mo** (or $99/mo annual, 23% off) → **3,000 credits/mo** (~12,000 images / ~500 videos); "70% cheaper per credit"; more concurrency (8 videos/8 images), Nano Banana Pro 7-day unlimited.
- **3-Day Free Plus Trial (MCP-only):** $0 for 3 days, 100 credits, card required, auto-renews to Plus $49/mo unless cancelled. Trial credits work ONLY via MCP, not on higgsfield.ai.
- **Top-up packs:** 500 / 1,000 / 2,000 / 4,000 credits, one-time (expire in 90 days); ~20 credits per $1.
- Company context: founded 2023 by Alex Mashrabov (ex-Snap GenAI); **$1.3B valuation** (Jan 2026), **~$300M ARR** (Feb 2026); generates ~4M videos/day. (Sources: pasqualepillitteri.it §4; openai.com/index/higgsfield)

---

## 6. User reactions, tutorials, launch posts

- **Launch:** X/@higgsfield, May 9 2026 — *"Upload any clip up to 15s > Get viral potential, hook score & hold rate > See a heatmap of brain regions your clip activates > Pair with Ad Reference for recreated videos. Available via MCP/CLI and on the platform."* (4.7K likes, 347 replies). (x.com/higgsfield/status/2053139109074657482)
- **Ad Reference launch:** IG @higgsfield — *"Feed it your own top-performing videos and it recreates the format automatically, on the platform and via MCP."* (IG reels DYCpJ0yirDw, DYFibSKCYxo)
- **Deep-dive articles:** pasqualepillitteri.it (most thorough — 12-min technical guide, the best single source); quasa.io (metric list + beta-free note).
- **Reddit:** r/HiggsfieldAI AMA "Head of Prompt Engineering at Higgsfield here" (1qkcwj2) — users asking for a **node-based system** chaining apps/features (signal: even power users want composability Higgsfield doesn't offer). Honest reviews in r/MotionDesign (1tla02e, 1qvtesv) and r/generativeAI (1rvaj50, 1sp4ivr) note heavy prompt-iteration needed, non-determinism, downtime, billing disputes.
- **YouTube:** many tutorials on the ecosystem (e.g. "I Tried Higgsfield AI... FULL REVIEW" 2ohWcpFT7BM; "How To Create $100k AI Ads with Higgsfield" itv4Xljkbqw) — interface described as "walking through Times Square" (feature overload). A widely shared community method (reddit r/PartneredYoutube 1ms5bmb) shows creators still **manually reverse-engineer viral AI videos with ChatGPT + JSON prompting** — because no tool hands them portable prompts. That is exactly the unmet need.

---

## GAPS WE CAN EXPLOIT

1. **Give users the raw, copy-paste prompts.** Higgsfield deliberately hides them and locks output to Sora 2/Seedance. A tool that outputs portable, per-scene prompts for NanoBanana / Seedream / Kling (external, bring-your-own-tool) directly attacks their #1 limitation.
2. **A persistent, user-owned FORMAT LIBRARY.** Let users build, tag, version, and reuse a database of dissected viral formats (hook + beats + camera + pacing + audio + text overlays). Higgsfield only offers disposable, house-authored presets and style-only user presets.
3. **Full-format capture, not style-only.** Their user presets store visual style ONLY. Capture the *structural* DNA (hook type, beat timing, shot list, motion, text-overlay cadence, why-it-works).
4. **"Apply format to MY character across MY tools."** Bind a saved format to a custom model/character and orchestrate a multi-tool pipeline (face→body→motion). Higgsfield can't cross tools or persist a format-to-character binding.
5. **No 15s cap / long-form depth.** Handle full-length Reels/TikToks with reliable scene segmentation; VP is capped at 15s and their scene analysis degrades with length.
6. **URL-native ingestion.** Paste a TikTok/IG/YT link directly — Higgsfield's Ad Reference forces a manual file download/upload on MCP.
7. **Transparent, exportable analysis.** Structured, exportable report (JSON/markdown) with an explicit "why it works" rationale and shot list — vs. their black-box dashboard with no dataset/accuracy disclosure.
8. **Own-your-data / offline.** Their whole stack is credit-gated and cloud-locked with billing-trust complaints; a transparent, exportable, tool-agnostic product is a clean wedge.

---

*Note: A live Video Analysis run to capture the literal per-scene JSON field names was blocked — the paid action was denied on the free account (0.49 credits). The scene dimensions in §2 are compiled from Higgsfield's own tool contracts, blog, and the OpenAI case study rather than a raw job payload.*

## Source URLs
- https://higgsfield.ai/apps/virality-predictor
- https://higgsfield.ai/apps/breakdown
- https://higgsfield.ai/blog/make-100-creative-ads
- https://higgsfield.ai/blog/How-Higgsfield-Achieved-Realism-in-AI-Video-and-Photo
- https://higgsfield.ai/blog/how-to-use-higgsfield
- https://openai.com/index/higgsfield/
- https://pasqualepillitteri.it/en/news/2273/higgsfield-virality-predictor-hook-score-hold-rate-2026
- https://quasa.io/media/higgsfield-launches-virality-predictor-an-ai-tool-that-predicts-if-your-video-will-go-viral-before-you-post-it
- https://x.com/higgsfield/status/2053139109074657482
- https://www.instagram.com/reel/DYCpJ0yirDw/ (Ad Reference launch)
- https://www.instagram.com/reel/DYFibSKCYxo/ (Ad Reference via MCP)
- https://www.instagram.com/reel/DYH7aSlihvA/ (Virality Predictor intro)
- https://www.linkedin.com/posts/matthewotor_how-to-use-higgsfield-virality-predictor-activity-7462049558852866048-0N3A
- https://www.linkedin.com/posts/paologavazza_higgsfield-ai-ais-virality-predictor-doesn-activity-7458968375541583872-W6-p
- https://www.reddit.com/r/HiggsfieldAI/comments/1qkcwj2/ (Head of Prompt Engineering AMA)
- https://www.reddit.com/r/PartneredYoutube/comments/1ms5bmb/ (manual reverse-engineer method)
- https://www.reddit.com/r/generativeAI/comments/1sp4ivr/ (review — non-determinism)
- https://www.reddit.com/r/generativeAI/comments/1rvaj50/ (billing complaints)
- https://www.reddit.com/r/MotionDesign/comments/1tla02e/ (motion design review)
- https://www.youtube.com/watch?v=2ohWcpFT7BM (full review)
- https://www.youtube.com/watch?v=itv4Xljkbqw ($100k AI ads tutorial)
- Higgsfield MCP tool contracts: `video_analysis_create`, `video_analysis_status`, `virality_predictor`, `shorts_studio_create_preset`, `show_marketing_studio`, `show_plans_and_credits`
