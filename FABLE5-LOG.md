# FABLE5 Build Log

## Phase 1 — Contract + worker skeleton + D1 · 2026-07-21 ✅ code-complete
- `shared/` contract live: zod-v4 schemas (source of truth) → inferred TS types; FormatDNA, ModelProfile, GenerationRun (ideations[] per §4g amendment), platform detect, multipart field constants.
- `worker/` ugc-api scaffolded: router, X-API-Key auth (sha256, per-operator revocable), CORS allowlist, typed ApiError on every failure path, formats/profiles/jobs routes with versioning + tag filters.
- D1 migration `0001_init.sql`: formats, format_versions, format_tags, profiles, generations, jobs — tenant_id everywhere, no FTS (Phase 5).
- KV→D1 tooling written AND proven offline: fake snapshot → generated SQL → executed against the real schema in sqlite3 → correct rows/tags/escaping.
- Typecheck clean (worker + shared, tsc strict). 🔑 waiting on: d1 create, secrets, deploy, KV snapshot (runbook: `worker/README.md`).

## Phase 2 — Analysis engine · 2026-07-21 ✅ code-complete (gate pending)
- `/analyze` live in code: multipart videoUrl/file → resolvers (TikTok/IG/Pinterest ported, +thumbnails, typed errors; YouTube passthrough) → Gemini File API (key in header now, not query) → Pro-tier JSON-mode call.
- Analyzer prompt rebuilt: all the old §0 camera-first/verification/4-frame/NSFW IP retargeted at filling the AnalyzerOutput schema; zero tool prompts in analysis; identity firewalled into characterObservation.
- Structured output: responseJsonSchema on gemini-3*, prompt-embedded schema on older; zod validation + ONE error-guided repair ask replaces the old retry circus; model fallback on 404.
- Server-side D1 save before responding — client timeout can no longer orphan a paid analysis (N5 dead). Gemini file cleanup via ctx.waitUntil.
- Schema derivation + fixture validation + platform detect all pass offline (`scripts/schema-smoke.ts`). 🔑 GATE: deploy + live model-id check + 3 golden-video test before Phase 3.

## Deploy · 2026-07-21 ✅ LIVE
- `https://ugc-api.khian-moclou.workers.dev` — D1 `ugc_library` (66250432, APAC), migration applied (16 stmts).
- Secrets set: API_TOKENS (khian+niko hashes), GEMINI_API_KEY (new "ugc-api worker" key). RAPIDAPI_KEY deferred — IG via file-upload until Khian adds it.
- Model pinned from live ListModels: **gemini-3.1-pro-preview** (generateContent, 1M in / 65,536 out), fallback gemini-2.5-pro.
- Smoke tests: health 200 · no/wrong key → 401 typed · formats/profiles list 200 · unknown route → 404 typed. Two transient CF 1042s on first hit, clean on retry.
- NEXT: /analyze golden test on a real IG reel (file upload) — awaiting file path from Khian.

## Golden test #1 · 2026-07-21 ✅ PIPELINE PROVEN (Pro quota pending)
- FOUND+FIXED in the process: non-streaming generateContent gets killed by CF's ~100s silent-subrequest limit (524) — switched to streamGenerateContent SSE, accumulated server-side. Load-bearing for every long Pro analysis.
- BLOCKER surfaced: the new Gemini key's project (859046318616) is FREE TIER — limit 0 on ALL Pro models (plan risk Q1). 🔑 Khian: enable billing on that project, then `cd worker && npx wrangler deploy` restores the gemini-3.1-pro-preview pin.
- Temporary: deployed with --var GEMINI_MODEL:gemini-2.5-flash (wrangler.toml pin untouched). Full pipeline validated: 13s reel → upload → SSE → schema-valid FormatDNA → D1 row → /formats lists it. 50s wall-clock, HTTP 200.
- Quality even on Flash: correct third_person camera, 7 timestamped beats w/ both hands + dialogue, 4 frames w/ crop boundaries, sharp swapMap (mustKeep=structure, swappable=surface), identity quarantined in characterObservation. Result archived: docs/golden-test-1-formatdna.json.
- Re-run the golden test on Pro after billing before judging depth (the real gate) — Flash run stays as the A/B baseline.

## Pro vs Flash A/B · 2026-07-22 ✅ GATE PASSED (Pro pinned)
- Billing live (prepay credits). Pro run: 53s, HTTP 200, schema-valid via responseJsonSchema path. Archived: docs/golden-test-1-pro-formatdna.json (Flash baseline: golden-test-1-formatdna.json).
- Pro decisively better on every JUDGMENT field: whyItWorks = "subversion of expectations (romantic text vs feral visual)" vs Flash's generic "humor"; swapMap caught the off-camera reaction AUDIO as load-bearing (Flash missed it); beat actions match actual pixels ("tears meat off with her teeth" vs "picks up a wing"); dialogue verbatim incl. profanity; lighting signature "direct flash on subject, dim background" (generation-critical, Flash said generic "warm overhead").
- Flash wordier in places: 7 beats vs Pro's 4 (granularity judgment call), fuller environment prop list. Pro terser but all load-bearing. One rubric slip: Pro rated "borderline" where the aggressive-NSFW rule says cleavage→nsfw.
- Tuning noted for Phase-2 polish (non-blocking): nudge beat granularity + keep aggressive contentFlag rubric literal.
- Golden tests 2+3 (selfie one-shot, mirror-selfie borderline) still recommended — can run alongside Phase 3 whenever Khian drops files. NEXT: Phase 3 frontend + redesign.

## Batch stress-test · 2026-07-22 ✅ 5/5 on Pro, first attempt
- 5 reels analyzed on gemini-3.1-pro-preview, 57–76s each, zero retries, zero validation failures. All rows verified in D1 (library total: 7). DNA archived in docs/goldens/.
- Camera classifier: 3× third_person, 1× propped_on_surface (textbook evidence: front cam, static, low table angle), 1× self_held_selfie (hiddenArm=right + ~40cm + micro_shake — full evidence chain). No mirror_selfie detected in batch — Khian to confirm none was present; still an untested setup class.
- Phase-2 polish notes: archetype is drifting free-form (bait_and_switch, pov_skit, situational_reveal) — nudge prompt toward canonical list for filterable taxonomy; beat granularity + literal NSFW rubric from A/B still open.
- Design direction proposal written: docs/design-direction.md — graphite + volt "edit suite" theme, 3-ideation money screen. AWAITING KHIAN SIGN-OFF before UI build.

## Phase 3 — Frontend rebuild + redesign · 2026-07-22 ✅ BUILT & VERIFIED LIVE
- Palette swapped per Khian's approval image: Classic Black / Golden Pitch / Power Orange / Off-White (docs/design-direction.md updated). Rating badges re-tuned so nsfw-crimson never collides with the orange accent.
- Monolith dead: App.tsx 1,646 → 30 lines. New: config, typed api client (+ApiRequestError), 4 hooks, 10 components (TokenGate, Rail, SourcePicker, AnalyzeView, DnaReport, LibraryView + detail, ui primitives). Zero regex, zero identity, zero prompt-building in the client — everything typed off @shared.
- package.json cleaned: name fixed, express/better-sqlite3/dotenv/@google/genai/motion/autoprefixer dropped (−205 packages). tsconfig strict + @shared alias. Old dead code gone with the monolith overwrite.
- Typecheck clean · vite build clean (388KB) · verified in Chrome against the LIVE API: token gate validates via real call, library lists all 7 D1 formats (chips/badges/tags), Feral-Hinge detail renders full DnaReport (WhyItWorks card, KEEP/SWAP map, beats rail, camera block, frame specs w/ nsfw obs), legacy-markdown path in place.
- 🔑 remaining for Phase 3 close: GitHub Pages deploy (Khian: commit + push, or tell me to). NEXT: Phase 4 profiles + ideation generation.
