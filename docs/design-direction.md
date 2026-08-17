# UGC Reverse-Engineer — Design Direction (Phase 3 proposal)
*Fable 5 · 2026-07-22 · awaiting Khian sign-off before any UI is built*

## Mood — "edit suite, not gamer den"
This is a bench instrument for dissecting virality and rebuilding it: dark, calm, precise,
one signal color. Data-dense where you scan (library, beats), generous where you read
(whyItWorks — the teaching layer gets typographic room). Reference feel: Linear's restraint
× a color-grading suite's focus. The current violet theme reads crypto/gamer; video
thumbnails are the app's real color, and they pop hardest against a neutral graphite stage.

## Palette — APPROVED 2026-07-22 (Khian's reference image: Classic Black / Golden Pitch / Power Orange / Off White)
| Role | Value | Notes |
|---|---|---|
| Canvas "Classic Black" | `#0C0B09` | warm near-black |
| Surface / raised | `#171510` / `#1F1C15` | warm olive-black cards, rails |
| Hairline | `#2C2921` | 1px borders, no glows |
| "Golden Pitch" | `#3E3A2C` | strong borders, hover states, muted chips |
| Text "Off White" | `#EDEAD9` / `#9C978A` | primary / secondary (warm cream, not blue-white) |
| **Accent "Power Orange"** | `#E8541E` | THE signal — primary actions, active nav, progress, focus. Used nowhere else |
| Rating badges | sfw `#86B97E` · borderline `#E5A83B` · nsfw `#D94F63` | crimson (not orange-red) so nsfw never collides with the accent |
| Archetype chips | stable muted warm hue per archetype | scannable library taxonomy |

## Type
- **UI:** Inter (or Geist) — tight, neutral.
- **Payload:** JetBrains Mono for prompts, timestamps, char counters, ids. Prompts are
  copy-paste artifacts; mono says "this is the deliverable".

## Layout
- **Slim left rail:** Analyze · Library · Generate · Profiles + API health dot.
- **Analyze:** one centered intake (URL paste + drag-drop unified). On submit it becomes a
  live progress rail — Resolve → Upload → Watch (Pro) → Validate → Saved — then the DNA
  report renders in place. Errors show the API's typed code verbatim (transparency wedge).
- **DNA report:** sticky left column (frames grid + source meta); right column as cards:
  Hook · **WhyItWorks (first-class, biggest type)** · SwapMap as two-column KEEP/SWAP ·
  Beats as a horizontal scrubbable timeline · Camera as a spec block · everything else
  collapsible below.
- **Library:** filter bar (archetype / rating / tag / search) over a dense card grid —
  thumbnail, title, archetype chip, difficulty dots, rating badge.
- **Generate — the money screen:** profile picker → **3 ideation cards side by side**
  (title, angle, kept/reinvented chips); picking the winner expands beat-by-beat prompt
  cards — NB / SD / Motion tabs, copy button with tick feedback, live char counter against
  the 310 cap — ending in the QA checklist.

## Interaction grammar
Copy-everything with feedback · `/` focuses search, `⌘↵` analyzes · toasts bottom-right ·
skeletons not spinners · zero decorative animation; motion only where state changes.
