# UGC API — Automation Guide (for Claude sessions & scripts)

The entire app is an API. Anything the UI does, a Claude session or cron script can do —
analyze videos, run generations for a profile, pull briefs, manage profiles. This doc is
the contract for that automation layer.

- **Base URL:** `https://ugc-api.khian-moclou.workers.dev`
- **Auth:** every route except `/health` requires header `X-API-Key: <token>`.
  Raw operator tokens live in `SECRETS.local.md` (gitignored, Khian's machine). Never
  commit or paste tokens into chats/repos.
- **Errors:** always typed JSON `{ error, code, detail? }` with a real HTTP status.
- **Content dates:** all timestamps ISO-8601.

```bash
# Every example assumes:
export UGC_API=https://ugc-api.khian-moclou.workers.dev
export UGC_KEY=$(grep 'khian:' /Users/mac/Desktop/ugc-/SECRETS.local.md | grep -o '[a-f0-9]\{20,\}')
```

## Core workflow

### 1. Analyze a video → FormatDNA (with virality scorecard + camera physics)

```bash
# From a URL (TikTok / YouTube / Pinterest; IG URL needs RAPIDAPI_KEY secret set):
curl -s -X POST "$UGC_API/analyze" -H "X-API-Key: $UGC_KEY" -F "videoUrl=https://www.tiktok.com/@x/video/123"

# From a file (always works):
curl -s -X POST "$UGC_API/analyze" -H "X-API-Key: $UGC_KEY" -F "video=@/path/to/reel.mp4"
```

- Sync response (`≤300s` video): `{ "format": <FormatDNA> }` — typically 50-90s wall clock.
- Async (`>300s` video): `202 { "job": { "id": "…" } }` → poll `GET /jobs/:id` until
  `status: "done"`, then `GET /formats/:resultFormatId`.
- The v2 DNA includes `virality` (brutal 0-100 scorecard), `formatType` (canonical
  taxonomy), and `camera.dynamics` (handheld physics + paste-ready `motionSignature`).

### 2. Generate 3 ideations (character-neutral or FOR a profile)

```bash
# Neutral (any model, any reference image):
curl -s -X POST "$UGC_API/generate" -H "X-API-Key: $UGC_KEY" -H 'Content-Type: application/json' \
  -d '{"formatId":"<id>","variationStrength":"close"}'

# For a specific model — her world, voice, and Seedream body pass:
curl -s -X POST "$UGC_API/generate" -H "X-API-Key: $UGC_KEY" -H 'Content-Type: application/json' \
  -d '{"formatId":"<id>","profileId":"sav","variationStrength":"medium"}'

# SYNTHESIZE (§10 — the "fresh video" engine): fuse the MECHANISMS of several library
# blueprints into a NEW format (copies no concrete detail). Pass 2–4 source ids:
curl -s -X POST "$UGC_API/generate" -H "X-API-Key: $UGC_KEY" -H 'Content-Type: application/json' \
  -d '{"fidelityMode":"synthesize","formatIds":["<id1>","<id2>","<id3>"],"profileId":"belle"}'

# "SURPRISE ME": omit formatIds — the server auto-selects the top-scoring, archetype-diverse
# blueprints from the whole library and invents something fresh:
curl -s -X POST "$UGC_API/generate" -H "X-API-Key: $UGC_KEY" -H 'Content-Type: application/json' \
  -d '{"fidelityMode":"synthesize","profileId":"belle"}'
```
The GenerationRun records `sourceFormatIds` (which blueprints were fused); each ideation's
`keptFromOriginal` names which mechanism came from which source.

Returns a `GenerationRun`: 3 ideations, each with a brutal `virality` forecast,
per-beat `nbPrompt` / `sdPrompt` / **self-contained** `motionPrompt` (dialogue,
emotion arc, and camera physics embedded — paste only that one field into Kling/CDance).
`variationStrength`: `close` | `medium` | `bold`.

### 3. Library

```bash
curl -s "$UGC_API/formats?formatType=skit&rating=nsfw&limit=20" -H "X-API-Key: $UGC_KEY"   # filters
curl -s "$UGC_API/formats?q=subversion" -H "X-API-Key: $UGC_KEY"                            # FTS search
curl -s "$UGC_API/formats/<id>" -H "X-API-Key: $UGC_KEY"                                    # full DNA
curl -s "$UGC_API/formats/<id>/export?fmt=markdown" -H "X-API-Key: $UGC_KEY"                # readable brief
curl -s "$UGC_API/formats/<id>/generations" -H "X-API-Key: $UGC_KEY"                        # run history
curl -s "$UGC_API/generations/<runId>" -H "X-API-Key: $UGC_KEY"                             # full run
```

Filters: `formatType` (talking_head|skit|pov|grwm|transformation|outfit_showcase|
walk_and_talk|mirror_selfie|text_monologue|vlog_moment|reaction|tutorial|
lifestyle_montage|thirst_trap|other), `rating` (sfw|borderline|nsfw), `archetype`,
`platform`, `tag`, `q` (full-text), `limit`, `offset`.

### 4. Profiles (the swappable identity layer)

```bash
curl -s "$UGC_API/profiles" -H "X-API-Key: $UGC_KEY"                    # list
curl -s "$UGC_API/profiles/sav" -H "X-API-Key: $UGC_KEY"                # full profile JSON
# Upsert (create or edit — server bumps version):
curl -s -X PUT "$UGC_API/profiles/belle" -H "X-API-Key: $UGC_KEY" \
  -H 'Content-Type: application/json' -d @belle-profile.json
```

Profile fields that drive generation: `world.persona/backstory/audienceICP`,
`world.locationWhitelist/Banlist`, `voice.*`, `body.*` (build/proportions/skin/
sdEnhancementNotes — feeds the Seedream body pass), `toolRules.*`, `contentPolicy.*`.

### 5. Bulk exports (operator-Claude feeds)

```bash
curl -s "$UGC_API/export/json" -H "X-API-Key: $UGC_KEY"                 # full library dump
curl -s "$UGC_API/export/briefs" -H "X-API-Key: $UGC_KEY"               # production briefs
curl -s "$UGC_API/export/briefs?profile=sav" -H "X-API-Key: $UGC_KEY"   # filtered per model
```

### 6. Admin

```bash
# Classify + score pre-v2 rows from their stored DNA (3 per call; repeat until done:true):
curl -s -X POST "$UGC_API/admin/backfill-taxonomy?limit=3" -H "X-API-Key: $UGC_KEY"
curl -s -X POST "$UGC_API/admin/reindex-fts" -H "X-API-Key: $UGC_KEY"
```

## Automation recipes

- **Batch analyze a folder:** loop `analyze` with `-F video=@file` (serially — each call
  is one Gemini Pro run; parallel calls multiply spend), collect `format.id`s.
- **Nightly content run:** `GET /formats?formatType=skit&limit=5` sorted by
  `viralityScore` → `POST /generate` with the model's `profileId` → keep only ideations
  with `virality.score >= 60` → write briefs to the model's content folder.
- **Score-gate:** if all 3 ideations forecast <55, regenerate with `variationStrength: "bold"`.
- **Cron:** any Claude Code scheduled agent can run these curls; token comes from
  `SECRETS.local.md` — never hardcode it in the cron prompt.

## Ops notes

- Gemini billing is prepaid (project 859046318616) — Pro calls fail with
  "prepayment credits depleted" at zero balance; top up at https://ai.studio/projects.
- An analysis or generation is ~cents each; a 500-video batch is real money — sanity-check loops.
- `waitUntil` protects paid runs server-side: a dropped connection doesn't kill the run;
  recover via `GET /formats/:id/generations`.
