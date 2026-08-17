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

## Pages deploy · 2026-07-22 ✅ LIVE
- Source pushed (feat/production-brief-system 9d5db79), dist force-pushed to gh-pages. Live: https://manus-anus-spec.github.io/ugc-/ — token unlocks it.
- Hygiene: stray root bundle + .bak + stale pnpm-lock deleted, .omc/ untracked, dist stays untracked. Q7: repo stays on Manus-anus-spec for now; MOVE TO ARUNA ORG BEFORE SHARING THE URL (it contains "anus").

## Phase 4 — Profiles + ideation generation · 2026-07-22 ✅ LIVE end-to-end
- Profiles seeded on live API: sav (every literal lifted from scanner IP: sheet ids, 12-step NB, SD templates, camera lines, sanitize map, voice), naomi (single-ref+base64, stub world), niko-default template. /generate REQUIRES profileId — no default identity exists.
- Two-layer compiler: deterministic rules (Kling/CDance table, face-forward, banned-word/char-cap lint, identity-lock wrap, input sanitize — 20 offline tests green) around ONE creative Pro call; one schema repair + one lint rewrite, then typed hard-fail. Runs persist to D1 generations.
- THREE REAL BUGS found+fixed in live testing: (1) Gemini's constrained decoder 400s on minItems/maxItems over large item schemas → geminiSafeSchema strips array bounds; (2) thinking models stream thought-parts that corrupted accumulated JSON → filtered; (3) client disconnect cancelled the worker mid-run and orphaned a paid call → waitUntil on /analyze + /generate, plus a run-history loader in the UI.
- PROVEN: Feral Hinge × sav → 3 ideations (Room Service / Galley Break / Villa Feast) all in Sav's world w/ uniform block + voice; × naomi → Rooftop Burger / Hotel Ribs / Cafe Spaghetti, ZERO Sav-world tokens. The Naomi→Sav bug is dead. Money screen verified in Chrome on the production build; Phase 4 deployed to Pages (index-CwYSPTHW.js).
- NEXT: Phase 5 — long-form two-pass + async jobs, /export/briefs (operator-Claude compat), FTS search, version-history UI, profile editor. Open inputs: Naomi/Niko real profile values (Q5), 2 more goldens incl. a mirror-selfie.

## Neutral pivot + Phase 5 · 2026-07-22 ✅ LIVE
- GENERATION IS CHARACTER-NEUTRAL BY DEFAULT (Khian directive): one "Generate ideation" button, no profile picker; built-in NEUTRAL_PROFILE (compiled-in, uneditable); prompts say "the subject from the reference image". Proven live: 3 fresh ideations, ZERO identity tokens, "the subject" 17×. Profiles remain an optional layer (pass profileId).
- FTS5 search live over title/archetype/hook/why-it-works/tags (migration 0002, app-synced, LIKE fallback, /admin/reindex-fts — 7 reindexed). q=subversion correctly matches why-it-works text.
- Exports live: /export/json (73KB full dump), /formats/:id/export?fmt=markdown (readable brief + generations — the transparency wedge), /export/briefs (operator-Claude feed, ?profile= filter; sessions should migrate from sav-content-library /prompts to this).
- Long-form: File API duration now drives resolution tiering (>90s = medium) and async routing (>300s = 202 job + /jobs/:id polling; pipeline completes under waitUntil). NOTE: windowed two-pass segmentation deferred — single-pass at tiered resolution first; add windows only if a long-form golden shows quality gaps.
- UI: version-history chips + snapshot viewer, copy-brief(md), async polling in useAnalyze. Deployed: worker 385cd894, Pages index-C47Th-zp.js. Remaining from plan §8: Phase 6 decommission (KV freeze + scanner route strip) — needs a 2-week soak first.

## v3 Filming-Fidelity upgrade · 2026-07-25
- Full "reproduce the filming" spec (OMC-audited) implemented: multi-pass perception (fps sampling via videoMetadata — the app was blind at 1fps before), reproduce/adapt fidelityMode, schema extensions (all optional; 7 archived goldens verified parsing), post-append realism injectors + fidelity linter, trim map + postProcessing, /qa loopback. Doc: docs/V3-FILMING-FIDELITY.md.
- Deployed worker 604f6c5f. tsc clean (worker+frontend), 90+ compiler tests green.
- GEMINI_MODEL_FAST pinned gemini-2.5-flash (validated live Jul 21); swap to a 3.x flash by var when available.
- fps-honored detector: usageMetadata.promptTokenCount vs fitVideoSampling estimate → warn + timingConfidence 'low' if Google ignores fps (upstream issue googleapis/python-genai#2171 unresolved).
- ⚠️ LIVE ACCEPTANCE BLOCKED: monthly spend cap still exhausted (confirmed via friendly 503 gemini_billing_cap on a real 45s upload). After top-up: re-run analyze on a fast-cut cooking reel, then POST /generate {fidelityMode:'reproduce', profileId:'rosalia'} and check beats pin 1:1 w/ source camera tokens + trim map.
