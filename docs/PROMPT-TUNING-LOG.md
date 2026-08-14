# Prompt Tuning Log — learning how Seedance 2.0 & GPT-image-2 like to be talked to

Running record of `prompt → model → real outcome → fix`. The goal: accumulate enough
real generations (with Khian/Niko's verdict on how the video/image actually came out)
that the app can **one-shot** good prompts, and recurring failures become permanent
rules/lint. This is the manual first version of the Part 11 feedback loop.

**How we run it:** Khian generates (or Claude generates via the WaveSpeed key), we log
the exact prompt + the outcome + the diagnosis + the fix, and re-test. Patterns that
repeat get promoted into `rules.ts` (deterministic) or `prompt.ts` (instruction).

---

## Standing findings (research, 2026-08-14 — sourced)

### Seedance 2.0 — WE ARE OVER-PROMPTING (confirmed)
2.0 changed how it parses: it wants **intentional**, not stacked. Current best practice:
- **2–3 clear sentences, ~60–100 words.** "Adjective soup" and "too many action beats
  in one shot" are top failure modes → generic/flat or dropped beats.
- **ONE primary camera instruction.** Multiple/conflicting camera terms → jitter.
- **≤3–6 negatives, one closing line.** More = model wastes budget rejecting instead
  of rendering. Long ban lists backfire.
- **"no smoothness / no stabilization" is largely OBSOLETE in 2.0** (a 1.x workaround;
  2.0 separates camera vs subject motion natively). Keep at most one handheld cue.
  ⚠️ *A/B test before ripping out — one prompt library still uses it.*
- **Dialogue = double quotes + delivery tone** ("dry, a little proud"), NOT curly braces.
  Our app currently emits `{curly}` for cdance — needs changing.
- **UGC realism:** lead with `"UGC creator, iPhone handheld, harsh midday sun"`; say
  "handheld", drop rig words (jib/crane/steadicam); physics via consequence, not
  adjectives; 6–10s per beat; multi-shot via "cut to".
- Sources: fal.ai, apiyi, videoai.me, Runware, seedance.tv (see research thread).

**→ Implication for the app:** the Parts 1–6 humanization is right in principle but is
delivered by STACKING many post-append clauses (anchor + camera + static-default +
secondary + idle + ambient + cadence + negation pair + subtitle ban). For Seedance 2.0
that stack is the disease. **Next track = "lean mode":** consolidate to one aesthetic
identity line + one camera line + the beat + one short negative line; drop/greatly
reduce the appends; switch cdance dialogue to double-quotes. Validate via this loop.

### GPT-image-2 — two separate blockers
1. **Text pre-filter** scans the prompt BEFORE the model (`moderation_blocked` 400).
   Fix = vocabulary. → shipped `sanitizeImageModeration` (Part 9). Trigger table folded
   into `rules.ts` IMAGE_MODERATION_MAP.
2. **2026 visual classifier** blocks photoreal real-person skin at the OUTPUT — more
   sensitive to realistic human skin. Prompt words can't fully solve this. **Fix =
   fall back to `nano-banana-2/edit` (no OpenAI filter)** when gpt-image still blocks
   after sanitizing → belongs in the Part 8 auto-pipeline retry chain.
- Filter is **stochastic** — identical prompts don't always get the same verdict.

---

## Test iterations

<!-- Template — copy per test:
### YYYY-MM-DD — <what we tested> — <model>
- **Prompt:** (exact text pasted)
- **Settings:** model/size/refs
- **Outcome:** (Khian's verdict — what the video/image actually did; attach/paste)
- **Diagnosis:** (prompt vs result — what went wrong)
- **Fix tried:** (revised prompt / rule change)
- **Result of fix:** better / worse / same
- **Promote to rule?:** yes(→rules.ts/prompt.ts) / no / keep testing
-->

### 2026-08-14 — GPT-image-2 moderation before/after (Claude, WaveSpeed) — gpt-image-2
- Testing whether `sanitizeImageModeration` defeats the text pre-filter.
- **Result:** _(pending — live test running)_
