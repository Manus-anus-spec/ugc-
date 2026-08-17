# FABLE5 PLAN — UGC Reverse-Engineer Rebuild
### Independent audit + re-architecture plan · Fable 5 · 2026-07-21
### Status: PLAN ONLY — no code written. Awaiting Khian sign-off.

---

## 1. Audit confirmation

I read all four code artifacts end-to-end. The prior audit (`scratchpad/current-app-map.md`) is **accurate on every material claim**. Below: confirmation of the brief's 5 shortfalls with live-code citations, one small correction, and **eight new problems** the prior audit missed or under-weighted.

### 1.1 The five shortfalls — confirmed

**S1 — Wrong model tier. CONFIRMED.**
Both Gemini call paths hard-code Flash: `gemini-2.5-flash` in the streaming helper (`/Users/mac/Desktop/worker-v4.2.0.js:366`) and the non-streaming helper used by all retries (`worker-v4.2.0.js:411`). The generation endpoint is also Flash (`sav-viral-scanner.js:2076`). The 18-section SYSTEM_INSTRUCTION (`worker-v4.2.0.js:1-238`) demands frame-edge crop boundaries, fabric texture, camera height inferred from ceiling/floor proportions, per-hand tracking — perception work Flash reliably fumbles. The elaborate validate-and-retry cascade (`worker-v4.2.0.js:437-472, 741-781`) exists *because* Flash keeps under-delivering; it patches by appending "Auto-Generated" sections (`:749, :763, :777`), producing the messy, non-canonical documents the library then scrapes.

**S2 — Prose → broken regex scraping. CONFIRMED, and it's worse than "mislabeled."**
- `extractSection` (`App.tsx:245-249`) keys on `## N.` headings. `apiPushToContentLibrary` (`App.tsx:155-164`) calls it with section numbers from the **dead in-App prompt** (`App.tsx:532-652`), not the deployed worker's schema. Verified against the worker prompt: `camera` stores §2 = **Ad Type Classification** (`worker-v4.2.0.js:47`), `environment` stores §3 = **Content Flag** (`:50`), `outfit` stores §4 = **Camera & Framing** (`:56`), `action_breakdown` stores §5 = **Environment** (`:59`), `audio_plan` fallback stores §8 = **Energy & Pacing** (`:70`), `hook_analysis` stores §10 = **Audio Analysis** (`:76`). Every structured field in the shared library is misfiled. Correct numbers would be 4/5/6/7/10/12 — but we should not fix the regex; we should kill it (§4c of the brief).
- `extractNBPrompt` (`App.tsx:253`) looks for a ` ```nano-banana ` fence the deployed prompt never asks for — the worker labels prompts "Frame 0A NB" etc. (`worker-v4.2.0.js:189`). So it falls through to "first code block," which may be anything.
- `extractAllKlingPrompts` (`App.tsx:285-296`) classifies **every unlabeled code block** as a Kling prompt — with the worker's labeling scheme, the 4-8 NanoBanana frame prompts land in `kling_prompts[]`.
- `extractHookText`/`extractVideoMeta`/`detectFormatType` (`App.tsx:298-353`) are bold-label regex + substring keyword heuristics ("gray beard" → ICP Targeting, `App.tsx:344`) that break whenever Flash rephrases a heading. `extractVideoMeta` even **defaults to one-shot** when the word "multi" is absent (`App.tsx:329`).
- Net: the only trustworthy stored field is `full_analysis` (raw markdown). The brief's "saves junk" complaint is fully explained.

**S3 — Identity hard-coded to Sav. CONFIRMED.**
The frontend sends `{ item, model }` (`App.tsx:180-184`), but `handleGenerateSavIdea` destructures only `body.analysis` / `body.item` — `body.model` is never read (`sav-viral-scanner.js:1995-2036`). `SAV_IDEA_SYSTEM_PROMPT` is 100% Sav: "a fashion/lifestyle Instagram creator called Sav," flight-attendant world, fixed location whitelist/banlist, uniform makeup blocks (`sav-viral-scanner.js:1849-1906`). Selecting "Naomi" in the UI (`App.tsx:1005-1013`) provably produces Sav content. Frontend is equally hard-coded: flight-attendant `FORMAT_OVERLAYS`/`FORMAT_CAPTIONS` ("30,000 feet", "layover", `App.tsx:357-415`), `SAV_NB_RULES` (`:417`), `buildSavNBPrompt` stripping "half-brazilian"/"platinum blonde" (`:429-434`). Worker constants: `SAV_FACE_SHEET_ID`/`SAV_BODY_SHEET_ID` (`sav-viral-scanner.js:41-42`), `SAV_BASE_PROMPT` with the United uniform (`:44-46`). Only `sav-content-library` is genuinely model-aware (`worker.js:47, 124-125`) — but it's fed by a Sav-only generator, so the field is cosmetic.

**S4 — URL analysis dead on arrival. CONFIRMED, plus a second break the prior audit missed.**
- Field-name mismatch: frontend appends `formData.append('url', videoUrl)` (`App.tsx:847`); worker reads `formData.get('videoUrl')` (`worker-v4.2.0.js:626`). Every pasted URL → "No video file or URL provided" (`worker-v4.2.0.js:701`).
- **NEW:** even after fixing that, **Instagram is blocked client-side** — `isValidUrl` (`App.tsx:822-829`) accepts YouTube/TikTok/Pinterest but **not** `instagram.com`, though the worker fully supports IG Reels via RapidAPI (`worker-v4.2.0.js:658-675`). The UI placeholder confirms it (`App.tsx:1117`). IG — the platform we care most about — is doubly dead.

**S5 — Structural debt. CONFIRMED.**
- `App.tsx` = 1,646 lines, one component, ~23 `useState` hooks (`App.tsx:655-680`), all types + 3 API clients + 8 regex parsers + Sav builders + a dead 120-line system prompt + two canvas frame extractors + ~650 lines of JSX.
- Two duplicate libraries: every save writes the raw item to KV `FORMAT_LIBRARY` (`sav-viral-scanner.js:1261-1270`) *and* a remapped copy to KV `LIBRARY` (`App.tsx:127-173` → `worker.js:101-118`), which additionally stores the entire incoming body **again** under `raw` (`worker.js:96`) — the same markdown is persisted 3×.
- No auth anywhere; content-library CORS is `*` (`worker.js:24-28`), viral-scanner CORS is `*` (`sav-viral-scanner.js:1107-1109`). Anyone with the URL can `DELETE /entry/:id` (`worker.js:215-223`) or `POST /library` garbage. Only the analyze proxy has an origin allowlist (`worker-v4.2.0.js:334-338`) — and CORS isn't auth anyway (curl bypasses it).
- Silent failures: `apiPushToContentLibrary` swallows all errors (`App.tsx:174-176`); auto-save failures only `console.warn` (`App.tsx:894-896`) while the UI shows "Saved!".
- `sav-viral-scanner.js` is a 2,129-line grab-bag: app library CRUD + generation + Telegram scraper/approver + Higgsfield pipeline + embedded HTML UI (`:1284+`) + a hardcoded dated auto-post schedule.

### 1.2 Correction to the prior audit
Minor: the prior audit says the retry cascade lives at "742-781" and validation at "437-472" — confirmed correct — and its section-mismatch table is exactly right. One nuance it understates: `audio_plan` and `hook_analysis` only fall back to the wrong sections *when savPrompts is absent* (`App.tsx:160,164`), i.e. every auto-save (which never has savPrompts). So on the primary save path the mislabeling is unconditional. No claims to retract.

### 1.3 NEW material problems (not in the brief)

**N1 — SECURITY: Gemini API key can ship in the public bundle.** `vite.config.ts` injects `process.env.GEMINI_API_KEY` into the client build via `define` (`vite.config.ts:11-13`). The repo deploys to public GitHub Pages. Nothing in `App.tsx` currently reads it (the direct-Gemini path is dead code), but if `.env` contains the real key at build time, the key is string-embedded in `dist/` and published. There's also a stray built bundle at repo root (`/Users/mac/Desktop/ugc-/index-BxmBSaIy.js`) and a committed `dist/`. **Action regardless of rebuild: remove the `define`, purge/rotate the key if it ever appeared in a published build.**

**N2 — CORRECTNESS/UX: analysis errors masquerade as success.** The worker streams its final payload over a 200 response; on failure it writes `{error}` into that same 200 stream (`worker-v4.2.0.js:792-794`). The frontend checks only `response.ok`, then does `data.result || 'No analysis generated.'` (`App.tsx:858-864`) — a real error surfaces as a fake empty "analysis," which then gets **auto-saved to both libraries** as a junk entry.

**N3 — DATA LOSS: non-atomic KV index updates.** Both libraries maintain a single `index` key via read-modify-write (`worker.js:107-112`; `sav-viral-scanner.js:1266-1268`). Two concurrent saves (two operators, or auto-save racing "Make for Sav" re-save at `App.tsx:974-975`) last-writer-wins the index — an entry's body exists in KV but vanishes from every list forever. This is a live hazard with two operators using it daily.

**N4 — COST/LATENCY: N+1 KV reads.** `GET /list?full=true` and `GET /prompts` loop a KV `get` per entry (`worker.js:128-133, 154-156`), and `/library` does the same (`sav-viral-scanner.js:1252-1257`). At 100+ entries that's 100+ sequential KV reads per page load, each returning payloads that embed base64 thumbnails (`App.tsx:875-887` stores data-URLs in the item) and triplicated markdown.

**N5 — CLIENT TIMEOUT ORPHANS PAID WORK.** The client aborts at 180s (`App.tsx:851`), but the worker's Flash call + up-to-3 retry chain routinely runs longer. When the client gives up, the completed analysis (already paid for) is discarded — nothing persists it server-side.

**N6 — API key in URL query strings.** Every Gemini call passes `?key=${apiKey}` (`worker-v4.2.0.js:366, 411, 504, 539, 551`; `sav-viral-scanner.js:2076`) — keys leak into any intermediary/log. Google supports the `x-goog-api-key` header.

**N7 — Dependency/manifest rot.** `package.json` is named `react-example` and declares `express`, `better-sqlite3`, `dotenv`, `tsx` — none used by the Vite SPA (`package.json:2,17-19`). Also `motion` is the declared package (`package.json:21`) while code imports `framer-motion` (`App.tsx:26`) — works only via transitive resolution; fragile. Repo root is littered with generated PNG/webp/test artifacts.

**N8 — Trivial-but-real: `saveToLibrary` (manual button) doesn't push to the content library at all** (`App.tsx:923-944` — no `apiPushToContentLibrary` call), so the manual and auto save paths diverge silently. And the "wake server" ping (`App.tsx:760-770`) is a no-op for Cloudflare Workers — leftover from a Render/Railway deployment.

**Keep list confirmed** (matches brief §3): the deployed prompt's analytical structure (§0 camera-first, character-appearance lock `worker-v4.2.0.js:91`, 4-frame extraction `:181-195`, NB→Seedream delta split `:167-179`), the generation rubric (Kling-vs-CDance `sav-viral-scanner.js:1858-1879`, face-forward `:1886-1890`, mandatory SD `:1881-1884`, 12-step NB `:1892-1906`, QA checklist `:1981-1985`), the URL resolvers (`worker-v4.2.0.js:260-328`), the Gemini File API upload/poll helpers (`:502-547`), the content-library field *shape* (`worker.js:36-98`), and the per-prompt copy-button UX.

---

## 2. Target architecture

### 2.1 Components

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND — GitHub Pages (static Vite/React SPA)                │
│  manus-anus-spec.github.io/ugc-/                                │
│  · typed API client generated from shared schema                │
│  · API token entered once, kept in localStorage, sent as header │
└───────────────┬─────────────────────────────────────────────────┘
                │ HTTPS + X-API-Key
┌───────────────▼─────────────────────────────────────────────────┐
│  ugc-api — ONE new Cloudflare Worker (replaces 2½ old ones)     │
│                                                                 │
│  /analyze        resolve URL/file → Gemini File API → Gemini    │
│                  PRO w/ JSON schema → validate → WRITE TO D1    │
│                  (server-side save: client timeout ≠ data loss) │
│  /formats…       library CRUD, tags, search, versions, export   │
│  /generate       FormatDNA + ModelProfile → GenerationOutput    │
│  /profiles…      model-profile CRUD (Sav, Naomi, Niko, …)       │
│  /jobs/:id       poll long analyses                             │
│                                                                 │
│  Bindings: D1 (ugc_library) · R2 (thumbnails, optional) ·       │
│  secrets: GEMINI_API_KEY, RAPIDAPI_KEY, API_TOKENS              │
└───────────────┬─────────────────────────────────────────────────┘
                │
        Gemini API (Pro tier, File API for video, JSON schema out)
```

**Kept:** GitHub Pages hosting; Cloudflare Workers platform; the URL-resolver helpers and File-API upload/poll code ported verbatim into `ugc-api`; the analysis prompt's IP re-expressed as schema-filling instructions; the generation rubric re-expressed as a parameterized template.

**Refactored:** frontend decomposed (§7); analysis becomes typed JSON; save moves server-side.

**Thrown out:** `worker-v4.2.0.js` as a deployment (its good parts are ported); the app-facing routes of `sav-viral-scanner` (`/library`, `/generate-sav-idea`, `/ui`) — the scanner keeps running **untouched** for its Telegram/cron pipeline, we just stop pointing the app at it; the `FORMAT_LIBRARY` KV as a primary store; all client regex parsers; the dead in-App prompt; Sav-hardcoded builders/constants; `sav-content-library` worker retired after migration (its data model lives on in D1).

One worker, not three: every past bug here is a contract-drift bug between components that deploy separately. Colocate the contract.

### 2.2 Storage: move to **D1** (recommendation, with reasoning)

| Requirement (brief §4d) | KV | D1 (SQLite) |
|---|---|---|
| Tag/archetype/hook search & filters | fetch-all + client filter (N+1, N4) | `WHERE`/`JOIN`, FTS5 full-text index |
| Versioning formats | manual key gymnastics | `format_versions` rows, trivial |
| Two operators writing concurrently | index race = silent data loss (N3) | transactions; no index key at all |
| Export / backup | loop every key | one `SELECT`, `wrangler d1 export` |
| Relational split FORMAT DNA ↔ GENERATION OUTPUT ↔ PROFILE | duplicate blobs (current 3× copies) | foreign keys, zero duplication |
| Cost/limits | fine | free tier 5GB, plenty for internal |

KV's only advantage (edge-cached hot reads) is irrelevant for a two-operator internal tool. **D1 it is.** Large JSON bodies (FormatDNA, GenerationOutput) are stored as JSON columns alongside indexed scalar columns — we don't need to normalize beats into rows. Thumbnails: store in R2 with a key on the row (or drop base64 thumbs and just keep the source-platform thumbnail URL — simpler; decide in Phase 3).

D1 schema sketch:

```sql
CREATE TABLE formats (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, archetype TEXT NOT NULL,
  hook_type TEXT, content_rating TEXT, duration_sec REAL, clip_count INTEGER,
  platform TEXT, source_url TEXT, thumb_key TEXT,
  current_version INTEGER NOT NULL DEFAULT 1,
  dna JSON NOT NULL,                -- FormatDNA (current version)
  created_at TEXT, updated_at TEXT
);
CREATE TABLE format_versions (
  format_id TEXT REFERENCES formats(id), version INTEGER, dna JSON, created_at TEXT,
  PRIMARY KEY (format_id, version)
);
CREATE TABLE format_tags (format_id TEXT, tag TEXT, PRIMARY KEY (format_id, tag));
CREATE TABLE profiles (
  id TEXT PRIMARY KEY, name TEXT, version INTEGER, profile JSON, updated_at TEXT
);
CREATE TABLE generations (
  id TEXT PRIMARY KEY, format_id TEXT, format_version INTEGER,
  profile_id TEXT, profile_version INTEGER,
  video_model TEXT, status TEXT DEFAULT 'draft',
  output JSON NOT NULL, created_at TEXT
);
CREATE TABLE jobs (id TEXT PRIMARY KEY, kind TEXT, status TEXT, payload JSON,
  result_format_id TEXT, error TEXT, created_at TEXT, updated_at TEXT);
CREATE VIRTUAL TABLE formats_fts USING fts5(title, archetype, hook_line, why_it_works, tags, content='');
```

---

## 3. The shared schema — the contract

One package, `shared/contract.ts`, imported by the worker (bundled via wrangler/esbuild) and the frontend. **Nobody parses prose, ever.** All Gemini calls set a `responseSchema` derived from these types (zod schemas are the source; `z.toJSONSchema()` feeds Gemini and runtime validation).

```ts
// ─────────────────────────────────────────────────────────────
// shared/contract.ts  ·  schemaVersion 1
// ─────────────────────────────────────────────────────────────
export type Platform = 'tiktok' | 'instagram' | 'youtube' | 'pinterest' | 'upload';
export type ContentRating = 'sfw' | 'borderline' | 'nsfw';

export interface SourceMeta {
  url?: string;
  platform: Platform;
  thumbnailUrl?: string;            // platform thumb or R2 key
  durationSec: number;
  clipCount: number;
  isOneShot: boolean;
  originalHandle?: string;
  analyzedAt: string;               // ISO
  analyzerVersion: string;          // e.g. "ugc-api@1.0.0/gemini-3-pro"
}

// ── Camera language (ports worker-v4.2.0.js §0 — the best IP in the old prompt) ──
export type CameraSetupKind =
  | 'self_held_selfie' | 'mirror_selfie' | 'propped_on_surface'
  | 'third_person' | 'camera_put_down';

export interface CameraSetup {
  setup: CameraSetupKind;
  facing: 'front' | 'rear';
  phoneVisible: 'no' | 'in_mirror' | 'on_surface';
  distance: string;                 // "arm's length ~50cm" | "~1.5m propped"
  heightAngle: string;              // "knee height tilted up 15°" — never default "eye level"
  motion: 'static' | 'micro_shake' | 'drift' | 'put_down_then_static' | 'pan_tilt';
  hiddenArm: 'left' | 'right' | 'none';
  placementNote?: string;           // "inside open fridge looking up"
  transitions?: string;             // cut style between clips
}

export interface Hook {
  type: 'visual' | 'text' | 'question' | 'mid_action' | 'pattern_interrupt' | 'audio';
  openingVisual: string;            // what is literally on screen at 0:00
  firstLineOrText?: string;         // first spoken line or overlay text
  mechanism: string;                // WHY it stops the thumb
  coherenceWithCaption?: string;
}

// ── Beat = the atomic unit of the shot list ──
export interface Beat {
  index: number;
  clipIndex: number;                // which cut it belongs to (0 for one-shot)
  startSec: number;
  endSec: number;
  action: string;                   // on-screen action, action verbs
  rightHand: string;
  leftHand: string;
  cameraMove: string;
  framing: string;                  // "waist-up, subject fills 60%"
  expressionEnergy: string;         // feeling, not facial muscles
  dialogue?: string;
  onScreenText?: string;
  startsOnCut: boolean;
}

export interface FrameSpec {
  frameId: string;                  // "clip0-thumbnail"
  role: 'thumbnail' | 'opening' | 'middle' | 'closing' | 'representative';
  clipIndex: number;
  timestampSec: number;
  justification?: string;           // required for 'middle'
  // Identity-free scene description — the input to every image-prompt compiler.
  scene: {
    framing: string;
    cropBoundaries: string;         // what body part at each frame edge
    subjectPlacement: string;       // position in frame + orientation in degrees
    bodyPosition: string;           // spine/shoulders/head/hips/weight — standing verified
    action: string;
    hands: { right: string; left: string };
    wardrobeVisible: string;        // garments AS SEEN, role-level ("black ruched bodycon mini")
    environmentLayout: string;      // composition map: left/center/right zones, depth, verticals
    lighting: string;               // sources, direction, color temperature, shadows
    colorGrade: string;
    motionState: string;            // static vs mid-action, weight transfer
    fabric: string;                 // texture/behavior/finish
    nsfwElements: string[];         // raw observations; sanitization happens at generation
  };
}

// ─────────────────────────────────────────────────────────────
// FORMAT DNA — durable, model-independent (brief §4a). THE library asset.
// ─────────────────────────────────────────────────────────────
export interface FormatDNA {
  schemaVersion: 1;
  id: string;
  version: number;
  title: string;                    // human name, e.g. "Elevator outfit-check freeze"
  archetype: string;                // 'grwm_voiceover' | 'pov_walk_and_talk' |
                                    // 'transformation_reveal' | 'text_monologue' |
                                    // 'talking_head' | 'skit' | 'outfit_showcase' | free-form
  tags: string[];
  hook: Hook;
  beats: Beat[];                    // beat-by-beat shot list w/ timestamps
  camera: CameraSetup;
  setting: {
    locationType: string;           // ROLE not address: "hotel bathroom, marble"
    timeOfDay: string;
    lighting: string;
    keyProps: string[];
    colorPalette: string;
    mood: string;
  };
  wardrobeRole: {                   // role, never identity
    role: string;                   // "athleisure" | "going-out fit" | "work uniform"
    garments: string[];
    stylingNotes: string;
  };
  pacing: {
    totalDurationSec: number;
    cutCount: number;
    isOneShot: boolean;
    rhythm: string;                 // "cuts every ~0.8s on beat" | "single slow take"
    energy: string;
  };
  audio: {
    kind: 'trending_audio' | 'voiceover' | 'ambient' | 'silent_text_overlay' | 'original_dialogue';
    genre?: string; bpmEstimate?: number; mood?: string;
    voiceoverStyle?: string;
    trendingSoundDependent: boolean;
    syncNotes?: string;             // "cuts land on drops"
  };
  textOverlays: {
    present: boolean;
    cadence: string; placement: string; copyStyle: string;
    hookLine?: string;
    items: { text: string; atSec: number; position: string; style: string }[];
  };
  script?: {
    structure: string;              // "[HOOK]/[BODY]/[CTA]"
    lines: { atSec: number; beatIndex: number; text: string }[];
  };
  whyItWorks: {                     // the teaching layer
    mechanism: string;              // retention/psychological driver
    retentionDrivers: string[];
    targetViewer: string;
    shareCommentTrigger?: string;
  };
  difficulty: {
    environment: 1|2|3|4|5; motion: 1|2|3|4|5; camera: 1|2|3|4|5; overall: 1|2|3|4|5;
    workarounds: string[];
  };
  swapMap: {                        // what makes it THIS format vs what's replaceable
    mustKeep: string[];             // "freeze-frame at 0:02", "text cadence", "propped low angle"
    swappable: string[];            // "identity", "outfit color", "specific hallway"
  };
  contentFlag: { rating: ContentRating; triggers: string[] };
  frames: FrameSpec[];              // identity-free frame specs (4-frame rule for one-shots,
                                    // 3/1 per clip for multi-clip — port of worker §13)
  source: SourceMeta;
  // Analysis-only observation of the original creator — NEVER enters prompts
  // (preserves worker-v4.2.0.js:91 character-appearance firewall structurally):
  characterObservation: { appearance: string; outfit: string; vibe: string };
}

// ─────────────────────────────────────────────────────────────
// MODEL PROFILE — swappable identity (brief §4b). Zero identity elsewhere.
// ─────────────────────────────────────────────────────────────
export type SdFrameType =
  'FULL_FRONT' | 'FULL_SIDE' | 'BACK' | 'UPPER_BODY' | 'HEAD_SHOULDERS' | 'UNIFORM' | 'CONFINED';

export interface ModelProfile {
  schemaVersion: 1;
  id: string;                       // 'sav' | 'naomi' | 'niko-<model>'
  name: string;
  version: number;
  refs: {
    faceSheetId?: string;           // e.g. Sav: 28593900-cd19-4e6f-a470-f9df3d660e8b
    bodySheetId?: string;
    strategy: 'sheet_ids' | 'single_ref_base64';   // Naomi uses NB single-ref+base64
  };
  identityLock: {
    opener: string;                 // "Refer to the girl in the reference images. …"
    closer: string;                 // face-match block, anti-aging clause, alone clause
    strippedDescriptors: string[];  // regexes of identity words to strip if the LLM leaks them
  };
  looks: {                          // keyed looks; format's wardrobeRole.role maps into these
    makeup: Record<string, string>; // { default, uniform, pool, ... }
    hair: Record<string, string>;
    nails?: string;
    wardrobeDefaults: Record<string, string>;   // role → concrete outfit description
    workContextRatio?: string;      // "20-30% uniform / 70-80% off-duty"
  };
  world: {
    locationWhitelist: string[];
    locationBanlist: string[];
    persona: string;                // "young woman who works as a flight attendant"
    audienceICP: string;            // "men 35-50+, American, financially stable"
  };
  voice: {
    captionStyle: string;           // "3-8 words lowercase, 1 emoji max, no apostrophes"
    overlayStyle: string;
    exampleOverlays: string[];
    bannedWords: string[];
    hashtagPool?: string[];
  };
  toolRules: {                      // per-tool prompt-compiler config
    nb:   { structureNotes?: string; bannedPhrases: string[]; mandatoryBlocks: string[] };
    chatgpt2?: { structureNotes: string; bannedPhrases: string[] };
    sd:   { mandatory: true; frameTypeTemplates: Record<SdFrameType, string>; bannedPhrases: string[] };
    video:{ bannedWords: string[];  // "slowly" x1 max, "flash", "phone in hand", …
            cameraLines: Record<CameraSetupKind, string>;
            faceForwardRequired: true;
            confirmedWorkingExamples: string[] };
  };
  contentPolicy: {
    nsfwAllowed: boolean;
    sanitizeMap: [pattern: string, replacement: string][];  // ports scanner:2046-2074
  };
}

// ─────────────────────────────────────────────────────────────
// GENERATION OUTPUT — per (format, profile), regenerable (brief §4a)
// ─────────────────────────────────────────────────────────────
export type VideoModelChoice = 'kling_3' | 'cdance_2';

export interface BeatGeneration {
  clipIndex: number;
  frameId: string;                  // FK → FormatDNA.frames
  timestamp: string;                // "0:00-0:05"
  action: string; camera: string; expression: string;
  dialogue?: string;
  nbPrompt: string;                 // NanoBanana first-frame/still prompt (identity-locked)
  chatgpt2Prompt?: string;          // alt image tool, when requested
  sdPrompt: string;                 // Seedream delta — MANDATORY, never empty
  sdFrameType: SdFrameType;
  motionPrompt: string;             // Kling/CDance clip prompt
  motionPromptCharCount: number;    // enforced ≤310/clip (multi) or 800-1200 (one-shot Kling doc rule)
}

export interface GenerationOutput {
  schemaVersion: 1;
  id: string;
  formatId: string; formatVersion: number;
  profileId: string; profileVersion: number;
  createdAt: string; generatorVersion: string;
  formulaExtracted: string;
  whyItWorksForProfile: string;     // re-aimed at THIS profile's ICP
  creativeBrief: string;
  videoModel: { choice: VideoModelChoice; reason: string };
  faceForwardNote: string | null;   // sequence adjustment, or null
  videoFormat: 'ONE_SHOT' | 'MULTI_CLIP';
  targetDurationSec: number;
  clipCount: number;
  beats: BeatGeneration[];          // per-beat prompts — the portable-prompt payload
  audioPlan: { type: FormatDNA['audio']['kind']; description: string; syncNotes?: string };
  editingNotes: string;
  copy: {
    caption: string;
    hashtags: string[];
    textOverlays: string[];         // 3 options in profile voice
  };
  qaChecklist: { nbChecks: string[]; sdChecks: string[]; videoChecks: string[] };
  status: 'draft' | 'approved' | 'produced';
}

// ── API envelope ──
export interface AnalyzeResponse { job?: { id: string }; format?: FormatDNA; }  // sync or async
export interface ApiError { error: string; code: string; detail?: unknown; }
```

Design notes:
- **The firewall between DNA and identity is structural**: `FormatDNA` has no field where identity *can* live (`wardrobeRole` is a role, `characterObservation` is explicitly quarantined). The old system enforced this with a prompt sentence (`worker-v4.2.0.js:91`); the new one enforces it with types.
- `FrameSpec.scene` is the identity-free version of the old NB prompt content — the generator compiles `scene × profile.identityLock × profile.toolRules` into tool prompts. This is what makes "apply format to ANY model" mechanical instead of an LLM re-roll.
- Everything the brief's §4a lists maps 1:1 to a field. Explicitly NOT stored: raw markdown, `raw` duplicate bodies (the whole class is gone — there is no markdown).

---

## 4. Analysis engine design (per locked decision D1)

**Model id.** Config-driven: `env.GEMINI_MODEL`, default **`gemini-3-pro-preview`**, fallback **`gemini-2.5-pro`**. *Assumption flagged:* as of my knowledge (Jan 2026), Gemini 3 Pro was available as `gemini-3-pro-preview` (Nov 2025 launch) and Gemini 2.5 Pro as stable `gemini-2.5-pro`; by Jul 2026 a stable `gemini-3-pro` alias may exist. **Khian action at Phase 2:** run `GET https://generativelanguage.googleapis.com/v1beta/models` with the project key and set `GEMINI_MODEL` to the best available Pro id (sandbox here blocks network; I cannot verify live). The model id must appear in `SourceMeta.analyzerVersion` on every saved format so we can trace quality regressions.

**Structured output — no prose, ever.**
- `generationConfig.responseMimeType: "application/json"` + `responseSchema` derived from the zod `FormatDNA` schema (minus `source`, which the worker fills itself). Gemini's OpenAPI-subset schema has property-count/nesting limits; if the full DNA schema trips them, fall back to embedding the JSON Schema in the prompt + strict server-side zod validation (Gemini 3 also accepts `responseJsonSchema`, which is roomier).
- `temperature: 0.2`, `maxOutputTokens: 65536`, keep `SAFETY_SETTINGS` BLOCK_NONE (`worker-v4.2.0.js:354-359` ported).
- **Validation replaces the regex-retry circus:** worker zod-parses the JSON. On failure, ONE re-ask that includes the validator's error list ("beats[3].rightHand missing…"). No appended patch sections — the result is either a valid `FormatDNA` or a typed error. The old `validateAnalysis` (`worker-v4.2.0.js:437-472`) is deleted.

**Prompt strategy — port the IP, retarget the output.** The new system instruction keeps, verbatim where possible, the analytical machinery that is genuinely good:
1. §0 camera-setup-first analysis (arm evidence, put-down detection, propped surfaces — `worker-v4.2.0.js:5-39`) → fills `CameraSetup`.
2. Full-video scan + verification discipline ("if you cannot confirm it, write 'not clearly visible'" — `:93-96`) → applies to all `FrameSpec.scene` fields.
3. The internal JSON-first frame breakdown (`:98`) is no longer "internal" — it **is** the output (`FrameSpec.scene` mirrors its fields: camera_precision, body_precision, environment_precision, fabric).
4. 4-frame extraction rules + middle-frame justification (`:181-195`) → `frames[]`.
5. Body-position/rotation verification (`:151-163`) → `scene.bodyPosition/motionState`.
6. NSFW detection criteria (`:50-54`) → `contentFlag` + `scene.nsfwElements` (observations stored raw; sanitization is a *generation-time*, per-profile concern — this fixes the current design where sanitization happens before storage and the real data is lost).
7. NEW sections the old prompt lacked, required by the DNA: `whyItWorks` (mechanism/retention — currently only a thin §18), `swapMap` (new), `hook.mechanism` (deeper than §12), `beats[]` (the old §7 action breakdown, but timestamped and typed).

Crucially, the analyzer **no longer writes any tool prompts**. NB/SD/Kling prompt text moves entirely to the generation step (§5). The analyzer's job is perception → DNA. This halves output size (the old 18-section output with 8 NB+SD prompts routinely blew the token budget — the root cause of the retry cascade) and stops baking Sav-era prompt rules into stored analyses.

**How video is fed.**
- Uploads + resolved TikTok/IG/Pinterest URLs: keep the File API multipart upload + `pollUntilActive` + cleanup helpers exactly as-is (`worker-v4.2.0.js:502-553`) — they are correct. Switch key from query param to `x-goog-api-key` header (fixes N6).
- YouTube: keep direct `fileData.fileUri` passthrough (`worker-v4.2.0.js:641-643, 720-721`).
- Request `mediaResolution: MEDIA_RESOLUTION_HIGH` for ≤60s clips — the frame-level fabric/crop detail is the entire point of paying for Pro.

**Long-form handling (the Higgsfield 15s-cap wedge).**
- ≤90s (almost all Reels/TikToks): single pass, high resolution.
- >90s: two-pass. Pass 1 (default resolution): segmentation only — returns `beats[]` skeleton + cut list + audio/script map (cheap). Pass 2: for each contiguous ~60s window, a deep pass using `videoMetadata: { startOffset, endOffset }` clipping on the same uploaded file, filling `frames[]` + per-beat detail for that window. Worker merges by beat index. This keeps per-call attention dense — the documented failure mode of both Higgsfield and long-context video models.
- Long analyses run as **jobs**: `POST /analyze` returns `202 {job:{id}}` when estimated work >60s; client polls `GET /jobs/:id`. Short clips return synchronously. Either way **the worker writes the finished FormatDNA to D1 itself before responding/completing** — fixing N5 (client timeout can no longer orphan a paid analysis) and N2/N8 (no client-side save path to silently fail).

**URL ingestion fixed.**
- One canonical multipart contract: field `videoUrl` (string) or `video` (file) — and the shared contract exports the field names as constants so the frontend literally cannot drift again (`import { ANALYZE_FIELDS } from shared`).
- Frontend `isValidUrl` replaced by a platform-detect function in `shared/` that includes `instagram.com`/`instagr.am` (fixes the S4 second break) and mirrors the worker's resolver list one-to-one.
- Resolvers ported unchanged: tikwm (`worker-v4.2.0.js:260-273`), RapidAPI IG (`:275-298`), Pinterest scrape (`:300-328`).

**Cost estimate (sanity):** a 30s 720p video ≈ 8-15k input tokens at default sampling (~2-4× at high media resolution) + ~8k output. On Pro-tier pricing this is dimes per analysis, not dollars — two orders of magnitude under a Higgsfield credit. Fine for internal volume; revisit batching if productized.

---

## 5. Generation design (FormatDNA × ModelProfile → per-tool prompts)

> **ADDENDUM (locked with Khian 2026-07-21) — generation = IDEATION, not clone.** The output is a NEW treatment, not a shot-for-shot rebuild with a swapped face. Layer 2 must PRESERVE the `whyItWorks` mechanism + `swapMap.mustKeep` (the ~80% that made it work) and DELIBERATELY REINVENT `swapMap.swappable` into fresh content for the profile. `/generate` returns **~3 distinct ideations** per (format, profile) — "the different ways you could make this video" — as an array; the operator picks the winner. Add a `variationStrength` knob (close-but-fresh → bold) defaulting to close-but-fresh. Success test: original video, same scroll-stopping mechanism. This supersedes any "faithful reconstruction" reading of the beat-by-beat compiler below — the Layer-1 scaffold still guarantees the non-negotiable rules (identity lock, mandatory SD, face-forward, banned-words), but the beats themselves are re-imagined within the blueprint, not transcribed.

**Endpoint:** `POST /generate { formatId, profileId, tools?: ('nanobanana'|'chatgpt2'|'seedream'|'kling_3'|'cdance_2')[] }` → `GenerationOutput`, persisted to D1 `generations` and returned. Regenerable at will; history kept (the durable asset is the DNA, per the brief).

**Two-layer compiler — deterministic frame, creative fill:**

*Layer 1 (pure TypeScript, no LLM):* assembles the non-negotiables so the LLM can't drop them —
- NB prompt scaffold: `profile.identityLock.opener` + "Raw iPhone footage aesthetic" + camera line compiled from `dna.camera` via `profile.toolRules.video.cameraLines` mapping + `scene.*` fields in the proven 12-step order (`sav-viral-scanner.js:1892-1904` becomes a template with profile-injected makeup/hair/nails/closer) + `profile.identityLock.closer`.
- SD prompt: `profile.toolRules.sd.frameTypeTemplates[frameType]` — **mandatory for every beat**, enforced by the type system (`BeatGeneration.sdPrompt` is non-optional), preserving the never-skip-SD law (`sav-viral-scanner.js:1881-1884`).
- Rule engines preserved as code, not prose:
  - **Kling-vs-CDance selection** (`:1858-1879`): implemented as a decision function over DNA — `needsDialogueOrLipSync(dna.script/audio) || dna.pacing.cutCount>1 with transitions || emotionalRangeHigh → cdance_2; else kling_3` — with the LLM asked only to write the `reason`. Deterministic, auditable, and matches the existing rubric exactly.
  - **Face-forward rule** (`:1886-1890`): code inspects `dna.beats[0]`/`frames[opening].scene.subjectPlacement`; if the subject opens facing away, the beat sequence is re-ordered/adapted and `faceForwardNote` is set. Non-negotiable, so it's code.
  - **Banned-word linting**: post-generation lint of every motion prompt against `profile.toolRules.video.bannedWords` (max one "slowly", no "flash", no "phone in hand" — `:1922`) and char-count enforcement (≤310/clip); violations trigger a targeted rewrite ask, then hard-fail visibly (never silently pass junk).
- Sanitization moves here: `profile.contentPolicy.sanitizeMap` (ports `:2046-2074`) applied to the *LLM input*, while the stored DNA keeps raw observations.

*Layer 2 (one Gemini Pro call, `responseSchema = GenerationOutput` creative subset):* fills what genuinely needs judgment — beat adaptation to the profile's world (location remap via `world.locationWhitelist`, wardrobe remap via `looks.wardrobeDefaults[dna.wardrobeRole.role]`), scene-specific action phrasing, `copy.*` in the profile's `voice`, audio plan adaptation, QA checklist items. The prompt receives the **typed DNA JSON** (not a flattened text blob — the current flattening at `sav-viral-scanner.js:2001-2035` loses structure) plus the **ModelProfile JSON**.

**How the Sav-only generator is parameterized:** every Sav literal in `SAV_IDEA_SYSTEM_PROMPT` maps to a profile field — "creator called Sav"→`profile.world.persona`; audience→`world.audienceICP`; locations→`world.locationWhitelist/Banlist`; makeup/hair steps 5-7→`looks.*`; overlay examples→`voice.exampleOverlays`; confirmed working prompts→`toolRules.video.confirmedWorkingExamples`; the 12-step closer→`identityLock.closer`. Ship three seed profiles: **sav** (values lifted verbatim from `sav-viral-scanner.js:1849-1932` + `SAV_BASE_PROMPT:44-46` + sheet ids `:41-42`), **naomi** (single-ref+base64 strategy per her face-sheet method), **niko-default** (template for Niko's models). The `model` selector bug dies because `/generate` *requires* `profileId` — there is no default identity to fall back to.

**ChatGPT-2 image prompts:** same `FrameSpec.scene` compiled through a different template (`toolRules.chatgpt2`) — ChatGPT-2 tolerates longer, more narrative prompts and different ref-image phrasing. Template content is an open question for Khian (§9-Q4).

---

## 6. Library + auth

**Single source of truth:** D1 `formats` (+`format_versions`, `generations`, `profiles`) behind `ugc-api`. The `FORMAT_LIBRARY` KV and `sav-content-library` worker are retired after migration. The one legitimate external consumer of the old `/prompts` endpoint — "both operators' Claudes read each session" (`worker.js:5-6`) — is preserved as `GET /export/briefs?model=…` returning the same complete-brief shape, now assembled from DNA + latest generation per format.

**Tagging/search:** `format_tags` + FTS5 across title/archetype/hook/why-it-works/tags. Filters: archetype, hook type, content rating, profile-has-generation, duration bucket. All server-side SQL — no fetch-everything.

**Versioning:** editing a format's DNA (manual corrections are expected — the teaching loop) bumps `version` and snapshots the old row into `format_versions`. `generations` pin `(formatVersion, profileVersion)` so an old output remains explainable.

**Export:** `GET /export/json` (full dump), `GET /formats/:id/export?fmt=markdown` (readable brief: DNA + prompts per profile — the transparency wedge vs Higgsfield's black box), and `wrangler d1 export` for cold backup (Khian-run, monthly).

**Auth (fixes world-writable):**
- Static-host-compatible scheme: `X-API-Key` header checked against a `hashedTokens` list in worker secrets. Two tokens (khian, niko) so either can be revoked alone. Frontend prompts once, stores in `localStorage`, attaches on every call. Never baked into the public bundle (that would be equivalent to no auth — see N1).
- ALL routes require it, including reads (`/export/briefs` consumers = operator Claudes, which hold a token in their session config).
- CORS allowlist: `https://manus-anus-spec.github.io` + localhost dev ports (pattern from `worker-v4.2.0.js:334-338`), understanding CORS is a courtesy, not the security boundary — the token is.
- Rate-limit mutations lightly (worker-level counter) as poison-control.

---

## 7. Frontend decomposition

Target: `App.tsx` ≈ 80 lines of shell. No regex, no prompt-building, no identity anywhere in the client.

```
src/
  shared/                      ← the contract package (symlinked/workspace with worker)
    contract.ts  zodSchemas.ts  platform.ts (URL detect)  fields.ts (multipart names)
  config.ts                    ← API base URL (one, not three)
  api/
    client.ts                  ← fetch wrapper: auth header, typed errors, timeouts
    analyze.ts  formats.ts  generate.ts  profiles.ts  jobs.ts
  hooks/
    useAuthToken.ts            ← localStorage token gate
    useAnalyze.ts              ← upload/url → job polling → FormatDNA
    useLibrary.ts              ← list/search/filter/delete (server-side queries)
    useGenerate.ts             ← (formatId, profileId) → GenerationOutput
    useClipboard.ts
  components/
    layout/  Header.tsx  TabNav.tsx  Footer.tsx  Toast.tsx
    analyze/ SourcePicker.tsx (upload+URL, drag-drop)  ProgressSteps.tsx
             DnaReport.tsx (typed renderer: Hook, Beats timeline, CameraSetup,
             WhyItWorks, SwapMap, Frames grid — replaces the markdown wall)
    library/ FormatList.tsx  FormatCard.tsx  FilterBar.tsx  TagEditor.tsx
             VersionHistory.tsx  ExportMenu.tsx
    generate/ ProfileSelect.tsx (reads /profiles — replaces hardcoded Sav|Naomi
              select at App.tsx:1005-1013)
              GenerationView.tsx  BeatPromptCard.tsx (NB/SD/motion + copy buttons,
              char counts — ports the good UX from App.tsx:1499-1558)
              ProductionBrief.tsx  QaChecklist.tsx  CopyBlock.tsx
  App.tsx                      ← shell: token gate → tabs → routes
```

Deleted from the client: `extractSection`/`extractNBPrompt`/`extractKlingPrompt`/`extractAllKlingPrompts`/`extractHookText`/`extractVideoMeta`/`detectFormatType` (`App.tsx:245-354`), `FORMAT_OVERLAYS`/`FORMAT_CAPTIONS`/`SAV_NB_RULES`/`buildSavNBPrompt`/`extractSDPrompt`/`buildSavKlingPrompt`/`generateSavPrompts` (`:357-516`), dead `SYSTEM_INSTRUCTION` (`:532-652`), the triple-endpoint config (`:31-33`), the wake-server ping (`:760-770`). Kept: frame-extraction canvas helpers (`:683-758`) *only if* we decide to keep client thumbnails (Phase 3 decision) — they are no longer needed for analysis since the server sees the full video.

Also in this phase: fix `package.json` (name, drop express/better-sqlite3/dotenv, declare `framer-motion` properly), remove the `define: process.env.GEMINI_API_KEY` from `vite.config.ts` (N1), stop committing `dist/` and stray build artifacts.

---

## 8. Migration / sequencing

Ordered for **fastest working end-to-end slice** (analyze → DNA in D1 → visible in UI), each phase independently testable. 🔑 = needs Khian (deploys/secrets/network — sandbox here can't reach the network).

**Phase 0 — Stop the bleeding (½ day, ships independently)**
1. Rotate the Gemini key if any published `dist/` ever contained it; remove `vite.config.ts` `define` (N1). 🔑 key rotation.
2. Two-line hotfix so the current app limps usefully while we build: `App.tsx:847` `'url'`→`'videoUrl'`; add `instagram.com` to `isValidUrl`. 🔑 Pages redeploy.
3. Snapshot both KV namespaces to JSON (`wrangler kv key list/get` script) — migration input + backup. 🔑 wrangler.
- *Test:* paste a TikTok + an IG URL into the live app → analysis returns.

**Phase 1 — Contract + worker skeleton + D1 (1-2 days)**
1. Create `shared/` (zod schemas → TS types → JSON Schemas). This document's §3 is the spec.
2. Scaffold `ugc-api` worker: router, auth middleware, CORS, D1 schema migration file, `/health`.
3. Write the KV→D1 migration script: old `LIBRARY` entries → best-effort DNA (structured fields are junk per S2, so map `full_analysis`→a `legacy_markdown` note field + source meta + tags; old items remain readable, flagged `schemaVersion: 0-legacy` for optional re-analysis).
4. 🔑 Khian: `wrangler d1 create ugc_library`, set secrets (`GEMINI_API_KEY`, `RAPIDAPI_KEY`, `API_TOKENS`), deploy, run migration.
- *Test:* `curl` CRUD with/without token; migrated entries listable; delete rejected without token.

**Phase 2 — Analysis engine (2-3 days) ← the heart**
1. Port resolvers + File API helpers; implement `/analyze` (sync ≤90s path first) with responseSchema, zod validation, one error-guided re-ask, server-side D1 save.
2. 🔑 Khian: verify live Pro model id (`ListModels`), set `GEMINI_MODEL`.
3. Golden tests: 3 reference videos with known ground truth (one selfie one-shot, one propped multi-clip, one mirror-selfie NSFW-borderline). Assert: camera setup correct, beat count ±1, cut timestamps ±0.5s, contentFlag correct, all schema fields non-empty-where-visible. This is the "does Pro + schema beat Flash + regex" gate — **do not proceed until it clearly does.**
- *Test:* `curl -F videoUrl=… /analyze` → valid FormatDNA in D1.

**Phase 3 — Frontend slice (2 days)**
1. Decomposition per §7; token gate; SourcePicker → useAnalyze → DnaReport; library list/filter/delete against `/formats`.
2. Decide thumbnails (recommend: platform thumbnail URL only; no base64, no R2 for v1).
3. 🔑 Pages deploy. **End-to-end slice complete** — the app now analyzes deeply and saves essentials, on any model-agnostic video.
- *Test:* full manual run-through on the 3 golden videos + 1 fresh IG reel.

**Phase 4 — Profiles + generation (2-3 days)**
1. Seed sav/naomi/niko-default profiles (values per §5); `/profiles` CRUD.
2. Layer-1 compiler (templates + rule engines + linter) with **unit tests** (pure functions — fully testable in sandbox: face-forward reversal, Kling/CDance decision table, banned-word lint, char caps, SD-mandatory).
3. Layer-2 Gemini call; `/generate`; GenerationView UI.
- *Test:* same format generated for sav vs naomi → prompts differ ONLY in profile-derived content (diff harness); "Naomi→Sav bug" regression test.

**Phase 5 — Long-form + exports + polish (1-2 days)**
Jobs table + async `/analyze` for >90s; two-pass segmentation; `/export/*`; version history UI; FTS search box.
- *Test:* 3-min YouTube video → coherent beat map; export/brief endpoints consumed by an operator-Claude session.

**Phase 6 — Decommission (½ day)** 🔑
Point nothing at `ugc-worker`/`sav-content-library`; freeze KVs read-only for 2 weeks; then delete worker + namespaces. Strip `/library`, `/generate-sav-idea`, `/ui` routes from `sav-viral-scanner` (its Telegram/cron pipeline continues untouched — verify a cron run after the strip). Final KV export archived.

Total: ~8-11 working days of build, with a usable end-to-end slice after Phase 3 (~5 days).

---

## 9. Risks + open questions

**Risks**
1. **Pro-tier refusals on borderline content.** Pro models enforce safety more aggressively than Flash even with BLOCK_NONE, and the *analysis input* (the video itself) can trip `PROHIBITED_CONTENT` input filtering that safetySettings don't override. Mitigation: contentFlag-aware retry (if input-blocked, retry analysis at lower media resolution / with framing instruction); worst case, borderline videos get a reduced-depth DNA. Test in Phase 2 goldens (one borderline video included deliberately).
2. **responseSchema size limits.** FormatDNA is a big schema; Gemini's OpenAPI-subset has property-count limits. Mitigations in order: `responseJsonSchema` (Gemini 3), split into two calls (DNA core, then frames[]), or prompt-embedded schema + zod-only validation. Decided empirically in Phase 2.
3. **Model id drift** (assumption flagged in §4). Config-driven + recorded per row; 10-minute swap if naming differs.
4. **Worker CPU/duration ceilings** on long two-pass analyses. Gemini calls are I/O-wait (cheap CPU), and the jobs pattern bounds each request; if a single fetch still bumps limits, chain via `waitUntil` continuation writing job state to D1.
5. **Migration quality:** old library entries have junk structured fields (S2); they migrate as legacy-markdown entries, not clean DNA. Anything worth reusing should be **re-analyzed** through the new engine (cheap now). Set expectation: the old library is an archive, not a foundation.
6. **Prompt-IP regression risk:** moving from "LLM writes NB prompt while watching video" to "compiler assembles prompt from FrameSpec" could lose visual nuance if FrameSpec fields are too coarse. Mitigation: FrameSpec.scene deliberately mirrors the old internal-JSON fields 1:1 (`worker-v4.2.0.js:98`); golden-test A/B in Phase 4 (compiled prompt vs old-style prompt on the same video, generate both on NB, eyeball).
7. **Two operators, one token each — no per-user data separation.** Fine for internal; productizing later means real auth (Cloudflare Access or tokens-per-tenant) — the D1 schema takes a `tenant_id` column now (default 'aruna') so that door stays open cheaply.
8. **tikwm/RapidAPI resolver fragility** (third-party scrapers break periodically). Keep the file-upload path first-class as the always-works fallback; resolver failures must return actionable errors, not silent "no video."

**Open questions for Khian**
- **Q1:** Confirm live Gemini Pro model id + that the account has Pro-tier quota (Phase 2 gate).
- **Q2:** Thumbnails — platform thumbnail URL only (my recommendation), or R2-stored extracted frames?
- **Q3:** Should `/export/briefs` keep the exact old `sav-content-library` `/prompts` field names for the operator-Claude sessions, or may those session prompts be updated to the new shape? (Cheaper to update the sessions; I'll keep a compat mapping if not.)
- **Q4:** ChatGPT-2 image prompting — do you have a known-good prompt structure/example from Niko's pipeline to seed `toolRules.chatgpt2`? Otherwise I'll draft one and we calibrate in Phase 4.
- **Q5:** Niko's model profile values (face-ref strategy, locations, voice) — needed to seed `niko-default` beyond a stub.
- **Q6:** Keep Pinterest support? It's ~70 lines of scrape heuristics (`worker-v4.2.0.js:300-328`); zero mentions in the brief's workflows. I'd port it (free) but not test it.
- **Q7:** GitHub Pages repo/account (`Manus-anus-spec/ugc-`) — staying, or moving to an Aruna-owned org? Affects the CORS allowlist and is a good moment to fix ownership.

---

*Plan ends. No code has been written. On sign-off, Phase 0 + Phase 1 can start immediately; Phases 0-2 items marked 🔑 need Khian at the keyboard for deploys, secrets, and the live model-id check.*
