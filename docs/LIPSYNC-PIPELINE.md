# Lip-Sync Production Pipeline (July 2026)

How we turn a still frame (NanoBanana → Seedream) + an audio track into a lip-synced
UGC video. The Generate tab embeds a per-ideation **lip-sync plan** using these routes;
this doc is the full playbook behind it. Research basis: OmniHuman 1.5, Kling
Avatar/Lipsync, Seedance 2.0 Omni audio-refs, sync.so, surveyed 2026-07-24.

## The two patterns

**Pattern A — silent video first, then mouth retiming** (`clip + audio → retimed clip`)
Generate the clip with the normal motion prompt (Kling), THEN apply lip-sync as a
video-to-video mouth edit. Use when: face consistency is critical (the clip already
passed face QA — mouth-only editors like sync.so cause near-zero face drift), the
visual is borderline/NSFW (retimers moderate lightly; avatar models reject), or the
mouthing is brief trend-mouthing where $0.03–0.05/s beats $0.16/s.

**Pattern B — image + audio straight to talking video** (`frame + audio → acting clip`)
One call generates speech-matched gestures, head motion, and emotional acting.
Use for real scripted dialogue and singing — a retimer can never add performance.
Cost: whole-face re-render every frame → **face-match QA against the face sheet is
mandatory** (Belle QA loop applies unchanged).

## Decision table

| Audio kind | Route | Steps | ~Cost /10s |
|---|---|---|---|
| **Trending audio (mouthing)** | A: Kling clip → **sync/lipsync-2** (WaveSpeed) | NB frame → SD pass → silent Kling clip (motion prompt) → lipsync-2 with trimmed audio → export MUTED → attach official sound in-app | $0.50 + Kling |
| **Scripted dialogue** | B: **OmniHuman 1.5** (WaveSpeed `bytedance/avatar-omni-human-1.5`) | Script → VO (Seed Audio clone on Higgsfield / ElevenLabs) → frame + audio → face-match QA | $1.60 |
| Dialogue inside an action scene / 2 characters | **Seedance 2.0 Omni** audio-ref (Higgsfield) | Feed audio as black-video+audio ref, prompt "@character speaks @audio", 4–15s, re-mux original audio over output | credits |
| Long talking-head (≤1 min) | **Kling AI Avatar v2** (Higgsfield app) | frame + audio → 1080p/48fps. Input moderation is STRICT — no swimwear frames | $0.56–1.15 |
| **Singing / rap** | B: OmniHuman 1.5 (its signature strength) | as dialogue; fallback = energetic silent Kling clip → **lipsync-2-pro** | $1.60 / $0.80 |
| **Borderline/NSFW visual** | A ONLY: existing Seedream visual → sync/lipsync-2 | never through Kling/HeyGen avatar paths (input rejection) | $0.50 |

Price ladder (per second): kling-lipsync $0.03 · veed $0.03 · lipsync-2 $0.05 ·
Kling Avatar std $0.056 · lipsync-2-pro $0.07–0.08 · Kling Avatar pro $0.115 ·
OmniHuman 1.0 $0.12 · OmniHuman 1.5 $0.16. All on WaveSpeed/Higgsfield — no new vendors.

## Trending-audio workflow (the standard play, start to finish)

1. **Rip the sound**: ssstik/SnapTik on the source TikTok → `ffmpeg -i in.mp4 -vn audio.mp3`.
   Trim to the exact mouthed segment (7–15s). This file is only a generation reference.
2. **Generate**: run the route from the table with that trimmed file.
3. **Post (critical)**: export the final video **MUTED** → upload → attach the **official
   trending sound in the TikTok/IG editor**, drag its start point until it aligns with
   the mouth. The post then registers under the trend's sound page (algorithm
   distribution) instead of "original sound", and uses the platform-licensed track.
   Never leave baked-in audio + attached sound together — double audio gets flagged.

## Realism rules (bake into QA)

- **Face-drift ranking (best→worst):** lipsync-2-pro → lipsync-2 → kling-lipsync →
  OmniHuman 1.5 → Kling Avatar → Seedance audio-ref. Anything right of kling-lipsync
  re-renders the face → run the face-match QA loop.
- Keep mouthed clips **≤15s** (20s+ is where mouths and gesture loops betray AI).
- Face within ~30° of camera; mouth never occluded (hands, cups, mics at the lips = failure).
- Dialogue audio must be a clean vocal (no music bed — retimers chase the beat).
  For music trends, lipsync-2-pro copes best.
- Feed ≥1080px face crops; low-res input faces = uncanny mouth.
- Seedance sometimes resamples the reference audio — always re-mux the original file
  over its output (CapCut/ffmpeg) before the mute-and-post step.
- Veo 3.1 and Kling native-audio generate their OWN speech from a prompt and cannot
  ingest your audio file — wrong tools for this pipeline.
