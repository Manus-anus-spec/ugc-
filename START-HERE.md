# UGC Reverse-Engineer — START HERE

*Rebuilt end-to-end by Fable 5, 2026-07-21 → 22. This file is the cold-resume point for
anyone — Khian, Niko, a future dev, or a fresh AI session. Read this, then `FABLE5-LOG.md`
for the build trail.*

## What this app is

Drop any viral short-form video in → a Gemini-Pro analyzer deconstructs **why it worked**
into typed **FormatDNA** (hook mechanism, beat-by-beat shot list, camera language, swap map,
why-it-works) → it lands in a searchable **format library** → one button generates
**3 fresh ideations**: new treatments that keep the ~80% that made the original work
(whyItWorks + swapMap.mustKeep) and reinvent the rest, emitting **portable, copy-paste
prompts** for NanoBanana (image) → Seedream (body/edit) → Kling / CDance (motion).

Generation is **character-neutral by default** — prompts address "the subject from the
reference image", so any model/creator can be produced from the same ideation. Model
profiles (sav / naomi / niko-default, seeded) are an optional layer: pass `profileId`
to `/generate` to bind one.

This is the wedge Higgsfield refuses to build: portable prompts, a user-owned format
library, and format→your-tools orchestration. Full context: `REBUILD-BRIEF.md` (vision),
`docs/higgsfield-research.md` (competitor), `FABLE5-PLAN.md` (architecture decisions).

## Live URLs

| Thing | URL |
|---|---|
| **App** (GitHub Pages) | https://manus-anus-spec.github.io/ugc-/ |
| **API** (Cloudflare Worker `ugc-api`) | https://ugc-api.khian-moclou.workers.dev |
| Health check (no auth) | https://ugc-api.khian-moclou.workers.dev/health |

⚠️ The Pages URL contains the word "anus" (account name). **Move the repo to an
Aruna-owned org before sharing the URL with anyone or productizing.** The repo is PUBLIC.

## Architecture

```
Frontend (this repo, Vite/React, GitHub Pages ← gh-pages branch)
  src/            decomposed app: api client, hooks, components (design: docs/design-direction.md)
  shared/         THE contract — zod-v4 schemas → TS types, imported by frontend AND worker
        │  HTTPS + X-API-Key on every call
        ▼
ugc-api (worker/ in this repo, Cloudflare Worker + D1 "ugc_library" id 66250432…dddd, APAC)
  /analyze         video/URL → Gemini File API → gemini-3.1-pro-preview (SSE, JSON-schema
                   output, zod-validated, 1 repair ask) → saved to D1 BEFORE responding.
                   >90s video → medium resolution; >300s → async job (202 + poll /jobs/:id)
  /formats…        library CRUD, FTS5 search (q=), tags, versions (PUT snapshots old DNA)
  /generate        FormatDNA [× profile] → 3 ideations; two-layer compiler:
                   deterministic rules (Kling/CDance table, face-forward, lint, identity
                   wrap — see worker/src/generate/rules.ts, 20 unit tests) around ONE
                   creative Gemini call. Neutral by default (worker/src/generate/neutral.ts)
  /profiles…       optional model profiles (seeds: worker/seeds/profiles.ts)
  /export/json · /export/briefs · /formats/:id/export?fmt=markdown
  /admin/reindex-fts
        ▼
  Gemini API — key in x-goog-api-key header; AI Studio project 859046318616, PREPAY billing
```

Old system (retired from the app, still deployed): `ugc-worker` (old analyzer),
`sav-content-library` (old KV library). **`sav-viral-scanner` keeps running its
Telegram/cron pipeline — do not touch it.** Phase 6 (decommission old workers + KV freeze)
is pending a ~2-week soak — see Open items.

## Access (the auth wall — keep it)

- Every API route except `/health` requires header **`X-API-Key: <token>`**.
- The worker stores only **sha256 hashes** of tokens (Cloudflare secret `API_TOKENS`,
  JSON: `{"khian":"<sha256hex>","niko":"<sha256hex>"}`). Constant-time compare, per-person
  revocation.
- **Raw tokens are NOT in this repo (it's public).** They're recorded in
  **`SECRETS.local.md`** on Khian's machine (gitignored) — khian's and niko's current keys.
- **Paste once, remembered forever:** the app asks for the key on first visit per
  browser/device, validates it with a real API call, and stores it in `localStorage`.
  It is never asked again on that device — only an actual 401 (revoked key) rejects it;
  network blips don't. "Sign out" in the rail is the only way to clear it.

### Onboard a new person
1. `openssl rand -hex 24` → give them the token (they paste it once into the app).
2. `echo -n "<token>" | shasum -a 256` → take the hash.
3. Add `"name":"<hash>"` to the JSON and set it:
   `echo -n '{"khian":"<h1>","niko":"<h2>","new":"<h3>"}' | npx wrangler secret put API_TOKENS`
   (in `worker/` — include ALL existing hashes; the secret is replaced wholesale).
4. `npx wrangler deploy`. Revoke someone by removing their hash and repeating 3-4.
5. Record the raw token in `SECRETS.local.md`.

## Run locally

```bash
npm install                # repo root (frontend + shared)
npm run dev                # http://localhost:3000/ugc-/ (port 3000/5173 are CORS-allowed)
npm run lint               # strict tsc, frontend + shared + scripts
npm run smoke              # offline schema sanity (scripts/schema-smoke.ts)
npx tsx scripts/compiler-tests.ts   # 20 rule-engine unit tests

cd worker && npm install
npm run lint               # worker + shared typecheck
npx wrangler dev           # local worker (needs secrets set locally or .dev.vars)
```

## Deploy

**Worker:** `cd worker && npx wrangler deploy`. Migrations:
`npx wrangler d1 migrations apply ugc_library --remote`. Secrets (already set):
`GEMINI_API_KEY`, `API_TOKENS`; **`RAPIDAPI_KEY` not yet set** → Instagram *URL paste*
returns a clear error until added (file upload always works). Model pin lives in
`worker/wrangler.toml` (`GEMINI_MODEL=gemini-3.1-pro-preview`, auto-fallback 2.5-pro).
Full runbook incl. curl smoke tests: `worker/README.md`.

**Frontend:** GitHub Pages serves the `gh-pages` branch root.
```bash
npm run build
git worktree add /tmp/ghp gh-pages && cd /tmp/ghp && git rm -rq . \
  && cp -R ../dist/. . && git add -A && git commit -m "Deploy" \
  && git push origin HEAD:gh-pages && cd - && git worktree remove --force /tmp/ghp
```
Live in ~30-60s; confirm the new `assets/index-*.js` hash is served.

## Billing / quota

Gemini: AI Studio project **859046318616**, **prepay** — Pro calls fail with
"prepayment credits depleted" when the balance hits zero → top up at
https://ai.studio/projects. Cost ballpark: an analysis ≈ cents, a 3-ideation
generation ≈ cents. Cloudflare: free tier (D1 5GB) is plenty.

## Open / optional items

- 🔑 **RAPIDAPI_KEY** secret → enables Instagram URL paste (Khian said he'll add).
- **Repo migration** to an Aruna-owned org before any external sharing (public repo,
  unfortunate URL). Update the CORS allowlist (`worker/wrangler.toml` ALLOWED_ORIGINS)
  and Pages when done.
- **Phase 6 decommission** after ~2 weeks of soak: export + freeze old KV namespaces,
  strip `/library`, `/generate-sav-idea`, `/ui` from sav-viral-scanner (verify its cron
  still runs), delete `ugc-worker` + `sav-content-library`. Plan §8 Phase 6.
- **Operator-Claude sessions** should migrate from `sav-content-library /prompts` to
  `GET /export/briefs` (new shape; `?profile=sav` to filter).
- **Goldens:** a mirror-selfie reel (only untested camera class) + a 3-min video
  (validates long-form tiering; windowed two-pass is deferred until a golden shows gaps).
- **Profile values:** naomi/niko-default are educated stubs (plan §9 Q5) — edit via
  `PUT /profiles/:id` (auto version-bump); UI editor is a possible later addition.
- **Prompt tuning backlog** (from A/B): nudge archetype toward a canonical list; beat
  granularity; keep the aggressive NSFW rubric literal.
- **Virality scoring** = deferred to v2 by decision D2 (optional Higgsfield
  `virality_predictor` enrichment, credit-gated).

## Document map

| File | What |
|---|---|
| `REBUILD-BRIEF.md` | The vision, competitive wedge, product requirements, locked decisions |
| `FABLE5-PLAN.md` | Audit of the old system + full re-architecture plan (schema §3 is the contract spec) |
| `FABLE5-LOG.md` | Phase-by-phase build log: what shipped, bugs found live, verdicts |
| `docs/current-app-map.md` | Honest map of the OLD code and its failures (historical) |
| `docs/higgsfield-research.md` | Competitor analysis + the gaps this app exploits |
| `docs/design-direction.md` | The approved design system (Classic Black / Power Orange) |
| `docs/goldens/` + `docs/golden-test-1*.json` | Real analyzer outputs incl. the Pro-vs-Flash A/B |
| `worker/README.md` | Worker deploy runbook + curl smoke tests |
| `SECRETS.local.md` | ⚠️ local-only (gitignored): raw operator tokens |
