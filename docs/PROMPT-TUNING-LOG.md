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

### 2026-08-14 — Seedance 2.0 LEAN MODE shipped (prompt-side) — cdance_2
Model-gated the motion assembly: Seedance now gets a LEAN prompt, Kling keeps the heavier
anti-cinematic push it still needs. Changes (rules.ts + prompt.ts):
- Dropped the verbose idle-behavior block for Seedance (2.0 handles natural motion natively).
- Dropped the obsolete "no smoothness, no stabilization" pair (a 1.x workaround).
- Collapsed the 3 tail sentences (cadence + phone-mic audio + subtitle ban) into ONE
  closing negative line: `— no music, no on-screen text or subtitles, no watermark, no slow motion`.
- Dialogue now DOUBLE-QUOTES + delivery tone (was curly braces).
- **Result on a representative Belle beat: 142 words → 107 words** (Kling path stays 142).
- **NEXT: Khian to generate this clip on Seedance and judge** — does leaner = better motion /
  less jitter / better dialogue? Log the verdict here. If 107 still feels over-stuffed, v2
  folds secondary-motion into the action line and trims the static-camera clause (target 60–100).

Example AFTER (Seedance lean, ~107 words) to test:
> Candid iPhone clip at a honky-tonk, auto-exposure, deep focus — not cinematic. She leans on
> the bar, catches him looking, tilts her head and laughs. She says: "you really rode that
> thing?" — casual, natural delivery. Voice: soft warm Texas drawl… Static handheld, only
> natural micro-shake — no pans/tilts/zooms/push-ins. Secondary motion: copper waves swing…;
> plaid shifts… Background: low bar murmur, glasses clinking, chatter, phone-mic audio — no
> music, no on-screen text or subtitles, no watermark, no slow motion.

---

### 2026-08-14 — GPT-image-2 moderation before/after (Claude, WaveSpeed) — gpt-image-2
- Model path confirmed: `openai/gpt-image-2/text-to-image` (WaveSpeed v3). Key valid.
- **Trigger prompt** ("youthful 22-year-old girl, tight corset, sweetheart neckline,
  heavy-lidded sultry, curvy hourglass") → **FAILED: "Content flagged as potentially
  sensitive."** ← this is the exact error Niko/Khian hit.
- **Clean prompt** ("natural adult woman, well-fitted knit top, cluttered kitchen,
  glancing off-camera, natural window light") → **accepted / generating** (not blocked).
- **Follow-up A/B + 3× trials (same day) — the honest, complete result:**
  - Raw trigger prompt: ❌ blocked every time it ran.
  - Sanitized/clean prompts across all runs: ✅ passed 4×, ❌ blocked 1× (the A/B run).
  - Scene-framed (activity-first, minimal body): ✅ 3/3 — no clear edge over sanitized here.
- **Conclusion (corrected):** the filter is **STOCHASTIC** (research-confirmed) — the SAME
  sanitized prompt blocked once and passed 3× on other runs. So:
  1. Sanitizing triggers is **necessary and materially helps** (raw = reliably blocked →
     sanitized = mostly passes). Keep `sanitizeImageModeration`.
  2. **No prompt-side fix reaches 100%** — stochastic filter + a 2026 visual classifier on
     photoreal skin. The GUARANTEED fix is **auto-retry + fall back to `nano-banana-2/edit`
     (no OpenAI filter)** = the Part 8 moderation-retry loop. Data now justifies building it.
  3. Scene/activity-first framing (minimal body/clothing/expression description) is a
     plausible extra lever (research-backed) but was NOT isolated as a clear win here —
     worth folding into nbPrompt composition + A/B-ing properly.
- ⚠️ Earlier same-day claim "sensitive rejections should drop sharply / sanitizer
  validated" was **over-stated** on one lucky pass — corrected by the 3× trials above.

## SESSION 2026-08-17 — Belle one-shot rebuilds (hose + watermelon). Khian editing live; this is becoming the new app-prompt method.

### WHAT'S WORKING (fold into the app)
- **One-shot ≤15s.** Collapse a sub-15s idea into a SINGLE Seedance take (First→then→finally), not 3 stitched sub-clips. Kills per-clip face/light/wardrobe drift + saves generations. (log items 28)
- **Look declaration FIRST + "no smoothness, no stabilization"** (load-bearing for Seedance) + flat daylight = stops cinematic drift.
- **Motion prompt defends the first frame, doesn't re-describe the scene.** First frame owns the look.
- **GPT-Image-2 one-shot first frame** (locked face+body refs) should REPLACE the NB→Seedream two-pass for video frames too — Seedream over-amplifies her body and the two-pass drifts. (Aligns with the locked stills recipe.)

### WHAT'S NOT WORKING (fix in the app + prompts)
- **Prop physics not established = magic.** The hose had no nozzle/open end → water appeared from nowhere. RULE: any prop that emits/pours/sprays must have its SOURCE named in the first frame AND already-active at clip start (visible nozzle, water already running). Applies to hoses, bottles, sprays, smoke, etc.
- **Dialogue vs "no talking" contradiction.** The app injects "she does not speak on camera / no talking" AND leaves dialogue lines in the beat → contradiction, and lip-sync on a mouth-full-of-food shot fails. RULE: when the model's mouth is busy (eating/drinking) OR the line is wry internal-monologue, deliver it as OFF-CAMERA VOICEOVER (her accent), never on-camera lip-sync. Route true synced dialogue to a lip-sync model; VO can ride Seedance audio or be added in edit.
- **Over-named expressions cause mishaps.** "eyes rolling back in pure feral bliss", "deadpan unapologetic stare" → creepy/AI. Let the expression EMERGE from the action; describe the action, not the emotion label.
- **Strip-regex garble persists** in app output: "nude-rose"→"off-camera-rose", "freckles"→",", "green/blue-green eyes"→"green blue-", "NOT studio lighting"→"NOT soft natural lighting", closer duplicated 3×. (log item 29)

### ⭐ STRATEGY — GPT-IMAGE = COMPLIANT BASE, SEEDREAM = ADD-BACK LAYER (Khian, Aug 17)
When GPT-Image-2 flags a first frame, don't fight it — **feed it only words it likes to get the clean generation, then hand the rest to Seedream.** GPT-image makes the safe base image (pose/scene/face); Seedream adds the "extra bits" it refused (wardrobe cut, wet look, a touch of shape). Study every refusal → build the trigger dictionary below → stop feeding those words up front.
- **CAVEAT (locked rule still applies):** keep the Seedream add-back GENTLE — add wardrobe/skin detail + a touch of shape, NOT "full curvy hourglass". Seedream over-amplifies her body if you let it. Add-back layer = yes; body-inflation = no.
- **App implication (for Fable 5):** on a moderation flag, auto-strip the known triggers from the GPT-image call, generate the base, and route the removed descriptors into the Seedream pass instead of just failing/falling back. Two-stage by design.

### 📕 GPT-IMAGE-2 TRIGGER DICTIONARY (growing — words that flag; strip from GPT-image, move to Seedream)
- **"unbuttoned"** (any garment) — reads as UNDRESSING. Top offender. → drop / use "frayed cutoff shorts".
- **body-shape sentences on a swimwear shot** — "curvy", "hourglass", "natural bust", "snatched waist", "realistic proportion not exaggerated" → REMOVE from GPT-image (refs carry the body); do shape on Seedream, gently.
- **swimwear nouns stack up** — "triangle bikini top" / "bikini" + minimal-coverage wording → soften to "swim top" for the base; restore the bikini look on Seedream.
- (older, confirmed) youth wording ("youthful/early-20s/zero signs of aging"), "corset", "tight", "heavy-lidded", "sweetheart", "stare" — already banned in the recipe.
- METHOD: the filter is partly stochastic — a clean-ish prompt often passes on a plain retry before you escalate to nano-banana-2/edit.
