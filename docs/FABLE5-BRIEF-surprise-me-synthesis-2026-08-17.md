# FABLE 5 BRIEF — "Surprise me" synthesis: fix the sameness bug + make the app smarter

**Date:** 2026-08-17 · **Author:** Khian (via Claude) · **Scope:** worker API (`worker/src/routes/generate.ts`, `worker/src/generate/prompt.ts`) + a broader app-improvement investigation.

**One-line:** The ✨ Surprise-me button gives the same kind of idea every time (for Belle it's always the "feral" POV) because the source selection is fully deterministic — it fuses the *same 3 formats* on every press, for every model, ignoring the other 37 in the library. Fix the selection, then investigate how to make the whole app genuinely learn from ALL the data.

---

## PART 1 — THE BUG (root cause, already diagnosed — verify then fix)

### What the user sees
Press "Surprise me" for Belle → almost always a "feral Hinge-date POV"-flavoured idea. Different models, same problem. It feels like the app only has one idea.

### Root cause (confirmed against the live library, 40 formats)
The surprise-me path calls `selectTopFormatIds(env, n)` in `worker/src/routes/generate.ts:200`:

```sql
SELECT id, format_type FROM formats
WHERE schema_version != '0-legacy' AND virality_score IS NOT NULL
ORDER BY virality_score DESC LIMIT 24
```
…then a two-pass archetype-dedupe that stops at `n` (`SYNTHESIS_SOURCE_COUNT = 3`).

**There is no randomness anywhere in it.** It returns the identical 3 ids on every call, for every profile (the function doesn't even take `profileId`). Against the current library that is deterministically:

| # | Always selected | Type | Score | Role |
|---|---|---|---|---|
| 1 | The 'Show Me' Store Reveal | skit | 82 | **anchor** (`dnas[0]` → sets aesthetic defaults downstream) |
| 2 | POV Asian Girl Noodle Thirst Trap | thirst_trap | 82 | source |
| 3 | **Feral Hinge Date POV** | pov | 75 | source |

Then `SYNTHESIZE_DIRECTIVE` (`prompt.ts:35`) instructs the model: *"Pick the single strongest scroll-stop HOOK mechanism as the spine."* Of those three the Feral Hinge Date POV has the most distinctive hook → the model keeps choosing it as the backbone → **"always feral."**

### Three compounding causes
1. **Deterministic selection** (primary) — same 3 sources every press. Same fuel in → same idea out.
2. **Frozen anchor** — `dnas[0]` is always the Store Reveal, and the anchor supplies aesthetic defaults (`loadSynthesisSources`, `generate.ts:221`; used as aesthetic anchor per the synth branch in `runSingleVariant`), so visual sameness too.
3. **No breadth, no memory, no profile-awareness** — only 3 of 40 formats are ever used; it doesn't know what it produced last time, and it can't bias toward a profile's lane/away from a bad fit.

### Fix (worker-only, contained to `selectTopFormatIds` + a small threading change)
Turn selection from "always the top 3" into a **fresh weighted random draw from the whole high-scoring library on every press**:

1. **Randomize the draw.** Pull a wide candidate pool (e.g. top 20–24 by score, or all non-legacy scored formats), then sample 3–4 with weighting toward higher `virality_score` (so quality still matters, but the *combination* changes every time). Cloudflare Workers can use `Math.random()` / `crypto.getRandomValues` freely.
2. **Rotate the anchor.** Pick `dnas[0]` randomly from the drawn set — don't always let the same format set the aesthetic.
3. **Force archetype spread.** Keep the "different `format_type` per source" guarantee so it fuses *mechanisms*, not near-duplicates.
4. **Don't-repeat memory (stronger, optional in same pass).** `GenerationRun.sourceFormatIds` is already persisted (`generate.ts:463`). Query the last 1–2 surprise-me runs *for that profile* and exclude those source sets → it can't hand back the same trio twice in a row. This makes it profile-aware for free.
5. **(Consider) widen `SYNTHESIS_SOURCE_COUNT`** to a random 3–4 so fusions vary in richness too.

**Acceptance test:** call the surprise-me endpoint ~6× for `profileId=belle`, assert the returned `sourceFormatIds` sets are NOT all identical and that archetypes vary; eyeball that the 3 ideations are no longer all POV-date-feral. Keep reproduce/adapt paths untouched (the bug is synthesize-only). `tsc` + `scripts/compiler-tests.ts` green.

---

## PART 2 — INVESTIGATE: "how do we use ALL our brain?" (the real ask)

The user's framing: *"if it's only getting information from one video idea, how do we use all of the data — how do we use all of our brain in this scenario?"* Part 1 stops the sameness; this part is the open-ended R&D Khian wants Fable 5 to own. Deliver findings + a proposed design (don't just code blindly):

- **Retrieval quality.** Right now it's `ORDER BY score`. Should surprise-me instead retrieve a *diverse, representative* sample across the whole library (archetype coverage, hook-type coverage, recency of ingestion), so a fusion can pull mechanisms the top-3 never expose? Consider clustering by `formatType`/`hook.type` and sampling one from each cluster.
- **Profile-fit scoring.** Should selection be biased by the target profile (e.g. Belle's world/persona) so fused ideas land in her lane without hard-restricting her? Soft weighting, not filtering.
- **Feedback loop (FABLE5 §11, deferred).** There's no "was this fused idea good?" signal. Design the thumbs-up/down → score → future-selection-weight loop so the app actually *learns* which fusions perform. This is the highest-leverage improvement.
- **Coverage telemetry.** Log which formats have never been used as a synthesis source; surface "unused brain" so we know we're actually drawing from everything.
- **Anything else** Fable 5 spots while in the code — treat this as a general app-improvement pass and log findings to `docs/APP-IMPROVEMENT-LOG.md`.

---

## PART 3 — CONTEXT / GUARDRAILS
- Downstream enforcement (humanization, Seedance-lean, GPT-image moderation-safe) applies to synthesize automatically — don't regress it.
- The "surprise me" button lives in `src/components/generate/GenerateView.tsx`; API client `synthesizeIdeations()` in `src/api/index.ts`. Frontend likely needs no change for Part 1.
- Do NOT touch reproduce/adapt single-source paths.
- Belle's *profile* is being loosened separately (by Claude, same day) to give her a broader environment + wardrobe range — that's a data change, unrelated to this code fix. The two together should end the "same 3 places, same feral idea" feeling.
- Log every finding + change to `docs/APP-IMPROVEMENT-LOG.md` (running numbered list) and reference this brief.
