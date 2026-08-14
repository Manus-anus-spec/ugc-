# UGC App — Improvement Log (data → app update)
Running list of concrete fixes learned by challenging the app's output against `~/Downloads/AI_Video_Prompting_Claude vs Gpt.docx`. Goal: fold these into the app so ideations/prompts come out right automatically (the staged `docs/FABLE5-PROMPT-humanize-ugc-app.md` is the vehicle).

## FIXED IN PROFILE (belle, already live)
1. **"full" over-amplifies the SD body** (Khian, Aug 13). The word "full" ("full bust/full hips/full thighs") makes Seedream over-dramatize her body; removing it = perfect every time. → Removed from all `sd.frameTypeTemplates` (v7). **APP CHANGE:** the generated `sdPrompt` should never emit "full"; prefer "natural / curvy / shapely / soft" + "realistic proportions, not exaggerated". Consider adding "full" to a body-word banlist in `prompt.ts` SD rules.
2. **Wardrobe = always red / no variety** (Aug 13). `looks.wardrobeDefaults` was tiny + "exact color per scene" → Gemini defaulted to red. → Expanded with a redhead palette + rotate rule + red banned as default (v6). **APP CHANGE:** every model profile needs a palette + "vary per video" rule; the generator should track last-used outfit/colour and force a different one.
3. **World too small (~3 locations surfaced)** (Aug 13). Whitelist was 11 and ranch-heavy. → Expanded to 31 (ranch + home + small-town lifestyle + water + going-out + seasonal) (v7). **APP CHANGE:** generator should spread ideations across DISTINCT whitelist locations, not reuse 2-3.

## MOTION-PROMPT HUMANIZATION (from the doc — bake into prompt.ts video rules)
The app's motion prompts are timestamp-by-timestamp + over-directed → they read AI. The doc's 11 principles fix this:
4. **Over-directed expressions** → describe what she's REACTING TO, let expression emerge; use sequences (notice → glance → react → look away), not labels ("shocked", "pure disgust", "feigned innocent").
5. **Freeze words cause dead frames** — ban "stares", "pauses", "holds", "frozen", "briefly holds", "hold ~Xs". Use "briefly looks toward… then returns", "expression shifts as…", "continues moving while…".
6. **Portrait framing** — "waist-up / subject fills 50-60%" induces a portrait. Use environmental/anti-portrait: "NOT a portrait, NOT close-up, environmental medium-wide, subject occupies ~40%, off-center, room visible, chest-height, slight downward tilt."
7. **Whip pans** — replace "pans quickly / whip pan" with real phone behavior: "quick handheld pivot, slight overshoot then settles; strong natural motion blur only during the fastest part."
8. **Add the idle-behavior block to every prompt** (blinking, eye saccades, shoulder breathing, weight shifts, relaxed fingers, no robotic symmetry, no frozen pose).
9. **Background alive but secondary** (named independent extras: someone reaching for a beer, a server passing once; nobody staring/performing).
10. **Give hands reasons to move** (turn a coaster, thumb the bottle label, tuck hair) — kills the mannequin pose.
11. **Bystander reactions** = believable double-take (briefly notices → second glance → realizes → looks away), never "stares in surprise".
12. **Secondary motion: keep it to 1-2 cues** (hair + fabric-on-breath). Too many ("belt catches light, neckline shifts…") makes the model focus on clothing over the person.
13. **Reproduce as ONE continuous take**, beats flowing into each other ("still chewing from the previous bite"), not separate shots that reset the pose.

## MORE (Aug 13, from a live $17 Seedance 2.5 test — one long take failed)
14. **Clips need CONTEXT / a beginning.** A flowing one-take started mid-conversation → confusing. Clip 1 must ESTABLISH (she notices someone approach, the exchange starts from the top) + a text-overlay hook sets the premise. Don't drop the viewer into the middle.
15. **Camera moves read cinematic.** Tilts/pans/push-ins (even a "gaze tilt down to the shoes") feel produced. → Default to STATIC amateur phone framing, micro-shake only; make any "reveal" its OWN static clip, not a camera move.
16. **Add the model's ACCENT to spoken delivery.** If she talks, bake a soft regional accent ("soft warm Texas drawl, not theatrical") — the app currently omits accent so she sounds generic. **APP CHANGE:** add an accent/voice-delivery descriptor to `voice` and inject it into every dialogue motionPrompt.
17. **Add location-matched AMBIENT sound.** Prompts only said "room tone, no BGM." → Inject scene-appropriate ambience: bar = murmur/chatter/clinks; outside/ranch = birds, breeze, cicadas, distant animals; diner = utensils/booth noise. **APP CHANGE:** derive ambient from the chosen location and add it to the audio line.
18. **One long take = expensive + fragile** ($17 waste). Prefer 2-3 shorter clips stitched in edit — each cheaper to retry and less drift.

**Net app change:** update `worker/src/generate/prompt.ts` motion-prompt rules (+ the profile `video` rules) to enforce 4-13, and add a lint pass that flags freeze words / "waist-up" / "full" / over-directed expression labels. Do via the FABLE5 humanize spec, tested with before/after golden prompts. Propose-before-apply (app changes = Fable 5).

## ENFORCED IN CODE (Aug-14 — FABLE5 humanization overhaul)
Every item above is now enforced deterministically (not just instructed), so live D1 profiles inherit it with no data migration:
- **1 ("full")** → `autofixSdBodyWord()` strips it from every SD pass + seed `frameTypeTemplates` cleaned. **2 (wardrobe variety)** + **3 (locations)** → HUMANIZATION LAW §11 spreads colour/location across the 3 ideations.
- **4 / over-directed** → `lintHumanization()` OVERDIRECTED_LABELS + LAW §1. **5 (freeze words)** → FREEZE_PHRASES lint (negation-aware) + LAW §2. **6 (portrait)** → PORTRAIT_PHRASES lint + LAW §4. **7 (whip pans) / 15 (cinematic moves)** → CINEMATIC_MOVE_PHRASES lint + LAW §5 (static default, reveal = own clip).
- **8 (idle block)** → `ensureIdleBehavior()` (one-shot) / `ensureMicroExpression()` (multi). **9 (background) / 11 (bystanders)** → LAW §7. **10 (hands) / 13 (continuous flow)** → LAW §3/§6. **12 (secondary ≤2)** → `ensureSecondaryMotion()` capped + schema reconciled.
- **14 (establishing beat + hook)** → LAW §8. **16 (accent)** → `voice.accent` + `ensureAccent()`. **17 (ambient)** → `ensureAmbient()` location map. **18 (multi-clip) / Seedance** → `chooseVideoModel()` defaults `cdance_2`.
- Verified offline via `scripts/compiler-tests.ts` (lint fires on bad input, passes gold-standard phrasings; injectors idempotent). Live-generation acceptance still gated by the Gemini billing blocker.
