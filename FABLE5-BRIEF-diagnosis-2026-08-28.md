# UGC App — Diagnosis & Execution Brief (2026-08-28)

**Author:** Opus 5 (audit + spec) · **Executor:** Fable 5 (code) · **Operator:** Khian (🔑 secrets/deploys)
**Repo:** `/Users/mac/Desktop/ugc-` — `main @ 2883ddc` · **PUBLIC** GitHub `Manus-anus-spec/ugc-`
**Live:** frontend `manus-anus-spec.github.io/ugc-/` · API `ugc-api.khian-moclou.workers.dev` · D1 `ugc_library` (`66250432-78fa-46ff-adbd-3987d131dddd`)

---

## 0. READ THIS FIRST — the headline

**The code is not broken.** Both typechecks pass, all 13 compiler tests pass, the schema smoke passes, the production build succeeds and its output hash (`index-Cx9s0wEp.js`) is byte-identical to what's deployed on GitHub Pages. The worker deployed 2026-08-17 07:37 is current with `main`. All 3 D1 migrations are applied. The live brain holds 169 formats / 138 generations / 7 profiles.

### ✅ RESOLVED DURING THE AUDIT (2026-08-28) — do not re-do
- **API token** — was lost and unrecoverable; **new tokens minted for both operators, verified live.** Automation unblocked. (P0.4)
- **Gemini key leak** — **already remediated back in March.** Verified: neither leaked key (`AIzaSyAJTZ4Kto…`, `AIzaSyDzONKLUl…`) still exists in the account. Khian has since pruned to a single key, `ugc-api worker` (project `859046318616`, Tier 2 · Prepay).
- **"Billing credits depleted"** — **not a current problem.** Live-tested: the key generates successfully. The Jul/Aug outage is over.
- **Pinned model IDs** — **all three still valid** (`gemini-3.1-pro-preview`, `gemini-2.5-pro`, `gemini-2.5-flash`), confirmed via live ListModels.
- **The full `/generate` pipeline works** — HTTP 200 in 71s, 3 scored ideations with `themeFit`. See P1.1b.
- **Live app was briefly taken down** during a private-repo test and **has been restored** (Pages re-created, verified 200).

### ❌ WHAT IS ACTUALLY STILL WRONG
1. **`RAPIDAPI_KEY` has never been set** on `ugc-api` — Instagram URL resolution is dead. 🔑 One command. (P0.2)
2. **Three confirmed prompt defects**, proven on a live artifact: `sdPrompt` emits banned "full"; the hold-body directive is missing from every `motionPrompt`; `waist-up`/`fills 50%` survive into prompts. **These are real code bugs.** (P1.1b)
3. **No feedback signal has ever been recorded** — all 138 generations are `status='draft'`. The app cannot learn. (P1.1)
4. **82% of the library has never been used** — 31 of 169 formats ever fused. (P1.2)
5. **The repo's only test was failing on `main`**, and there is no CI. (P1.3 / P1.4)
6. **Legacy `ugc-worker` still deployed** holding live credentials. (P0.5)
7. It hasn't been used since **2026-08-20**.

⚠️ **Several claims in `docs/APP-IMPROVEMENT-LOG.md` and `FABLE5-HANDOVER.md` are stale.** Trust this document over them where they conflict. Specifically: the handover's working directory had ceased to exist, and log item 40's "remaining: Keira, Lilly, Molly personas" is **done** (all 6 team models now carry `contentPersona`).

---

## 1. P0 — 🔑 KHIAN ONLY (no code; do these before Fable 5 ships anything)

### P0.1 🔴 Rotate two leaked Gemini API keys — CONFIRMED, public since March
Two distinct keys were committed to this **public** repo and were also served inside the deployed JS bundle (i.e. publicly readable on the live site, not merely in history).

| Key | Commits | Date |
|---|---|---|
| `AIzaSyAJTZ…` | `09a36bd` | 2026-03-11 |
| `AIzaSyDzON…` | `61057db`, `3818c80`, `49f1cd0` | 2026-03-03 |

- `.env` containing `GEMINI_API_KEY` was added in `61057db` and removed in `3818c80` ("Redeploy with new API key") — **but the replacement key then leaked the same way.**
- Neither key is in `HEAD` (working tree is clean), but **history is permanent and the repo is public.** Assume both are compromised.
- **Action:** revoke both in Google AI Studio, issue a fresh key, `wrangler secret put GEMINI_API_KEY`.
- Scanned and found clean: no WaveSpeed (`wsk_live`), GitHub, OpenAI, or RapidAPI keys in this repo's history. (109 `sk-` matches were CSS `mask-*` properties in minified bundles — false positives.)

### P0.2 🔴 Set the missing `RAPIDAPI_KEY` — this is why Instagram URLs fail
`worker/src/env.ts:8` declares `RAPIDAPI_KEY: string` as **required**, but the live secret list for `ugc-api` contains only `API_TOKENS` and `GEMINI_API_KEY`. It was never migrated from the legacy worker (which still has it).
```bash
wrangler secret put RAPIDAPI_KEY --name ugc-api
```

### P0.3 🟠 Set `GEMINI_API_KEY_FALLBACK` — fixes the billing outage with zero code
`worker/src/gemini.ts:61` already implements automatic failover to a second key on a **different Google project** when the primary hits its spend cap. The secret is simply not set. This is the built-in remedy for the "prepayment credits depleted" problem (project `859046318616`).
```bash
wrangler secret put GEMINI_API_KEY_FALLBACK --name ugc-api   # key from a DIFFERENT project
```

### P0.4 ✅ DONE 2026-08-28 — new operator tokens minted and verified live
Fresh 32-byte tokens generated for **both** `khian` and `niko` (the old `API_TOKENS` value could not be read back, so Niko's hash was unavoidably destroyed — **he needs his new token**). sha256 hashes installed in the `API_TOKENS` secret. Raw tokens written to `/Users/mac/Desktop/ugc-/SECRETS.local.md` (mode 600, gitignored at `.gitignore:15`), never printed to a transcript.
**Verified live:** `/profiles` → 401 without key, 200 with key; `/formats` → `total: 169`; `/profiles` → all 7 (belle v13, keira v13, lilly v5, molly v4, naomi v6, rosalia v12, sav v1). Automation is unblocked.

<details><summary>Original finding (for the record)</summary>
`worker/src/auth.ts` stores only sha256 hashes (good design — constant-time compare, fail-closed), so the raw token **cannot** be recovered from Cloudflare. `SECRETS.local.md` is gone and is not in `~/Aruna-Content/.env.local`, shell history, or anywhere on disk.
```bash
TOKEN=$(openssl rand -hex 32)
echo -n "$TOKEN" | shasum -a 256          # put hash in API_TOKENS JSON
wrangler secret put API_TOKENS --name ugc-api   # {"khian":"<hash>","niko":"<hash>"}
```
Then write `/Users/mac/Desktop/ugc-/SECRETS.local.md` (gitignored) as `khian: <TOKEN>` — the `/ugc-api` skill and `docs/AUTOMATION-API.md:17` both read that exact path. Also add `UGC_API_KEY` to `~/Aruna-Content/.env.local` for Niko parity.
</details>

**Still open:** give Niko his new token, and add `UGC_API_KEY` to `~/Aruna-Content/.env.local`. A 📡 Team Changelog broadcast is warranted — Niko's old token is dead.

### P0.5 🟠 Delete the legacy `ugc-worker` — it holds live billable credentials
`ugc-worker.khian-moclou.workers.dev` is still deployed, answers unauthenticated (`{"status":"UGC Worker running","version":"4.2.0"}`), 404s on every current route, and **still holds `GEMINI_API_KEY` + `RAPIDAPI_KEY` as secrets.** Nothing points at it (verified: `src/config.ts:2` hardcodes `ugc-api`, and the deployed bundle confirms it).

⚠️ **Correction:** you CANNOT read `RAPIDAPI_KEY` off this worker. Cloudflare Worker secrets are write-only — `wrangler secret list` returns names and types only, never values. Get the RapidAPI key from the RapidAPI dashboard instead. Then:
```bash
wrangler delete --name ugc-worker
```

### P0.6 ❌ Repo cannot be made private while the frontend is on GitHub Pages — TESTED
**Decision was "make it private"; it is currently BLOCKED and the repo remains public.** Tested live on 2026-08-28: flipping to private **deleted the GitHub Pages site configuration** and the app went down (root HTML served from CDN cache for ~10 min while `assets/index-*.js` returned 404). The account is on the **free plan**, where Pages requires a public repo. Reverted to public; Pages had to be re-created via `POST /repos/:owner/:repo/pages` (the `gh-pages` branch content was never touched). Verified restored.

**The real path to a private repo:** move the frontend off GitHub Pages onto **Cloudflare** — either Cloudflare Pages or Workers static assets — since the whole backend is already Cloudflare. Then the repo can go private with no hosting loss, and deploys stop being hand-built. **Add this as a work item (see P2).** Until then the repo stays public, which makes P0.1 key rotation *more* urgent, not less.

Note: the repo has **0 forks and 0 stars**, so the leaked keys were probably never harvested — but rotate regardless.

---

## 2. P1 — FABLE 5: build the learning loop (highest leverage)

### P1.1 The feedback loop — `docs/APP-IMPROVEMENT-LOG.md` item 32
**Evidence it's unbuilt, from the live DB and code:**
- `SELECT status, COUNT(*) FROM generations GROUP BY status` → `{draft: 138}`. Every single run, no exceptions.
- `worker/src/routes/generate.ts:521` hardcodes `'draft'` in the INSERT.
- `worker/src/generate/rules.ts:1442` sets `ideation.status = 'draft'`.
- `shared/schemas.ts:21` defines `GenerationStatusSchema = z.enum(['draft','approved','produced'])` — the latter two values are **never written by any code path**.
- `worker/src/index.ts:50,66` expose only `GET /generations/:id`. **No PATCH/PUT route exists.**

**Build:**
1. `PATCH /generations/:id` accepting `{ verdict: 'up'|'down'|'shipped', ideationIndex?: number, note?: string }`. Decide and state your choice: reuse the existing `status` column, or add a dedicated `verdict` column via migration `0004`. Reusing `status` means reconciling the `approved`/`produced` enum with `up`/`down`/`shipped` — do not leave both vocabularies live.
2. Thumbs up/down in `src/components/generate/GenerateView.tsx` per ideation card, wired through `src/api/`.
3. Fusion-quality prior in `worker/src/generate/surprise.ts`: `fitness(F) = (ups + β) / (ups + downs + 2β)` with β≈2; selection weight becomes `score² × fitness`. Formats behind rejected fusions fade; formats behind winners rise.

**Acceptance:** a thumbs-down on a run measurably lowers its source formats' draw weight on the next `surprise` call, proven by a unit test with a seeded RNG. Never let fitness hard-exclude a format — soft weighting only, consistent with the existing off-menu ×0.08 approach.

### P1.1b 🆕 THREE CONFIRMED PROMPT DEFECTS — found on a live run, artifact committed
Validated end-to-end 2026-08-28: `POST /generate` `formatId=8712ced8…` (Spicy Chili Mom Test Fail, score 76, skit) `profileId=rosalia` `variationStrength=medium` → **HTTP 200 in 71s**, 3 ideations, scores 74/72/74, all `themeFit` present, all `videoFormat=ONE_SHOT`. Generation run `d1e74c20-da70-4ea9-848c-113e4bca7373`.
**Artifact: `docs/live-artifacts/generate-rosalia-2026-08-28-d1e74c20.json`** — reproduce every claim below against it.

**✅ Confirmed WORKING** (the Aug 17 fixes hold up live): no strip-regex garble (`off-camera-rose`, `in off-camera`, `green blue-` all absent); no freeze words (`stares`/`pauses`); realism-suffix sentinel appears exactly 3× (once per ideation, no dedup failure); `Secondary motion` never duplicated; Theme Governor active and culturally adapting (LatAm-correct titles: "Abuela's Salsa Test Fail", "Curandera Remedy Test Fail"); per-beat `productionRoute` names the ref kit with `base64` (3×).

**❌ DEFECT 1 — `sdPrompt` still emits "full" (violates log item 1, the oldest item in the log).**
Item 1's stated APP CHANGE: *"the generated `sdPrompt` should never emit 'full'… add 'full' to a body-word banlist in `prompt.ts` SD rules."* It is emitting it in **all three** ideations:
- ideation 0 `beats[0].sdPrompt` starts: `"Full natural bust + snatched waist, off-shoulder decolletage…"`
- ideations 1 & 2 `sdPrompt` each contain one lowercase `full`

Note the capital `F` in ideation 0 — **any banlist must be case-insensitive and word-boundaried** (`\b[Ff]ull\b`). Per item 1, replace with `natural / curvy / shapely / soft` + `realistic proportions, not exaggerated`. Fix in `worker/src/generate/prompt.ts` SD rules; add a regression test asserting no `\bfull\b` in any emitted `sdPrompt`.

**❌ DEFECT 2 — the hold-body directive is missing from every `motionPrompt` (violates log item 23).**
Item 23 calls this *"the single biggest video fix"* and requires appending to **every** motionPrompt:
> `Maintain her exact body shape and proportions from the first frame throughout — do NOT slim, shrink, or distort her figure.`

Checked `ideations[0].beats[0].motionPrompt`: **none of** `do NOT slim`, `Maintain her exact body`, `body shape`, `proportions`, `shrink`, `distort` appear anywhere. The injector either was never built or silently no-ops. Add it as a post-append injector alongside the existing ones (it must not consume LLM char budget), and unit-test that every motionPrompt ends with it exactly once (idempotent, same pattern as the `Secondary motion` sentinel).

**❌ DEFECT 3 — `waist-up` + `subject fills 50%` survive into prompts (violates log item 6).**
Item 6: *"'waist-up / subject fills 50-60%' induces a portrait. Use environmental/anti-portrait: 'NOT a portrait, NOT close-up, environmental medium-wide, subject occupies ~40%, off-center, room visible.'"*
Live occurrences:
- all 3 `motionPrompt`s carry `CAMERA(source): medium shot, waist-up, subject fills 50%, beat of ~11s`
- `ideations[1].beats[0].nbPrompt`: `"camera at chest height, waist-up framing, subject occupies ~40%"`

**Root cause is a genuine design conflict, not a typo:** the `CAMERA(source)` line is the per-beat source-camera injection from item 43, faithfully reproducing the analyzed source's framing — and `reproduce` mode is *supposed* to be 1:1. But item 6 bans exactly that vocabulary. **Resolve it deliberately:** either translate source framing into anti-portrait vocabulary on emit (keep the ~40% subject size, drop the words `waist-up` / `fills 50%`), or exempt the `CAMERA(source)` line from item 6 and fix only `nbPrompt`. Decide and document which — do not leave both rules live and contradictory. Note ideation 1's nbPrompt already says `~40%` while still saying `waist-up`, which suggests a partial fix was applied to subject size but not to the banned phrase.

**⚠️ NEEDS KHIAN'S JUDGMENT (not filed as a defect):** every `nbPrompt` contains `full hips` — but it comes from Rosalia's own `body.leadDescriptor` in D1 (`"bold full round lifted glutes and full hips clearly wider than the waist…"`), not from app logic. Item 1's ban is scoped to `sdPrompt`, so this is arguably intentional for her body lock. But it collides with item 1's spirit. **Khian: is "full" acceptable in her GPT-Image lead, or should her leadDescriptor be reworded?** Her `refs.refKit` and `body.leadDescriptor` are both correctly populated, so item 46's data work is done for her.

### P1.2 Coverage telemetry — item 34. **Measured today: 18%**
`SELECT COUNT(DISTINCT j.value) FROM generations g, json_each(json_extract(g.output,'$.sourceFormatIds')) j` → **31 distinct formats of 169 ever fused. 82% of the brain has never been touched.**

The Aug 17 sampler fix did work (3/40 = 7.5% → 31/169 = 18%), but the library grew faster than exploration. Build `GET /admin/synthesis-coverage` returning per-format `timesUsed`, the never-used list, and per-archetype coverage %. Then add a bounded **exploration bonus** for never-used formats so the tail gets drawn.

### P1.3 Commit the test harness — ✅ already staged in your working tree
The repo had **no unit tests** and its only test script was **failing**. I've fixed and staged (uncommitted, all green):
- `tests/contract-goldens.test.ts`, `tests/db-layer.test.ts`, `tests/gemini-parsing.test.ts` — **79 tests, all passing.** They cover the highest-risk silent-failure paths: video token budgeting/fps-ladder sampling, Gemini key failover, and streamed-JSON parsing (drops `thought` parts, surfaces `promptFeedback.blockReason`, throws on `MAX_TOKENS` instead of returning half a DNA).
- `scripts/schema-smoke.ts` — **was broken on `main`** (`exit 1`). Its fixture predated the v3 filming-fidelity schema: missing `shotSize`, `cameraAngle`, `lensFeel`, `cutTransition`, `motionBeat`, `secondaryMotion`, `microExpression`, `shotType`, `pacing.cutCadenceSec`, `pacing.payoffSec`. Fixed.
- `package.json` — added `typecheck`, `test:unit`, `test:rules`, `test:smoke`, and a `test` chain.
- `tsconfig.json` — include `tests` + `worker/src/cf.d.ts`.

**Review these, then commit them.** `npm test` is green end-to-end in the repo right now.

### P1.4 Add CI — there is none
No `.github/` directory at all; `gh-pages` is hand-built (currently in sync, but only by luck). Add a workflow running `npm test` on push/PR, plus a build-and-deploy-to-`gh-pages` job. This is what would have caught the broken smoke test and the stale fixture.

---

## 3. P2 — cleanups and hardening

- **🆕 Move the frontend to Cloudflare (Pages or Workers static assets).** This is the *enabler* for making the repo private (P0.6) and it kills the hand-built `gh-pages` deploy at the same time. The backend is already Cloudflare; hosting the SPA there consolidates everything under one deploy and one `wrangler` command. Do this before revisiting repo visibility.
- **Delete `.env.production`.** It says `VITE_PROXY_URL=https://ugc-worker…` (the legacy host), but `src/config.ts:2` hardcodes `API_BASE` and never reads it. Pure trap. Consider having `config.ts` read `import.meta.env.VITE_API_BASE` with the current value as fallback, so local dev can point elsewhere.
- **Resolve the two stale branches — needs Khian's decision (see §5).**
- **No rate limiting** exists on the paid `/analyze` and `/generate` endpoints (only Gemini quota *error handling*). Auth-gated to two operators, so low urgency, but a leaked token means uncapped spend. Consider a per-token daily cap.
- **No explicit upload byte cap** in `worker/src/routes/analyze.ts` — only duration gates (`HIGH_RES_MAX_SEC=90`, `SHORT_FORM_MAX_SEC=60`). Cloudflare's 100MB request limit is the only backstop.
- **SSRF:** `worker/src/resolvers.ts` fetches arbitrary caller-supplied URLs. Auth-gated, so low severity; an allowlist of known video hosts would close it.
- **CORS is correct** — `worker/src/http.ts:6-14` echoes `Origin` only when it's in `ALLOWED_ORIGINS`. No action.
- **Repo bloat:** `node_modules/` is in git history — **28,630 files ever added**, `.git` is 46MB. If you rewrite history to purge the leaked keys, purge `node_modules` in the same pass.
- **Bundle is 513KB** (>500KB warning), unchunked.
- **`GEMINI_MODEL = "gemini-3.1-pro-preview"`** is pinned in `worker/wrangler.toml:16` from a 2026-07-21 ListModels check. **Preview model IDs get retired.** 🔑 Khian: re-run a live ListModels to confirm it still resolves — if it's gone, every analyze fails.

---

## 3b. ARCHITECTURE GUARD — do NOT replace Gemini with a `/watch` skill

Researched 2026-08-28 because the question came up. **There is no official Anthropic `/watch` skill** — it's several community GitHub projects (`alexlarcheveque/claude-watch`, `jordanrendric/claude-video-vision`, `Newuxtreme/watch-video-skill`, `HUANGCHIHHUNGLeo/claude-real-video`), none installed here.

**Claude still cannot natively watch video with sound.** These skills are a `yt-dlp` + `ffmpeg` perception layer that hands Claude **sampled JPEG stills + a text transcript**. Verified from their own docs — they explicitly do **NOT** extract camera motion, cut cadence, frame-to-frame motion, or any audio beyond speech-to-text. `claude-video-vision` states it outright: *"the plugin is a perception layer, not an interpretation layer."*

Swapping Gemini for this would be a **straight downgrade**: the entire v3 FILMING-FIDELITY wedge (`camera.dynamics.motionSignature`, Pass-A boundary map, `cutCadenceSec`, `secondaryMotion`, `microExpression`, the 12fps micro-pass) is exactly the list of things stills-plus-transcript cannot produce. **Keep Gemini as the analysis engine.**

**🆕 The one idea worth stealing (optional, low priority):** a cheap dedicated **ASR pass for verbatim dialogue**. Groq `whisper-large-v3-turbo` ≈ $0.0007/min, ElevenLabs Scribe ≈ $0.0067/min — both cheaper and more literal than asking Gemini Pro to transcribe. Given log items 16 (accents) and 25 (exact spoken lines, dialogue routing), feeding verbatim timestamped dialogue into the DNA would sharpen the dialogue path. Additive only — it does not replace anything.

---

## 4. P3 — ingestion strategy (data, not code)

The library is imbalanced *and* skewed toward its own worst-performing archetype:

| format_type | count | avg virality |
|---|---|---|
| **thirst_trap** | **66 (39%)** | **50.2** |
| skit | 30 | **62.0** |
| vlog_moment | 19 | 40.3 |
| pov | 13 | **61.1** |
| outfit_showcase | 9 | 35.3 |
| talking_head | 7 | 48.0 |
| mirror_selfie | 7 | 35.0 |
| other | 6 | 65.7 |
| transformation | 4 | 49.0 |
| reaction | 3 | 43.3 |
| walk_and_talk / lifestyle_montage / text_monologue | 2 / 2 / 1 | 34.0 / 57.5 / 35.0 |

**39% of the brain is the lowest-scoring large category.** The two highest-value archetypes — `skit` (62.0) and `pov` (61.1) — are only 25% combined. Ingestion should deliberately hunt `skit` and `pov` sources and stop feeding thirst traps. This is an operator behaviour change, not a code change, but P1.2's exploration bonus plus P1.1's fitness weighting will compound it.

**Also:** `lilly` and `molly` have `contentPersona` authored but **zero generations ever** — they've never actually been run through the app.

---

## 5. DECISIONS — ✅ ALL LOCKED BY KHIAN 2026-08-28 (Fable 5: these are settled, build to them)

1. **Prompt humanization → HUMAN-BY-DEFAULT, NO ChatGPT detour.**
   Re-implement the *philosophy* of `worktree-humanize-prompts` (Aug 14) **on top of current `main`**. Prompts must read human straight out of `rules.ts`/`prompt.ts` with no external paraphrase hop, keeping the pipeline fully automatable.
   ⚠️ **Do NOT merge either branch.** Both predate `main`'s Aug 17 engine work, both DELETE `worker/src/generate/surprise.ts`, and both gut ~2.1k lines of `rules.ts` — merging would revert the one-shot engine, Theme Governor, and persona framework. Read `origin/worktree-humanize-prompts` for its *ideas* (`git diff main..origin/worktree-humanize-prompts -- worker/src/generate/prompt.ts`), then reimplement cleanly. **Delete `feat/human-prompt-engine` — it lost.**
   Anchor the work to `docs/APP-IMPROVEMENT-LOG.md` items 4–13 (freeze words, over-directed expressions, anti-portrait framing, idle-behavior block, hands-with-reasons) and validate with before/after golden prompts.
2. **Feedback verdict storage → NEW COLUMN, migration `0004`.**
   ```sql
   ALTER TABLE generations ADD COLUMN verdict TEXT;        -- 'up' | 'down' | 'shipped'
   ALTER TABLE generations ADD COLUMN verdict_note TEXT;
   ALTER TABLE generations ADD COLUMN verdict_at TEXT;
   ```
   Leave the existing `status` column (`draft|approved|produced`) alone — two clean axes, no vocabulary collision.
3. **Repo private → BLOCKED, deferred.** See P0.6: free-plan Pages requires a public repo. The enabling work is moving the frontend to Cloudflare (P2). Repo stays public for now.
4. **Git history rewrite → NO.** Rotate the keys only. Once revoked they're worthless; a rewrite breaks clones/forks and can't purge third-party caches. The 46MB `.git` and the committed `node_modules` stay.

---

## 6. VERIFICATION — run before and after any change

```bash
cd /Users/mac/Desktop/ugc-
npm test                      # typecheck (both projects) + 79 unit + 13 rules + smoke — ALL GREEN today
npm run build                 # must succeed
# 🔑 needs the new token from P0.4:
export UGC_API=https://ugc-api.khian-moclou.workers.dev
export UGC_KEY=$(grep 'khian:' SECRETS.local.md | grep -o '[a-f0-9]\{20,\}')
curl -s -H "X-API-Key: $UGC_KEY" "$UGC_API/formats?limit=1" | head -c 300
curl -s -H "X-API-Key: $UGC_KEY" "$UGC_API/profiles" | python3 -m json.tool | head -20
```

**Still untested end-to-end, because the token was lost:** a live `/analyze` run and a live `/generate` run. Until P0.4 and P0.1–P0.3 are done, the deep pipeline (Gemini call → parse → persist) is unverified. Do that first — it's the one thing that could still reveal a genuine code defect.

---

## 7. Suggested order

```
🔑 Khian:  P0.1 rotate Gemini keys → P0.5 harvest RAPIDAPI_KEY then delete legacy worker
        → P0.2 set RAPIDAPI_KEY → P0.3 set fallback key → P0.4 mint token
        → verify live /analyze + /generate → answer §5 decisions
Fable 5:  P1.3 review+commit tests → P1.4 CI → P1.1 feedback loop → P1.2 coverage
        → P2 cleanups → §5.1 re-implement the winning humanization philosophy on main
```

Phase by phase. Stop and check in with Khian at each boundary, per the standing rule in `FABLE5-HANDOVER.md`.
