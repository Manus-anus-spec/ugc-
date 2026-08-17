# FABLE 5 BRIEF — Content Persona Framework (theme-congruent ideation)

**Date:** 2026-08-17 · **Author:** Khian (via Claude) · **Scope:** `shared/schemas.ts` (ModelProfile), `worker/src/generate/prompt.ts`, `worker/src/routes/generate.ts` (format selection). Sits directly ON TOP of today's "surprise-me sameness" brief — this is the deeper fix to the same root cause.

**One-line:** Every ideation the app produces must be governed by the model's **Content Persona** (a theme + brand statement derived from who she is), so output is *congruent* across posts and *distinct* per model — instead of the library's strongest hook (the "feral" spine) hijacking every synthesis. This is GriffinOFM's Content Persona Framework, encoded into the profile + generator.

> **⚠️ LOCKS ARE UNTOUCHED.** This change governs **theme, hook, vehicle, format choice, delivery, and ICP targeting ONLY.** It must NOT alter or relax any identity/body/wardrobe lock: `identityLock` (opener/closer/strippedDescriptors), `looks` (makeup/hair/nails/wardrobeDefaults), `body` (Seedream build), `continuityLock`, `wardrobeExact`, the face-forward rule, the whitelist locations, or the GPT-Image/NB one-shot pipeline. The persona layer decides *what she does and how it feels*; the locks still decide *who she is and what she wears*.

---

## WHY (the problem it fixes)
- **Rosalia:** strong views, **0 new followers / 0% view→follow.** Griffin's diagnosis: views come from the *vehicle*; fans come from a congruent *theme*. She has no defined theme → no unique audience → no conversion.
- **"Always feral" bug (today's brief):** synthesis picks the library's most distinctive hook as the spine regardless of model. A wholesome-ranch model (Belle) should never be able to land on a feral thirst-trap spine — the persona should filter it out *before* selection.

## THE FRAMEWORK (what we're encoding)
Kill "niche." A niche = **Theme** (emotional lane, from persona — congruent across ALL posts → leverage for FANS) + **Vehicle** (what she films — swappable → leverage for VIEWS). Cascade: **Roots** (persona = 2 traits + 1 outlier · look · resources) → **Strategy** (theme · USP · vehicle) → **Execution** (format vs element competitors · format menu) → **Synthesis** (brand statement · ideal fan · ideation prompt). Full transcript notes with Khian if needed.

---

## CHANGE 1 — extend `ModelProfileSchema.world` (`shared/schemas.ts`)
Add ONE optional sub-object so pre-existing D1 profiles keep parsing (omitted → generator falls back to today's behavior). Do NOT rename `persona`/`backstory`/`audienceICP` — the new block sits beside them and reuses them as the roots.

```ts
// inside world: z.object({ … existing fields … })
contentPersona: z.object({
  // LAYER 0 — roots
  personaTraits: z.array(z.string()).length(3),   // 2 core traits + 1 outlier (the uncopyable bit). e.g. ["warm","playful","dry-witted outlier"]
  resources: z.string(),                          // filming reality: filmer? location? camera-confidence? cadence. Sets the FORMAT MENU.
  // LAYER 1 — strategy
  theme: z.string(),                              // the emotional lane, CONGRUENT across every post. e.g. "grounded, wholesome country-sweet escape"
  usp: z.string().optional(),                     // hard-to-copy standout (redhead+ranch). DON'T invent if none.
  vehicles: z.array(z.string()),                  // what she films; swappable. e.g. ["ranch chores","horse care","country lifestyle"]
  formatMenu: z.array(z.string()),               // allowed formats given resources: talking-head, GRWM, voiceover, b-roll POV, skit, vlog…
  // LAYER 3 — synthesis (the two the generator actually consumes)
  brandStatement: z.string(),                     // "She is a [traits] [look] whose content is [theme]+[vehicle] that feels like [payoff] for [ideal fan]."
  idealFan: z.string(),                           // who opens the wallet (not follower intent)
  ideationPrompt: z.string(),                     // the reusable line the synth path runs
}).optional(),
```

## CHANGE 2 — governor in the generator (`worker/src/generate/prompt.ts`)
When `world.contentPersona` is present, inject a **THEME GOVERNOR** block into the system instruction for **all three modes** (reproduce / adapt / synthesize), placed so it constrains the PRIME DIRECTIVE:

- State the **brandStatement** + **theme** as a hard constraint: *every* ideation's hook, vehicle, scenario, and delivery must be congruent with the theme; nothing may contradict the brandStatement.
- **The filter (the important part):** if a candidate hook/vehicle contradicts the brandStatement → the model must **reshape or discard it**, not soften it. Add a required per-ideation field `themeFit` (short: how it honors the theme) so it's auditable, mirroring the existing `keptFromOriginal`/`reinvented` pattern.
- **Delivery, not identity:** persona colors tone/energy/hook style and targets `idealFan`. It must NOT touch identityLock/looks/body/wardrobe/continuityLock output — those still fill exactly as today.
- In **synthesize** mode specifically: the fused format must serve the theme; the spine is chosen for *theme fit*, not raw hook strength. This is what stops "always feral."

## CHANGE 3 — persona-bias the source draw (`worker/src/routes/generate.ts`, `selectTopFormatIds`)
Today's brief already changes this to a weighted random draw over the high-scoring library. Extend that draw to be **profile-aware** (thread `profileId` in — the function currently ignores it):
- **Up-weight** formats whose archetype/type matches the profile's `formatMenu` / theme.
- **Down-weight (or exclude)** formats that violate the persona (e.g. a `thirst_trap`/`feral pov` spine for a wholesome-theme model). A persona-violating format should rarely or never become the anchor `dnas[0]`.
- Keep the randomness from today's brief so it's still fresh each press — just biased toward the model's lane. Log which formats were up/down-weighted (don't silently drop).

---

## SEED DATA (Claude/Khian supply — you build the plumbing, not the values)
Claude will fill `contentPersona` for **Rosalia, Belle, Naomi** and PUT them to `/profiles/:id` (auto-bumps version) once the schema is live. Preview of intent:
- **Rosalia** — priority. Theme defined first (her missing piece); vehicle = farm/lifestyle already there.
- **Belle** — USP = redhead + ranch; theme = grounded/wholesome country-sweet.
- **Naomi** — theme = traditional "wife-material"; vehicles = golf skits + cooking; idealFan = older men wanting the grounded traditional one.

## ACCEPTANCE
1. Old D1 profiles with no `contentPersona` still generate exactly as before (backward-compatible). 🔑 Khian deploys.
2. With a `contentPersona` set, three consecutive "surprise-me" presses for Belle produce theme-congruent ideas with **zero** feral/thirst-trap spine, and each names its `themeFit`.
3. Every ideation still emits full `identityLock`/`continuityLock`/wardrobe output unchanged (locks intact). Run a golden diff to prove no regression on the locked fields.
