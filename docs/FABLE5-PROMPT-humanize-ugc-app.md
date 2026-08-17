## TASK: Rewrite the UGC app's prompt-generation engine so it natively outputs "human," realistic video prompts — killing the manual ChatGPT-paraphrase step our operator currently does by hand.

You are working in the UGC Reverse-Engineer app repo (`~/Desktop/ugc-`). Its worker analyzes a viral video into FormatDNA, then generates per-beat prompts (nbPrompt = Nano Banana still, sdPrompt = Seedream body pass, motionPrompt = video model). Right now those prompts read "botty" — over-directed, timestamp-islands, portrait-framed — so our operator (Niko) has been copy-pasting every app prompt into ChatGPT to paraphrase it more human, and his video results improved dramatically doing so. Your job is to bake that improvement INTO the app so we never need the ChatGPT detour again.

### STEP 0 — READ THESE FIRST (do not skip; they are the source of truth)
1. `/Users/mac/Downloads/AI_Video_Prompting_Claude vs Gpt.docx` — the full prompting guide (11 principles + a real BEFORE/AFTER of one of our app's own prompts). THIS IS THE SPEC. Convert with `textutil -convert txt` if needed.
2. `/Users/mac/Downloads/Ai Meeting Check in w Niko - July 30.pdf` — the meeting where we scoped this (workflow, audio extraction, wardrobe, onboarding).
3. Repo prompt logic you will be editing:
   - `worker/src/generate/prompt.ts` — the master instruction block sent to Gemini (nb/sd/motion construction rules). **Primary file.**
   - `worker/src/generate/rules.ts` — toolRules: bannedWords, structureNotes, cameraLines, confirmedWorkingExamples, continuity assembly.
   - `worker/src/prompt.ts` — analysis-stage prompt (wardrobeVisible etc.).
   - `shared/schemas.ts` — beat fields (secondaryMotion, continuityLock, etc.).
   - `docs/VIDEO-MODEL-PROMPTING.md` — update this doc to match the new rules.
   - Regression guard: `docs/golden-test-1-formatdna.json` / `golden-test-1-pro-formatdna.json`.

### STEP 1 — BAKE IN THE 11 PROMPTING PRINCIPLES (from the .docx)
Translate every principle into the app's instruction strings + banned-word lists so the LLM produces them by default. Summary of what must become true of every generated motionPrompt/nbPrompt:

1. **Reaction, not prescription.** Stop naming expressions ("intense pleasure", "eyes rolling back", "confident smirk"). Instead describe what she's *reacting to* and let the expression emerge. Expressions must *develop* across a beat, never instant-swap.
2. **Ban "frozen" language.** Add to bannedWords: `pauses`, `stands frozen`, `holds the expression`, `briefly holds`, `staring`, `maintains eye contact`, `freeze`, `holds still`. These create dead frames. Replace-with menu: "briefly looks toward…", "her expression shifts as…", "continues moving while…", "glances toward… then naturally returns her attention".
3. **Preserve micro-reactions while preventing freeze.** Skit beat structure: normal action → notices → visibly reacts → she notices him noticing → tiny reaction → plays it off. Don't over-correct into constant motion that erases the micro-beat.
4. **Bystander reactions** = believable sequence: "briefly notices → second glance → realizes he's been noticed → looks away → keeps walking." Never "shocked" / "staring at her."
5. **Human interaction physics:** half a pace closer (not lunging); prop lightly taps (not thrust); camera reacts with a tiny bump; smile comes before AND after a tease; small behaviors (brush hair back, weight shift, blink) break the AI-pose look.
6. **Hands need a reason, not a script.** Give her a motivation to move hands (adjust the prop, brush jacket, rest near hip) but do NOT script constant gestures — "real people move, stop, and settle."
7. **Global "natural idle behavior" block** appended to every prompt: occasional blinking, small eye saccades, tiny breathing in the shoulders, subtle weight shifts, slight posture adjustments, natural finger relaxation, micro facial movements, no exaggerated expressions, no robotic symmetry, no frozen pose between actions.
8. **Anti-portrait framing with numbers.** "waist-up / friend-taken / front angle" produce portraits — stop using them as framing. Use: "NOT a portrait, NOT close-up, environmental composition, medium-wide, subject occupies ~35–45% of frame, room clearly visible." NB stills: ~30–35%, lots of negative space, "not intentionally composed." Describe RELATIVE layout (camera height, distance, subject position, headroom, background landmarks) rather than "exact/identical composition."
9. **Camera = walking-to-subject**, not "static handheld drift" and not "rapidly approach": spot her → walk toward → slightly shaky → catch up → slow → settle → conversation. Camera height chest/shoulder with a slight 5–10° downward tilt, not dead eye-level.
10. **Real phone-pan behavior.** Replace "rapid whip pan" / "heavy motion blur": quick handheld pivot, sudden turn, uneven swing, slight overshoot then correction, settles naturally, operator reacts instinctively. Blur = "strong natural motion blur during the fastest part of the pan," not uniform.
11. **Continuous flow, not timestamp islands.** Beats must flow into each other ("still chewing from the previous bite") — no per-timestamp posture resets. Backgrounds alive but secondary (distant patrons, a server passing once, utensil sounds).

### STEP 2 — RECONCILE THE 3 CONFLICTS (do NOT blind-append; the guide contradicts current app rules here)
- **Secondary motion:** current app pushes it hard (schema/instructions imply "a beat where all four secondary-motion cues are none is almost always wrong"). The guide says the OPPOSITE — too many secondary-motion cues make the model animate clothing over the person. **Change to: keep 1–2 natural cues max (e.g., hair moves with the head turn, dress responds to a weight shift); let the rest emerge.** Update both the schema comment and the prompt.ts instruction.
- **"Exact/identical composition":** current continuity logic leans on "identical composition / exact framing." The guide shows diffusion models reproduce RELATIVE spatial relationships more reliably than "exact." **Change continuity language to relative-layout description** (camera height/distance/subject position/headroom/landmarks) while still preserving set/wardrobe/light continuity.
- **Repeated verbatim camera line:** the BEFORE example repeats "friend-filmed handheld at eye level, subtle natural micro-shake" every beat — the guide flags this as a tell. **Stop emitting the camera line identically per beat;** integrate camera into the continuous flow and vary it naturally, at chest/shoulder height (not eye level).

### STEP 3 — ADOPT THE NEW motionPrompt SKELETON (from the AFTER example in the .docx)
Restructure long/one-shot motionPrompts into labeled blocks that enforce continuity: `CONTINUITY/PERFORMANCE` (one continuous take, same face/outfit/set/light, no resets) → flowing timestamped beats that reference the previous beat → `ENVIRONMENT` (alive but secondary) → `CAMERA` (blocks cinematic behaviors explicitly) → `PERFORMANCE` (idle-behavior block, physical object consistency) → `AUDIO/DIALOGUE`. Keep the existing hard rules intact: footage-aesthetic anchor FIRST, no "cinematic/bokeh/4K" as positives, no on-screen text/captions/watermark, sdPrompt stays a clean copy-paste box with zero file paths/pipeline language.

### STEP 4 — RE-TARGET THE MOTION PROMPTS TO SEEDANCE 2.0 (decision already made — implement it)
The app currently defaults motionPrompts to Kling/CDance, but our primary production video model is now **Seedance 2.0** — that is the model the motionPrompt must optimize for. Do NOT leave this open; implement it:
- Make **Seedance 2.0 the primary motionPrompt target.** Keep Kling/CDance ("Speed Dance") support as a **model-aware fallback** — i.e., a target switch (profile field or generate param, default `seedance`) that selects the right cameraLines / phrasing / char limits / dialogue handling per model, rather than one hardcoded Kling style. If adding a switch is too invasive this pass, retarget to Seedance 2.0 as the single default and leave a clean seam for Kling.
- **Ground the wording in research first** (don't guess Seedance's dialect): research how Seedance 2.0 actually responds — natural/human phrasing vs technical directives, continuous-motion handling, dialogue/lip-sync support, camera-term interpretation, char-length sweet spot — and tune the Step 1–3 rules to it. Also sanity-check the companion models the pipeline uses: **WaveSpeed Seedream 4.5 Edit** (image-to-image body pass) and **Nano Banana** (stills).
- Document the Seedance 2.0 prompting profile (and the Kling fallback differences) in `docs/VIDEO-MODEL-PROMPTING.md`, and note in your report any place the retarget changed behavior.

### STEP 5 — SECONDARY FEATURES (from the meeting; lower priority than Steps 1–3)
- **One-click audio extraction:** when a source video is analyzed/uploaded, extract its audio and expose a download button/endpoint, so the operator doesn't have to re-find audio in CapCut. Scope it in the worker analyze/route layer; if out of scope for this pass, leave a clear TODO + design note.
- **Wardrobe reference-image surfacing:** the app already resolves wardrobe *text* into prompts correctly, and Keira's real garment closet now exists at `Aruna Talent - files/Keira/Assets/Outfits/_closet/<key>.jpg` with a map at `KEIRA-WARDROBE-REFERENCE-SHEET.md`. Add the app-side half: surface the chosen look's garment-image path in the generated brief/export so the operator (or auto-pipeline) attaches it to WaveSpeed alongside the face ref. Text describes the garment; the image locks it.
- **Onboarding realism:** update the profile template / onboarding SOP to require 4–6 NEUTRAL/bland face shots (passport-style, not smiley) + defined wardrobe, so new models don't hit Kira's face-drift wall.

### CONSTRAINTS
- Keep sdPrompt and motionPrompt as clean, self-contained, copy-paste-VERBATIM boxes — never leak file names, folder paths, reference-image names, or "two-step pipeline" language into them.
- Do not break the pipeline: run the golden FormatDNA tests and generate one before/after ideation to confirm the schema still validates and prompts still assemble.
- These are edits to instruction strings + banned lists + one schema comment — not an architecture rewrite. Preserve the existing identity firewall (face lock), the NB/SD split, and the reproduce/adapt fidelity modes.

### VERIFICATION (required before you report done)
1. Generate one ideation on an existing format for profile `keira` (or `rosalia`) BEFORE and AFTER your changes; paste both motionPrompts.
2. Show the AFTER prompt now naturally exhibits: reaction-driven expressions, zero banned "frozen" words, ≤2 secondary-motion cues, anti-portrait % framing, continuous-flow beats, idle-behavior block. Essentially: it should read like Niko's ChatGPT-paraphrased output WITHOUT anyone touching ChatGPT.
3. Confirm golden tests still pass and the schema validates.
4. Confirm the motionPrompt now targets Seedance 2.0 (cameraLines/phrasing/limits tuned to it; Kling seam intact).
5. Report back: files changed, before/after prompt diff, how the 3 Step-2 conflicts were reconciled, the Seedance 2.0 prompting profile you applied, and anything you intentionally deferred (audio extraction / wardrobe image surfacing).
