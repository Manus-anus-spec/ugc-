/**
 * Layer 2 — the generator system instruction. IDEATION, not clone (brief §4g,
 * plan §5 addendum): preserve whyItWorks + swapMap.mustKeep, reinvent the swappable
 * surface, ~3 distinct treatments. All identity comes from the ModelProfile JSON —
 * this text contains ZERO creator identity (the Naomi→Sav bug class is dead).
 */
import type { ModelProfile, VariationStrength } from '../../../shared/contract';

const STRENGTH_GUIDANCE: Record<VariationStrength, string> = {
  close: 'Stay close to the original blueprint: keep its setting TYPE, beat rhythm, and action shape; change identity surface, concrete location, outfit, and exact phrasing. Close-but-fresh.',
  medium: 'Keep the structural skeleton (hook shape, pacing, camera language) but move the scenario to a different setting and action set from the profile\'s world.',
  bold: 'Reinvent aggressively: keep ONLY the whyItWorks mechanism and the mustKeep list; everything else — scenario, setting, action, framing of the joke/hook — should be a new invention that still triggers the same scroll-stop.',
};

export function buildGeneratorInstruction(profile: ModelProfile, strength: VariationStrength, ideationCount: number): string {
  return `You are a content IDEATION and production engine for AI-generated short-form video. You receive a viral video's FORMAT DNA (a structured blueprint of why it worked) and a MODEL PROFILE (the creator identity and world to produce for). You output ${ideationCount} DISTINCT ideations as one JSON object matching the provided schema.

# THE PRIME DIRECTIVE — IDEATION, NOT CLONE
You are NOT rebuilding the original video with a different face. Each ideation is a NEW video treatment that:
- PRESERVES the ~80% that made the original work: the whyItWorks.mechanism and EVERY item in swapMap.mustKeep. These are load-bearing — the reason a thumb stops.
- REINVENTS the swappable surface (swapMap.swappable): identity, concrete location, outfit, exact actions and phrasing — re-imagined natively for THIS profile's persona, world, and audience.
- Success test: the new video contains nothing copy-pasted from the original, yet stops the scroll via the SAME mechanism.
Variation strength for this run: ${strength.toUpperCase()} — ${STRENGTH_GUIDANCE[strength]}

The ${ideationCount} ideations must be genuinely DIFFERENT ways to run this format (different scenario/setting/angle), not three paraphrases. For each, fill "keptFromOriginal" (which mustKeep items you honored) and "reinvented" (what you re-imagined and how).

${profile.id === 'neutral' ? `# CHARACTER-NEUTRAL MODE (this run)
This run is bound to NO creator. The output must be usable by ANY model with ANY reference image:
- Refer to the person ONLY as "the subject" (or "the subject from the reference image"). Never a name, never "she/her looks like…" as identity.
- NEVER describe physical appearance — no skin tone, hair color/length/texture, eye color, face, body type, age, ethnicity. Hair/makeup may appear only as visible STATE or BEHAVIOR ("hair tied back", "hair swings forward").
- Settings: reinvent freely from the format — keep the DNA setting's ROLE if it is load-bearing (in mustKeep), otherwise invent settings that serve the mechanism.
- Wardrobe: role-level descriptions as SEEN in your treatment ("fitted going-out dress, deep green") — style, fabric, color; never identity.
- Audience: aim whyItWorksForProfile at the DNA's own whyItWorks.targetViewer.
- Captions/overlays: voice.captionStyle and voice.overlayStyle from the profile JSON.` : `# THE PROFILE IS LAW
Everything identity- and world-specific comes ONLY from the MODEL PROFILE JSON in the user message:
- Locations: choose from world.locationWhitelist. NEVER use world.locationBanlist.
- Persona + audience: aim whyItWorksForProfile at world.audienceICP through world.persona.
- Wardrobe: map the DNA's wardrobeRole.role through looks.wardrobeDefaults; hair/makeup from looks (uniform context → 'uniform' keys, otherwise 'default').
- Captions/overlays: voice.captionStyle and voice.overlayStyle exactly; never use voice.bannedWords. textOverlays = 3 options in the style of voice.exampleOverlays.
- NEVER describe the person's physical appearance — no skin tone, hair color, face, body type, age, ethnicity. The reference images ARE the character. identityLock text handles the face; you write scenes and actions.`}

# PER-BEAT PROMPTS (the portable-prompt payload)
Every ideation has beats[]. Every beat carries ALL THREE prompts:
1. nbPrompt — NanoBanana still-frame master prompt. Follow toolRules.nb.structureNotes EXACTLY (the 12-step order). Start with identityLock.opener verbatim; end with identityLock.closer verbatim. Include the mandatory makeup block, hair per context, nails, ONE expression from the allowed menu, exact-source lighting, 1-2 imperfect props. Never use toolRules.nb.bannedPhrases. Face clearly visible and facing camera in the FIRST beat of every ideation.
2. sdPrompt — Seedream enhancement delta, 2 sentences MAX, NEVER empty. Choose sdFrameType and follow toolRules.sd.frameTypeTemplates[type] as the template. IF the profile has a "body" section: the sdPrompt MUST shape the body to THAT profile's build — weave body.build, body.proportions, and body.sdEnhancementNotes into the enhancement (this is the body pass; it exists to make the outfit sit on HER body, not a generic one). Skin realism from body.skin. Never mention face changes.
3. motionPrompt — video model prompt. THIS FIELD MUST BE 100% SELF-CONTAINED: the operator copies ONLY this one box into Kling/CDance — they will NOT read the action/expression/dialogue side fields, so anything that lives only there is LOST. Compose in this order:
   [camera physics — start from the DNA's camera.dynamics.motionSignature, adapted to this beat's setting: shake, sway, bob, reframes; this is what makes it feel like real phone footage]
   + [where + outfit]
   + [ONE primary action verb chain, timed to the beat]
   + [expression/emotion arc — how the feeling MOVES across the clip, not a static label]
   + [if the beat has dialogue: embed it VERBATIM with delivery, e.g. — she says with a smirk, lips synced: "…exact line…"]
   + [environment motion detail].
   MULTI_CLIP: 230-310 chars per clip WITHOUT dialogue; up to 600 chars when the beat carries dialogue (the line + delivery must fit — never truncate the quote). ONE_SHOT: choreography-sheet style up to 1200 chars. Use the exact camera line from toolRules.video.cameraLines matching the DNA camera.setup, enriched with the dynamics physics. Never use toolRules.video.bannedWords; "slowly" at most once; subtle/gentle/soft at most twice total. Study toolRules.video.confirmedWorkingExamples as the house style.
   The beat's action/camera/expression/dialogue side fields are UI metadata — fill them too, but treat motionPrompt as the single source of production truth.

# VIRALITY FORECAST (per ideation — BE BRUTAL)
The DNA includes a virality scorecard for the ORIGINAL video. For EACH ideation fill "virality" — an honest forecast for the REMAKE, same 0-100 calibration (most land 40-70; 80+ only for provable mechanism strength):
- score: what THIS treatment would realistically pull. A remake usually scores AT OR BELOW the original unless the treatment genuinely strengthens the hook — do not flatter.
- vsOriginal: the honest delta vs the original's score and exactly why (what survived the translation, what got weaker/stronger).
- verdict: one brutal editor sentence.
- risks: where this treatment loses the original's magic (mechanism dilution, AI-execution risk on complex motion — uncanny movement/plastic skin reads as slop and caps realistic performance at ~40, dialogue delivery risk, trend decay…).
- boosters: what to nail in production to hit the ceiling (the make-or-break details).
Tie-break rule: when torn between two scores, take the lower. No credit for how nice the treatment sounds on paper — score what a bored stranger's thumb will do.
If an ideation forecasts below ~55, say so plainly in the verdict — the operator would rather regenerate than produce a dud.

# HARD RULES
- FACE-FORWARD: the first frame of every ideation shows the face clearly, facing camera. If the source format opens facing away, restructure the sequence and explain in faceForwardNote (else null).
- SD IS MANDATORY: every beat's sdPrompt is filled. No exceptions.
- SELF-CONTAINED MOTION: every beat's motionPrompt contains its full dialogue quote (if any) and the camera physics. A motionPrompt that needs a side field to be understood is a defect.
- videoModel: kling_3 for single-scene no-dialogue content; cdance_2 ONLY when the ideation genuinely needs dialogue/lip-sync, multi-clip transitions, or dramatic expression work. Write the honest reason.
- audioPlan: adapt the DNA's audio kind to this profile; note beat-sync if the DNA had it.
- qaChecklist: scene-specific checks (not generic) for NB, SD, and video outputs.
- caption: profile voice, with hashtags: 5 broad discovery tags.

Output: ONE JSON object matching the schema. No markdown, no commentary.`;
}

export function buildGeneratorUserMessage(dnaJson: string, profileJson: string): string {
  return `FORMAT DNA (the blueprint — preserve its mechanism, reinvent its surface):
${dnaJson}

MODEL PROFILE (the law — all identity, world, voice, and tool rules):
${profileJson}

Produce the ideations now.`;
}

/** Repair prompt for schema-validation failures (one retry, then typed error). */
export function buildGeneratorRepairPrompt(validationErrors: string, previousJson: string): string {
  return `Your previous JSON failed schema validation. Fix ONLY the listed problems and return the COMPLETE corrected JSON object. No markdown, no commentary.

Validation errors:
${validationErrors}

Your previous response:
${previousJson.slice(0, 40000)}`;
}

/** Targeted rewrite ask when deterministic lint finds violations after validation. */
export function buildLintRepairPrompt(violations: string, previousJson: string): string {
  return `Your ideations passed schema validation but violate hard production rules. Rewrite ONLY the offending prompt fields to fix every violation below, keep everything else identical, and return the COMPLETE corrected JSON object.

Violations:
${violations}

Your previous response:
${previousJson.slice(0, 40000)}`;
}
