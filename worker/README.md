# ugc-api — deploy runbook

One authenticated Cloudflare Worker + D1. Replaces `ugc-worker` (analysis) and
`sav-content-library` (library) — `sav-viral-scanner`'s Telegram/cron pipeline is untouched.

## 🔑 First deploy (Khian, in this `worker/` directory)

```bash
npm install                                  # zod + wrangler + typescript
npx wrangler d1 create ugc_library           # → paste database_id into wrangler.toml
npx wrangler d1 migrations apply ugc_library --remote

# Secrets (values never live in the repo):
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put RAPIDAPI_KEY         # Instagram resolver
npx wrangler secret put API_TOKENS           # see "Auth tokens" below

npx wrangler deploy
```

### Auth tokens
Generate one token per operator, store only their sha256 hashes:
```bash
openssl rand -hex 24                                  # khian's token — give it to khian
echo -n "<khian-token>" | shasum -a 256               # → hash A
openssl rand -hex 24                                  # niko's token
echo -n "<niko-token>" | shasum -a 256                # → hash B
# API_TOKENS secret value:
{"khian":"<hash A>","niko":"<hash B>"}
```
Every request needs `X-API-Key: <token>`. Revoke one operator by removing their hash.

### 🔑 Gemini model id check (Phase 2 gate)
```bash
curl -s -H "x-goog-api-key: $GEMINI_API_KEY" \
  "https://generativelanguage.googleapis.com/v1beta/models" | grep '"name"' | grep -i pro
```
Set the best available **Pro** id as `GEMINI_MODEL` in `wrangler.toml` (default
`gemini-3-pro-preview`, fallback `gemini-2.5-pro` is automatic on 404).

## Smoke tests after deploy

```bash
API=https://ugc-api.<account>.workers.dev
KEY=<your-token>

curl -s $API/health                                        # {"ok":true} — no auth
curl -s $API/formats                                       # → 401 (no key)
curl -s -H "X-API-Key: $KEY" $API/formats                  # → {"total":0,"items":[]}

# The heart — analyze an IG reel end-to-end:
curl -s -H "X-API-Key: $KEY" -F "videoUrl=https://www.instagram.com/reel/<id>/" $API/analyze
# → { "format": { …FormatDNA… } }  and the row is already in D1 (server-side save)

curl -s -H "X-API-Key: $KEY" "$API/formats?archetype=outfit_showcase&rating=sfw"
```

## KV migration (after first deploy)

```bash
wrangler kv namespace list                    # find the LIBRARY namespace id
../scripts/kv-snapshot.sh <LIBRARY-ns-id> library-snapshot.json
node ../scripts/migrate-kv-to-d1.mjs library-snapshot.json > migration-import.sql
npx wrangler d1 execute ugc_library --remote --file=migration-import.sql
```
Old entries arrive as `schema_version = '0-legacy'` (title/source/tags + full markdown in
`legacy_markdown`). They're an archive — re-analyze keepers through `/analyze`.

## Routes

| Method | Path | Notes |
|---|---|---|
| GET | /health | no auth |
| POST | /analyze | multipart `videoUrl` or `video`; returns FormatDNA, saved server-side |
| GET | /formats | filters: `archetype` `tag` `rating` `platform` `q` `limit` `offset` |
| POST | /formats | `{ dna, tags? }` manual import |
| GET/PUT/DELETE | /formats/:id | PUT bumps version + snapshots the old one |
| GET | /formats/:id/versions[/:v] | version history |
| GET | /profiles · GET/PUT/DELETE /profiles/:id | ModelProfile CRUD (seeded in Phase 4) |
| GET | /jobs/:id | async analyses (wired in Phase 5) |

All errors are `{error, code, detail?}` with real HTTP status codes.
