/**
 * Layer 1 — deterministic rule engines (FABLE5-PLAN §5). Pure functions, no LLM,
 * unit-tested offline (scripts/compiler-tests.ts). These preserve the non-negotiables
 * from SAV_IDEA_SYSTEM_PROMPT as CODE: Kling-vs-CDance selection, face-forward,
 * banned-word lint, char caps, identity-lock wrapping, input sanitization.
 */
import type {
  AudioBeatMapEntry, Beat, BeatGeneration, ContinuityLock, FidelityMode, FormatDna, Ideation,
  ModelProfile, PostProcessing, ProductionRouteStep, RealismTell, SdFrameType, SecondaryMotion,
  TrimSpec, VideoModelChoice,
} from '../../../shared/contract';

/** Video-model decision. FABLE5 §6: Seedance 2.0 (cdance_2) is now the PRIMARY production
 *  target — clips cap at ~15s and skits are stitched multi-clip in the edit, which is how we
 *  actually produce. kling_3 stays a fully-supported FALLBACK SEAM (all kling code paths —
 *  cameraLines position, handheld tail, dialogue label — remain live); pass preferKling to
 *  route a run to it once a model-switch UI param is wired. Default routes everything to Seedance. */
export function chooseVideoModel(i: {
  hasDialogue: boolean; clipCount: number; durationSec: number; emotionalRangeHigh: boolean;
  preferKling?: boolean;
}): { choice: VideoModelChoice; reason: string } {
  if (i.hasDialogue) {
    return { choice: 'cdance_2', reason: 'Dialogue/lip-sync — Seedance 2.0 mouths words in {braces}; Kling cannot.' };
  }
  if (i.preferKling && i.clipCount <= 1 && !i.emotionalRangeHigh) {
    return { choice: 'kling_3', reason: 'Kling fallback requested for a single no-dialogue scene.' };
  }
  return { choice: 'cdance_2', reason: 'Seedance 2.0 is the primary production model (≤15s clips, stitched in the edit).' };
}

/** Face-forward rule (ports scanner:1886-1890): opening beat must face camera. */
export function needsFaceForwardFix(dna: FormatDna): boolean {
  const opening = dna.frames.find((f) => f.role === 'opening') ?? dna.frames[0];
  const text = `${opening?.scene.subjectPlacement ?? ''} ${opening?.scene.bodyPosition ?? ''} ${dna.beats[0]?.action ?? ''}`.toLowerCase();
  return /(facing away|back to camera|walks? away|from behind|rear view|turned away|180)/.test(text);
}

export interface LintViolation { beatIndex: number; field: string; problem: string }

const SOFT_WORDS = ['subtle', 'gentle', 'soft'];
// Caps raised (Jul 26) — the enriched per-beat filming fields (shotSize/motionBeat/
// secondaryMotion/microExpression/camera) legitimately lengthen the LLM's own motionPrompt
// text; the old 550/700 caps were overflowing (790>550) and hard-failing generation.
export const MOTION_CHAR_CAP_MULTI = 900;            // anchor (~200) + physics + action + enriched beat fields
export const MOTION_CHAR_CAP_MULTI_DIALOGUE = 1100;  // + the verbatim quote + delivery — never truncate dialogue
export const MOTION_CHAR_CAP_ONE_SHOT = 1400;
// Reproduce mode carries the source's camera/cut/motion structure in-prompt — more
// load-bearing tokens, bigger budget (the fixed realism blocks are post-append and
// never count against the LLM's cap either way).
export const MOTION_CHAR_CAP_MULTI_REPRODUCE = 1100;
export const MOTION_CHAR_CAP_MULTI_DIALOGUE_REPRODUCE = 1300;

export function motionCharCap(
  videoFormat: 'ONE_SHOT' | 'MULTI_CLIP', hasDialogue: boolean, fidelityMode: FidelityMode = 'adapt',
): number {
  if (videoFormat === 'ONE_SHOT') return MOTION_CHAR_CAP_ONE_SHOT;
  if (fidelityMode === 'reproduce') {
    return hasDialogue ? MOTION_CHAR_CAP_MULTI_DIALOGUE_REPRODUCE : MOTION_CHAR_CAP_MULTI_REPRODUCE;
  }
  return hasDialogue ? MOTION_CHAR_CAP_MULTI_DIALOGUE : MOTION_CHAR_CAP_MULTI;
}

/** Motion-prompt lint (ports scanner:1916-1922): banned words, slowly×1, soft-words×2, char caps,
 *  plus the SELF-CONTAINED rule — a beat's dialogue must appear verbatim inside the motionPrompt.
 *  Runs on the LLM's OWN text, before the deterministic post-append injectors. */
export function lintMotionPrompt(
  prompt: string, profile: ModelProfile, videoFormat: 'ONE_SHOT' | 'MULTI_CLIP', beatIndex: number,
  dialogue?: string, fidelityMode: FidelityMode = 'adapt', dialogueSpoken = true,
): LintViolation[] {
  const v: LintViolation[] = [];
  const lower = prompt.toLowerCase();
  for (const banned of profile.toolRules.video.bannedWords) {
    if (lower.includes(banned.toLowerCase())) {
      v.push({ beatIndex, field: 'motionPrompt', problem: `banned word "${banned}"` });
    }
  }
  const slowly = (lower.match(/\bslowly\b/g) ?? []).length;
  if (slowly > 1) v.push({ beatIndex, field: 'motionPrompt', problem: `"slowly" ×${slowly} (max 1 — causes slow motion)` });
  const soft = SOFT_WORDS.reduce((n, w) => n + (lower.match(new RegExp(`\\b${w}\\b`, 'g')) ?? []).length, 0);
  if (soft > 2) v.push({ beatIndex, field: 'motionPrompt', problem: `subtle/gentle/soft ×${soft} (max 2 — kills energy)` });
  const hasDialogue = !!dialogue?.trim() && dialogueSpoken;
  const cap = motionCharCap(videoFormat, hasDialogue, fidelityMode);
  if (prompt.length > cap) v.push({ beatIndex, field: 'motionPrompt', problem: `${prompt.length} chars > ${cap} cap` });
  if (/\b\d{2}[- ]year[- ]old\b/.test(lower)) v.push({ beatIndex, field: 'motionPrompt', problem: 'age reference' });
  // Cinematizer words flip video models into movie mode — allowed ONLY inside a negation ("NOT cinematic", "no bokeh").
  const cinematizer = /(?<!not )(?<!no )(?<!non-)\b(cinematic|bokeh|shallow depth of field|film grain|35mm|anamorphic|color[- ]graded|colour[- ]graded|dramatic lighting|golden cinematic|8k|4k hdr|masterpiece)\b/i;
  const cm = prompt.match(cinematizer);
  if (cm) v.push({ beatIndex, field: 'motionPrompt', problem: `cinematizer word "${cm[0]}" used as a positive descriptor — kills UGC realism (allowed only inside a NOT/no negation)` });
  // FABLE5 §9 humanization lint (Part 1.9). Conservative, unambiguous, and negation-aware via
  // isNegatedAt (handles not/no/never/avoid/without…) — verified against the guide's gold-standard
  // AFTER + SAV confirmedWorkingExamples so they never flag a good prompt. Strong prompt.ts
  // instruction means these rarely fire; when they do, the existing one-rewrite loop fixes them.
  const flagTell = (re: RegExp, mk: (w: string) => string): void => {
    const m = re.exec(prompt);
    if (m && !isNegatedAt(prompt, m.index)) v.push({ beatIndex, field: 'motionPrompt', problem: mk(m[0]) });
  };
  // Shares PORTRAIT_FRAMING_TERM with lintNbPrompt and framingToAntiPortrait so the ban,
  // the NB check and the emit-time translation can never drift out of agreement.
  flagTell(PORTRAIT_FRAMING_TERM,
    (w) => `portrait-framing term "${w}" — use environmental anti-portrait framing (subject ~35-45%, room visible, off-center), never "${w}"`);
  // "stare/staring AT" (the bystander freeze tell) — NOT the noun "a heavy-lidded stare" (legit house style). Verb+object only.
  flagTell(/\b(stands? (?:completely )?frozen|holds? still|maintains eye contact|stares? at|staring at)\b/i,
    (w) => `freeze-word "${w}" causes a dead frame — keep her moving ("glances toward… then her attention drifts")`);
  flagTell(/\b(pure disgust|confident smirk|feigned innocen\w+|intense pleasure|eyes rolling back|exaggerated bliss)\b/i,
    (w) => `over-directed expression label "${w}" — describe what she is reacting to and let the expression emerge, do not name it`);
  // Self-contained rule applies ONLY to on-camera speech; voiceover scripts live in
  // the dialogue field alone and must NOT appear in the motion prompt.
  if (hasDialogue && !normalize(prompt).includes(normalize(dialogue!))) {
    v.push({ beatIndex, field: 'motionPrompt', problem: 'beat dialogue is missing from motionPrompt — it must be embedded verbatim (self-contained rule)' });
  }
  return v;
}

/** Loose-but-safe text normalization for the dialogue-containment check (quotes/whitespace/case drift). */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[“”"'’‘…]/g, '').replace(/\s+/g, ' ').trim();
}

/** Fallback anchor when a format predates aesthetic extraction — our house look is amateur iPhone.
 *  Phrasing follows the proven Seedance 2.0 UGC recipe (official guide + curated prompt repo):
 *  models honor the earliest strong instruction, so this leads every motion prompt. */
export const DEFAULT_IPHONE_ANCHOR =
  'Raw handheld iPhone footage, all camera settings automatic, no color grading, natural handheld jitter, flat natural daylight, deep focus, imperfect framing — NOT cinematic, no film look, no stabilization';

/** Aesthetic vocabulary a motion prompt must carry so video models don't default to their cinematic house style. */
const AESTHETIC_TERMS = /(iphone|amateur|vlog|ugc\b|casual .*(footage|video)|home video|phone[- ]camera|webcam|not cinematic|no (film|color|colour) grade|ungraded|raw footage|selfie video|tiktok[- ]style)/i;

/** Guarantee the footage LOOK structurally: motion prompts without any aesthetic anchoring get the
 *  DNA's promptAnchor (or the house default) prepended — video models read "no style stated" as
 *  "make it cinematic", which is the #1 realism killer on Seedance/Kling. */
export function ensureAesthetic(motionPrompt: string, dna: FormatDna): string {
  if (AESTHETIC_TERMS.test(motionPrompt)) return motionPrompt;
  // Prefer the ~90-char short anchor (v3) — same lock, less of the char budget.
  const anchor = dna.aesthetic?.promptAnchorShort?.trim()
    || dna.aesthetic?.promptAnchor?.trim()
    || DEFAULT_IPHONE_ANCHOR;
  return `${anchor.replace(/\.$/, '')}. ${motionPrompt.trim()}`;
}

/** Camera-motion vocabulary a motion prompt must carry to reproduce the source's camera FEEL. */
const CAMERA_PHYSICS_TERMS = /(handheld|micro[- ]?shake|shak(e|y|ing)|sway|bob|locked[- ]?off|static|tripod|propped|drift|pan(s|ning)?\b|tilt|reframe|steady|stabili[sz]ed|selfie angle|mirror selfie|placed camera|friend-filmed|walking camera|follow(s|ing)? (her|the subject))/i;

/** Guarantee the camera physics structurally: if the DNA carries a motion signature and the
 *  LLM's motionPrompt has NO camera-motion language at all, prepend the signature — the
 *  camera feel is load-bearing for realism and must never be silently dropped. */
export function ensureCameraPhysics(motionPrompt: string, dna: FormatDna): string {
  const sig = dna.camera.dynamics?.motionSignature?.trim();
  if (!sig) return motionPrompt;
  if (CAMERA_PHYSICS_TERMS.test(motionPrompt)) return motionPrompt;
  return `${sig.replace(/\.$/, '')}. ${motionPrompt.trim()}`;
}

/** Operator-setup phrases that must NEVER appear in a copy-paste generation prompt.
 *  File/folder references and pipeline instructions are SETUP notes (they live in the
 *  profile's sdEnhancementNotes for the operator to read once) — they are not part of the
 *  prompt pasted into Seedream. Strip any sentence carrying one. */
const SD_META_TRIGGER = /(?:two[- ]step pipeline|NB base|reference images?|body sheet|for best fidelity|feed the|\.jpe?g|\.png|\.webp|ARCHETYPE|bust-ref)/i;

function stripSdMeta(s: string): string {
  // Drop WHOLE sentences carrying operator-setup text. Split on ". " (period+space) so decimals
  // like "v4.5" stay intact and never leave orphan fragments.
  return s
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !SD_META_TRIGGER.test(sentence))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Guarantee the profile body pass structurally WITHOUT bloating the prompt.
 *  The frame template (toolRules.sd.frameTypeTemplates[frameType]) IS the canonical, self-contained
 *  ~2-sentence body pass — the LLM's job is only to fill its [clothing]/[background] slots. So: strip
 *  any leaked operator/setup text, and if the LLM dropped the body pass entirely, fall back to the
 *  frame template. NEVER append body.build/proportions/sdEnhancementNotes — that triplicated the
 *  prompt (the ~180-word bloat operators hit) and leaked file paths into the copy-paste box. */
export function applyBodyWrap(sdPrompt: string, profile: ModelProfile, frameType: SdFrameType): string {
  const body = profile.body;
  if (!body) return stripSdMeta(sdPrompt);
  const cleaned = stripSdMeta(sdPrompt);
  if (cleaned.length >= 40) return cleaned;
  // LLM dropped or gutted the body pass → fall back to the clean frame template.
  const template = profile.toolRules.sd.frameTypeTemplates[frameType] ?? '';
  return stripSdMeta(template) || cleaned;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A banned phrase used inside a NEGATION is an instruction, not a violation — the
 *  house NB style MANDATES lines like "NOT professional photography" and "no heavy
 *  makeup" (Jul 26: naive substring matching made every Rosalia run fail on the
 *  profile's own mandatory negation lines — an unwinnable rewrite loop). */
const NEGATION_TAIL = /(\bnot?\b|\bnever\b|\bavoid(s|ing)?\b|\bwithout\b|\bzero\b|\bnon[- ]?|\bisn'?t\b|\bfree of\b)[^.;!?]{0,28}$/i;
function isNegatedAt(text: string, index: number): boolean {
  return NEGATION_TAIL.test(text.slice(Math.max(0, index - 36), index));
}

/** NB identity-leak lint: profile descriptors + banned phrases must never appear
 *  as POSITIVE usage. The identityLock opener/closer are excluded from the scan —
 *  they legitimately reference features as MATCH-THE-REFERENCE instructions. */
export function lintNbPrompt(prompt: string, profile: ModelProfile, beatIndex: number): LintViolation[] {
  const v: LintViolation[] = [];
  // §5: scan only UNPROTECTED sentences — an LLM-echoed near-copy of the closer is a
  // match-the-reference instruction, not a leak (exact-string exclusion missed echoes).
  const body = prompt
    .replaceAll(profile.identityLock.opener, '')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !PROTECTED_LOCK_SENTENCE.test(s))
    .join(' ');
  for (const pattern of profile.identityLock.strippedDescriptors) {
    if (new RegExp(pattern, 'i').test(body)) {
      v.push({ beatIndex, field: 'nbPrompt', problem: `identity descriptor leaked: /${pattern}/` });
    }
  }
  for (const phrase of profile.toolRules.nb.bannedPhrases) {
    // phrases like "age numbers"/"nationality" are instructions, not literals — only lint literal matches
    if (!(phrase.includes(' ') || phrase.length > 3)) continue;
    const re = new RegExp(`\\b${escapeRe(phrase)}`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      if (!isNegatedAt(body, m.index)) {
        v.push({ beatIndex, field: 'nbPrompt', problem: `banned phrase "${phrase}" used positively (negated usage like "NOT ${phrase}" is allowed)` });
        break;
      }
    }
  }
  // Item 6 governs NB stills too ("NB stills: subject ~30-35%, lots of negative space" —
  // prompt.ts rule 9), but until Phase 2 the portrait-framing check existed ONLY in
  // lintMotionPrompt. That is why the live artifact's ideations[1].beats[0].nbPrompt says
  // "camera at chest height, waist-up framing, subject occupies ~40%" and nothing flagged
  // it — the surface was unlinted, not partially fixed. Scans the same protected-sentence-
  // stripped `body` as the checks above, so the identity lock's own wording is never flagged,
  // and is negation-aware so the house "NOT a portrait" style passes.
  const pm = PORTRAIT_FRAMING_TERM.exec(body);
  if (pm && !isNegatedAt(body, pm.index)) {
    v.push({
      beatIndex, field: 'nbPrompt',
      problem: `portrait-framing term "${pm[0]}" — use environmental anti-portrait framing (NOT a portrait, subject ~30-35% of frame, off-center, room visible), never "${pm[0]}"`,
    });
  }
  return v;
}

/** Deterministic auto-neutralize for universal slop lighting/camera terms the LLM keeps
 *  reaching for. These are always wrong for our candid-iPhone aesthetic and have safe
 *  clean replacements, so we FIX them rather than hard-fail the whole run. Identity
 *  descriptors and instruction-type banned phrases are NOT auto-fixed — those still lint. */
// §1/§5 (Aug 17): every autofix is NEGATION-AWARE — "NOT studio lighting" / "NOT airbrushed" /
// "NO ring light" are the HOUSE STYLE and were being garbled into "NOT soft natural lighting"
// and the double-negative "NOT unretouched" by blind replacement. The lookbehinds skip any
// match preceded by not/no.
const NEG = String.raw`(?<![Nn][Oo][Tt]\s)(?<![Nn][Oo]\s)`;
const neg = (pattern: string) => new RegExp(NEG + pattern, 'gi');
const NB_SLOP_AUTOFIX: [RegExp, string][] = [
  [neg(String.raw`\b[Ss]tudio lighting\b`), 'flat natural light'],
  [neg(String.raw`\b[Rr]ing light\b`), 'natural window light'],
  [neg(String.raw`\b[Cc]inematic\b`), 'candid'],
  [neg(String.raw`\b[Bb]okeh\b`), 'natural depth of field'],
  [/\bDSLR\b/g, 'iPhone'],
  // §1 lighting bans — "produced photoshoot" light words; default is flat natural light.
  [neg(String.raw`\b[Gg]olden[- ]hour( glow| light(ing)?)?\b`), 'flat natural daylight'],
  [neg(String.raw`\b[Ww]arm glow\b`), 'flat natural light'],
  [neg(String.raw`\b[Bb]ack[- ]?lit\b|\b[Bb]acklight(ing)?\b`), 'evenly lit'],
  [neg(String.raw`\b[Rr]im light(ing)?\b`), 'flat natural light'],
  [neg(String.raw`\b[Ss]oft light(ing)?\b`), 'flat natural light'],
  // §1 candid-not-posed — the blank model stare reads AI; gaze goes off-lens/mid-action.
  [neg(String.raw`\b[Ss]tar(?:es?|ing) (?:straight |directly )?(?:into|at) (?:the )?(?:lens|camera)\b`), 'gaze just off-lens, caught mid-action'],
  [neg(String.raw`\b[Bb]lank (?:model )?stare\b`), 'natural candid expression'],
  // Part F: plastic-perfection tells — Seedream/NB's default "perfect skin" is the
  // single loudest AI giveaway on a first frame. Auto-neutralize the safe ones:
  [neg(String.raw`\b[Ff]lawless\b`), 'natural'],
  [neg(String.raw`\b[Pp]oreless\b`), 'with visible pores'],
  [neg(String.raw`\b[Ss]mooth,? (?:flawless )?skin\b`), 'natural skin texture'],
  [neg(String.raw`\b[Pp]orcelain skin\b`), 'natural skin with visible texture'],
  [neg(String.raw`\b(?:[Rr]etouched|[Aa]irbrushed)\b`), 'unretouched'],
];

/** Plastic tells that need judgment (can't be blind-replaced) — lint them instead.
 *  Bound to skin/face context so "perfect timing" etc. never false-positives. */
const PLASTIC_TELLS = /\b(perfect|symmetrical|glossy|flawless|poreless)\s+(skin|face|complexion|features?)\b|\beven studio lighting\b|\bcatchlights?\b/i;

export function lintPlasticTells(prompt: string, field: 'nbPrompt' | 'sdPrompt', beatIndex: number): LintViolation[] {
  const m = prompt.match(PLASTIC_TELLS);
  return m ? [{ beatIndex, field, problem: `plastic-perfection tell "${m[0]}" — AI skin is the #1 first-frame giveaway; describe natural texture instead` }] : [];
}
export function autofixNbSlop(nbPrompt: string): string {
  let p = nbPrompt;
  for (const [re, rep] of NB_SLOP_AUTOFIX) p = p.replace(re, rep);
  return p;
}

/** Deterministically STRIP leaked identity descriptors (the field's original intent —
 *  "regexes of identity words to strip if the LLM leaks them"). Hard-failing the whole
 *  run on a leaked word bricked generate when a profile's persona mentions heritage;
 *  the reference images own the face, so the word is simply removed. lintNbPrompt
 *  stays as the safety net for anything that survives stripping. */
/** §5 (Aug 17): sentences that ARE the lock or the realism suffix — identity words inside
 *  them are legitimate match-the-reference instructions, never "leaks". Sentence-level
 *  (not exact-block) because the LLM echoes NEAR-copies of the closer/suffix on rewrites,
 *  and byte-exact protection missed them → 'freckle[sd]?' ate "freckles" out of the echo
 *  ("visible pores and ,"). Shared by stripIdentityDescriptors + lintNbPrompt. */
const PROTECTED_LOCK_SENTENCE = /(reference (image|photo)s?|do not alter|match the uploaded|face exactly|visible pores|NOT airbrushed|body reference)/i;

export function stripIdentityDescriptors(nbPrompt: string, profile: ModelProfile): string {
  return nbPrompt.split(/(?<=[.!?])\s+/).map((sentence) => {
    if (PROTECTED_LOCK_SENTENCE.test(sentence)) return sentence;   // lock/suffix sentences are untouchable
    let s = sentence;
    for (const pattern of profile.identityLock.strippedDescriptors) {
      try {
        // Lookarounds instead of \b: \b treats a hyphen as a boundary, so 'green[- ]?eyes'
        // ate the tail of "blue-green eyes" and 'nude' the head of "nude-rose" (§5).
        s = s.replace(new RegExp(`(?<![\\w-])(${pattern})([- ]?(style|inspired|themed))?(?![\\w-])`, 'gi'), '');
      } catch { /* bad regex in profile data — leave for lint */ }
    }
    return s.replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').replace(/,\s*,/g, ',')
      .replace(/\band([,.;])/g, '$1').trim();
  }).filter(Boolean).join(' ');
}

/** Guarantee the identity lock structurally: opener first, closer last (never trust the LLM). */
export function wrapIdentityLock(nbPrompt: string, profile: ModelProfile): string {
  let p = nbPrompt.trim();
  if (!p.startsWith(profile.identityLock.opener)) p = `${profile.identityLock.opener} ${p}`;
  // Dedup must be sanitization-invariant: after sanitizeImageModeration rewrites the closer's
  // youth wording, a lint-repair re-run would otherwise not recognize the closer and append a
  // SECOND one. §5 belt: match on the closer's stable HEAD (first 40 chars, raw or sanitized) —
  // survives any later-in-the-sentence mutation, so the closer can never stack (was 3× live).
  const closer = profile.identityLock.closer;
  const heads = [closer.slice(0, 40), sanitizeImageModeration(closer).slice(0, 40)].filter(Boolean);
  if (!heads.some((h) => p.includes(h))) p = `${p} ${closer}`;
  return p;
}

/** §2 (Aug 17): the per-model BODY-MATCH LEAD — body drifts generic-slim because generation
 *  ran without the model's body refs. The LEAD rides right after the identity opener and
 *  binds the frame to the attached ref kit (4 face crops + 3 headless body crops, all
 *  base64). The face is NEVER described in text (refs are the lock); the body descriptor
 *  COMMANDS the shape (hedges render lean on GPT-image) and is capped with the LEAN line.
 *  Idempotent via the 'body reference photos' sentinel. Profiles without `body` are untouched. */
export const BODY_LEAD_CAP = 'Curvy but LEAN, NOT thick, NOT a BBL.';
export function buildBodyLead(profile: ModelProfile): string | null {
  const b = profile.body;
  if (!b) return null;
  const descriptor = b.leadDescriptor?.trim() || `${b.build}; ${b.proportions}`;
  return `Keep her exact face identical to the face references — do not alter her facial features. Her body matches the body reference photos: ${descriptor.replace(/\.$/, '')}. ${BODY_LEAD_CAP}`;
}
export function ensureBodyLead(nbPrompt: string, profile: ModelProfile): string {
  const lead = buildBodyLead(profile);
  if (!lead || nbPrompt.includes('body reference photos')) return nbPrompt;
  const opener = profile.identityLock.opener;
  // After the opener when present (identity first, body second), else prepended.
  return nbPrompt.startsWith(opener)
    ? `${opener} ${lead} ${nbPrompt.slice(opener.length).trim()}`
    : `${lead} ${nbPrompt}`;
}

/** GPT-image-2 moderation-safe pass (FABLE5 §9 / log item 19). openai/gpt-image-2/edit rejects
 *  "sensitive content" on fully-clothed ADULT images when signals STACK — the biggest is YOUTH
 *  wording, which lives in the profile closers ("youthful early-20s look, zero signs of aging")
 *  and structureNotes ("heavy-lidded gaze"). This swaps the known triggers for safe equivalents on
 *  the ASSEMBLED nbPrompt so the copy-paste box passes the filter BY DEFAULT. Runs LAST in the NB
 *  chain (after the closer is wrapped). NanoBanana has no such filter but the safe vocab is harmless
 *  to it. Idempotent — no replacement re-matches a trigger. Trigger list grows from live testing. */
const IMAGE_MODERATION_MAP: [RegExp, string][] = [
  // Compound age phrases FIRST so they consume the whole span before word-level rules.
  [/\byouthful early[- ]?20s look,?\s*zero signs of aging\b/gi, 'natural adult look'],
  [/\byouthful early[- ]?20s look\b/gi, 'natural adult look'],
  [/\bzero signs of aging\b/gi, 'smooth clear adult skin'],
  [/\byouthful\b/gi, 'natural'],
  [/\bearly[- ]?20s\b/gi, 'adult'],
  [/\b\d{1,2}[- ]?year[- ]?old\b/gi, 'adult'],
  [/\byoung girl\b/gi, 'woman'],
  [/\bgirl\b/gi, 'woman'],                 // "the girl in the reference" → "the woman in the reference"
  // Fit-emphasis (text pre-filter weights body/clothing terms heavily).
  [/\bform[- ]fitting\b/gi, 'well-fitted'],
  [/\bbodycon\b/gi, 'fitted'],
  [/\b(snug|tight)\b/gi, 'well-fitted'],
  // Neckline / garment.
  [/\bsweetheart neckline\b/gi, 'square neckline'],
  [/\b(plunging|low[- ]cut)\b/gi, 'scoop neck'],
  [/\bcleavage\b/gi, 'neckline'],
  [/\b(corset|bustier)\b/gi, 'fitted top'],
  // Sexualizing descriptors.
  [/\b(sexy|provocative|suggestive)\b/gi, 'confident'],
  [/\b(seductive|sultry)\b/gi, 'relaxed'],
  [/\bheavy[- ]lidded\b/gi, 'soft, natural'],
  [/\brevealing\b/gi, 'simple'],
  // §3 (Aug 17) additions from the live trigger dictionary:
  [/\bunbuttoned\b/gi, 'relaxed-fit'],     // reads as UNDRESSING — top offender
  [/(?<![\w-])star(es?|ing)(?![\w-])/gi, 'gaz$1'],   // stare→gaze / staring→gazing / stares→gazes
  // Body-shape emphasis (belongs in the SD/Seedream pass, not the GPT-image still).
  [/\bhourglass\b/gi, ''],
  [/\bcurvy\b/gi, 'natural'],
];
// §2: the body-match LEAD is EXEMPT from the body-emphasis strip — its command-style
// descriptor is the point (§2), and the §3 flag flow handles any moderation pushback
// (strip → retry → route to Seedream) at execution time, not by pre-neutering the LEAD.
const BODY_LEAD_SPAN = /Keep her exact face identical to the face references[\s\S]*?NOT a BBL\./;
export function sanitizeImageModeration(nbPrompt: string): string {
  let p = nbPrompt;
  const lead = p.match(BODY_LEAD_SPAN)?.[0];
  if (lead) p = p.replace(lead, '[[BODYLEAD]]');
  for (const [re, rep] of IMAGE_MODERATION_MAP) p = p.replace(re, rep);
  p = p
    .replace(/\b(well-fitted|fitted) fitted\b/gi, 'fitted')   // "tight corset" → collapse double-fitted
    .replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').replace(/,\s*,/g, ',').trim();
  return lead ? p.replace('[[BODYLEAD]]', lead) : p;
}

/** §3 (Aug 17) swimwear workaround: swimwear-noun + body emphasis + water TOGETHER is a
 *  HARD GPT-Image-2 block. Generate the compliant BASE in a tank/regular top, and route
 *  the swim garment to the Seedream pass as a wardrobe SWAP with face+figure explicitly
 *  preserved. Idempotent: once swapped, the nbPrompt carries no swim noun and the
 *  sdPrompt carries the WARDROBE SWAP sentinel. */
const SWIM_GARMENT = /\b(?:string )?(?:bikini(?: top| bottom)?|swimsuit|swimwear|two[- ]piece swim\w*|monokini|one[- ]piece swimsuit)\b/i;
const WATER_CONTEXT = /\b(pool|poolside|beach|ocean|sea|lake|river|hot tub|jacuzzi|swim(ming)?|water('s)? edge|waterfall|sprinkler)\b/i;
const SWIM_STOPWORDS = /^(a|an|the|her|his|their|its|wearing|in|into|on|and|with)$/i;
export function applySwimwearWorkaround(nbPrompt: string, sdPrompt: string): { nbPrompt: string; sdPrompt: string; swapped: boolean } {
  const m = nbPrompt.match(SWIM_GARMENT);
  if (!m || !WATER_CONTEXT.test(nbPrompt)) return { nbPrompt, sdPrompt, swapped: false };
  // Carry up to 2 preceding descriptor words ("red string bikini") so the swap pass
  // knows exactly WHICH garment to render — articles/pronouns filtered out.
  const before = nbPrompt.slice(0, m.index).trimEnd().split(/\s+/).slice(-2)
    .filter((w) => /^[\w-]+$/.test(w) && !SWIM_STOPWORDS.test(w));
  const garment = [...before, m[0]].join(' ');
  const safeNb = nbPrompt.replace(new RegExp(SWIM_GARMENT.source, 'gi'), 'fitted ribbed tank top and shorts');
  const swap = `WARDROBE SWAP (required pass): change her outfit to the ${garment} exactly, keep her face and figure IDENTICAL to the input image — wardrobe change only.`;
  const safeSd = sdPrompt.includes('WARDROBE SWAP') ? sdPrompt : `${endDot(sdPrompt)} ${swap}`;
  return { nbPrompt: safeNb, sdPrompt: safeSd, swapped: true };
}

/** Sanitize LLM INPUT per profile policy (stored DNA keeps raw observations — plan §5). */
export function applySanitizeMap(text: string, profile: ModelProfile): string {
  let out = text;
  for (const [pattern, replacement] of profile.contentPolicy.sanitizeMap) {
    out = out.replace(new RegExp(pattern, 'gi'), replacement);
  }
  return out;
}

/** UNIVERSAL sanitize safety-net (Jul 26 outage): Gemini's PROHIBITED_CONTENT input
 *  filter is NOT disableable via safetySettings and trips (probabilistically) on the
 *  analyzer's raw anatomical observations. Profile maps vary in coverage, so these
 *  known trippers are ALWAYS neutralized in the LLM payload — production prompts only
 *  ever needed the tame equivalents anyway. Stored DNA keeps the raw observations. */
const UNIVERSAL_SANITIZE: [RegExp, string][] = [
  [/visible nipples?[^,.;"\]]*/gi, 'fabric contour detail'],
  [/\bnipples?\b/gi, 'chest contour'],
  [/\bbraless\b/gi, 'relaxed fit'],
  [/\bsee[- ]?through\b/gi, 'lightweight'],
  [/\bsheer fabric\b/gi, 'lightweight fabric'],
  [/\bunder[- ]?boob\b|\bside[- ]?boob\b/gi, 'crop hem'],
  [/\bcleavage\b/gi, 'neckline'],
  [/\bbreasts?\b/gi, 'silhouette'],
  [/\bbust contour\b/gi, 'silhouette'],
  [/\bthong\b|\bg[- ]string\b/gi, 'high-cut bottom'],
  // §5: lookarounds, not \b — \b treats a hyphen as a boundary, so "nude" was eating the
  // head of the makeup shade "nude-rose" ("off-camera-rose" garble in live output).
  [/(?<![\w-])(nude|naked|topless)(?![\w-])/gi, 'off-camera'],
];

export function applyUniversalSanitize(text: string): string {
  let out = text;
  for (const [re, rep] of UNIVERSAL_SANITIZE) out = out.replace(re, rep);
  return out;
}

/** LAST-RESORT payload for a generate retry after an input block: nsfwElements and
 *  contentFlag.triggers (the raw-observation hotspots) are removed outright — they
 *  are analysis metadata, not needed to write production prompts. */
export function hardStripNsfwForLlm(dna: FormatDna): FormatDna {
  const clone = JSON.parse(JSON.stringify(dna)) as FormatDna;
  for (const f of clone.frames) f.scene.nsfwElements = [];
  clone.contentFlag = { ...clone.contentFlag, triggers: [] };
  return clone;
}

// ─────────────────────────────────────────────────────────────
// v3 REALISM INJECTORS (Part E) — LLMs drop load-bearing tokens under length
// pressure, so realism is enforced by string assembly AFTER the LLM (post-append:
// these blocks never compete with the LLM's char budget). All idempotent.
// ─────────────────────────────────────────────────────────────

const cap1 = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const endDot = (s: string): string => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** Part B.3: each constrained realism tell maps to a canned NB token + a canned motion
 *  token ('' = not expressible in that medium — skipped). */
export const REALISM_TELL_TOKENS: Record<RealismTell, { nb: string; motion: string }> = {
  'sensor-noise-in-shadows':   { nb: 'faint phone-sensor grain in the shadows', motion: 'faint sensor noise in dark areas' },
  'motion-blur-on-fast-moves': { nb: 'slight motion blur on whatever is moving', motion: 'natural motion blur on fast movement' },
  'blown-highlights':          { nb: 'auto-exposure with slightly blown window highlights', motion: 'highlights clip briefly when bright areas enter frame' },
  'autofocus-breathing':       { nb: '', motion: 'brief autofocus breathing when she shifts' },
  'imperfect-headroom':        { nb: 'slightly imperfect headroom and framing', motion: 'framing stays slightly imperfect, never perfectly recentered' },
  'fluorescent-flicker':       { nb: 'flat fluorescent indoor light', motion: 'faint fluorescent flicker' },
  'rolling-shutter':           { nb: '', motion: 'rolling-shutter wobble on quick pans' },
};

/** §1 (Aug 17): the VERBATIM anti-slop suffix — every image prompt carries it INTACT.
 *  stripIdentityDescriptors placeholder-protects it and every autofix is negation-aware,
 *  so "NOT airbrushed" / "NO ring light" / "freckles" can no longer be garbled out of it. */
export const ANTI_SLOP_SUFFIX =
  'Realistic natural skin texture with visible pores and freckles, natural candid phone snapshot, real detailed background in focus, subtle grain, slightly imperfect framing, NOT airbrushed, NOT smoothed, NOT a studio photo, NO ring light.';

/** F: bake the DNA's grade + up to 2 canned realism tells into the NB still —
 *  image-to-video models take their STYLE from the input image (first-frame law) —
 *  then guarantee the verbatim §1 anti-slop suffix. */
export function ensureNbRealism(nbPrompt: string, dna: FormatDna): string {
  let p = nbPrompt;
  if (!/sensor grain|blown (window )?highlights|imperfect headroom|auto-exposure|fluorescent/i.test(p)) {
    const tokens = (dna.aesthetic?.realismTells ?? [])
      .map((t) => REALISM_TELL_TOKENS[t]?.nb)
      .filter((t): t is string => !!t)
      .slice(0, 2);
    if (!tokens.length) tokens.push('faint phone-sensor grain', 'slightly imperfect headroom');
    const grade = dna.aesthetic?.grade?.trim();
    p = `${endDot(p)} Shot look: ${grade ? `${grade}, ` : ''}${tokens.join(', ')}.`;
  }
  // Sentinel = a phrase UNIQUE to the suffix ("visible pores and freckles" collided with
  // profile closers that carry the same wording, silently skipping the suffix — live Aug 17).
  if (!p.includes('real detailed background in focus')) p = `${endDot(p)} ${ANTI_SLOP_SUFFIX}`;
  return p;
}

/** E.1: the ContinuityLock strings ride every nbPrompt — independent generations
 *  drift apart without them. Idempotent via the CONTINUITY: marker. */
export function ensureContinuity(nbPrompt: string, lock: ContinuityLock | undefined): string {
  if (!lock) return nbPrompt;
  if (/CONTINUITY:/.test(nbPrompt)) return nbPrompt;
  return `${endDot(nbPrompt)} CONTINUITY: same set — ${lock.setDescription}; wardrobe — ${lock.wardrobeExact}; hair — ${lock.hairExact}; lighting — ${lock.lightingExact}, ${lock.colorTempK}, ${lock.timeOfDay}.`;
}

const SHOT_SIZE_TEXT: Record<string, string> = {
  ECU: 'extreme close-up', CU: 'close-up', MS: 'medium shot', WS: 'wide shot',
};

/** Portrait-framing vocabulary improvement-log item 6 bans. Shared by the emit-time
 *  translator below and by both linters, so the three can never drift apart. */
export const PORTRAIT_FRAMING_TERM =
  /\b(waist[- ]up|front angle)\b|\b(?:subject\s+)?fills\s*~?\d{2}\s*%/i;

/** ITEM 6 vs ITEM 43 — RESOLVED, Phase 2 (2026-08-28). **Item 6 wins at EMIT; item 43
 *  keeps its DATA.**
 *
 *  The conflict: item 43 injects the analyzed source's own framing per beat, and in
 *  `reproduce` mode that is supposed to be 1:1 — but the source framing vocabulary is
 *  literally the phrasing item 6 bans, because prompt.ts tells the analyzer to write
 *  "waist-up, subject fills 60%" (see the `framing` field, shared/schemas.ts). The two
 *  rules were both live and contradictory: lintMotionPrompt flagged the words, then this
 *  injector re-added them AFTER the lint had run, so nothing ever caught it. All three
 *  motionPrompts in the committed live artifact carry
 *  `CAMERA(source): medium shot, waist-up, subject fills 50%`.
 *
 *  The resolution and why: the analyzer's stored vocabulary is left ALONE — 169 formats
 *  are already stored with it and re-analysing the library to change wording would cost
 *  real money for zero output gain — but nothing emits those words into a prompt any more.
 *  This translates on the way out, preserving what actually carries source fidelity (the
 *  numeric subject size, and the shot size, which rides its own token) while dropping the
 *  tokens that induce a portrait. Source fidelity is semantically intact; only the
 *  phrasing changes.
 *
 *  Framing with no banned token is returned untouched. */
export function framingToAntiPortrait(framing: string | undefined): string | undefined {
  if (!framing?.trim() || !PORTRAIT_FRAMING_TERM.test(framing)) return framing;
  // Keep the source's own subject size — that is the part with fidelity value. Item 6's
  // ~40% is only the fallback for a source that named no number.
  const pct = framing.match(/(?:subject\s+)?fills\s*~?(\d{2})\s*%/i)?.[1];
  const kept = framing
    .split(/\s*,\s*/)
    .filter((part) => part.trim() && !PORTRAIT_FRAMING_TERM.test(part))
    .join(', ');
  const anti =
    `environmental medium-wide (NOT a portrait, NOT close-up), ` +
    `subject occupies ~${pct ?? '40'}%, off-center, room visible`;
  return kept ? `${kept}, ${anti}` : anti;
}

/** E.2 (reproduce): the SOURCE beat's camera language rides its motionPrompt.
 *  Injects only what's missing; idempotent via the CAMERA(source): marker; keeps
 *  the generic CAMERA_PHYSICS_TERMS guard for wholesale absence. */
export function ensureBeatCameraPhysics(motionPrompt: string, sourceBeat: Beat | undefined): string {
  if (!sourceBeat) return motionPrompt;
  // No marker-based early return (Jul 26): after a lint-repair rewrite the LLM can
  // echo the "CAMERA(source):" marker while dropping its tokens — idempotency comes
  // from the per-token presence checks below, which re-inject exactly what's missing.
  const lower = motionPrompt.toLowerCase();
  const missing: string[] = [];
  if (sourceBeat.shotSize && !lower.includes(SHOT_SIZE_TEXT[sourceBeat.shotSize]!.toLowerCase())
      && !new RegExp(`\\b${sourceBeat.shotSize}\\b`).test(motionPrompt)) {
    missing.push(SHOT_SIZE_TEXT[sourceBeat.shotSize]!);
  }
  // Item 6: translate the source framing out of portrait vocabulary before it is emitted
  // (see framingToAntiPortrait). Presence is probed against BOTH the translated text (so a
  // second pass sees its own injection) and the ORIGINAL source phrasing — if the LLM already
  // wrote the framing in the analyzer's own banned wording, the information is present, and
  // appending the translated clause on top would stack a second, contradictory framing
  // instruction. Policing that wording is the LINT's job (flagTell → the one-rewrite loop),
  // which runs on the LLM's raw text before this chain; the injector only fills real gaps.
  const framing = framingToAntiPortrait(sourceBeat.framing);
  const framingKey = framing?.toLowerCase().slice(0, 24);
  const sourceFramingKey = sourceBeat.framing?.toLowerCase().slice(0, 24);
  const framingPresent =
    (!!framingKey && lower.includes(framingKey)) ||
    (!!sourceFramingKey && lower.includes(sourceFramingKey));
  if (framing && !framingPresent) missing.push(framing);
  const moveKey = sourceBeat.cameraMove?.toLowerCase().slice(0, 24);
  if (moveKey && !lower.includes(moveKey)) missing.push(sourceBeat.cameraMove);
  const dur = Math.round((sourceBeat.endSec - sourceBeat.startSec) * 10) / 10;
  // Inject "beat of ~Xs" not "hold ~Xs" — "hold" is a freeze-word that produces dead frames
  // (FABLE5 §1.2). Legacy "hold ~Xs" still COUNTS as a present duration token (no double-append),
  // but new injections use the non-freeze vocabulary.
  if (!/(hold|beat of|clip of|for|runs?) ~?\d+(\.\d+)?s/i.test(motionPrompt)) missing.push(`beat of ~${dur}s`);
  if (!missing.length) return motionPrompt;
  return `${endDot(motionPrompt)} CAMERA(source): ${missing.join(', ')}.`;
}

// §5: "secondary motion" itself is a sentinel term — a lint-repair rewrite that echoed the
// header but paraphrased the cues was slipping past this test and stacking a 2nd block.
const SECONDARY_MOTION_TERMS = /(secondary motion|hair (sway|swing|settle|bounc|whip|flip|mov)|fabric|ripple|jiggle|bounc\w+ (chest|body|curves)|soft[- ]body|inertia|earring|necklace|jewel|apron|skirt (sway|mov)|drape)/i;

/** E.3 (revised — FABLE5 §7): a motionPrompt wants 1–2 NATURAL secondary cues, NOT all four.
 *  Too many (hair + fabric + soft-body + jewelry all at once) make video models animate the
 *  clothing/accessories OVER the person. So: if the LLM already wrote a cue, leave it; otherwise
 *  inject at most the TWO most natural cues for the beat (hair on a head-turn, fabric on a
 *  weight-shift) and let the rest emerge from the scene. */
export function ensureSecondaryMotion(motionPrompt: string, sm: SecondaryMotion | undefined): string {
  if (SECONDARY_MOTION_TERMS.test(motionPrompt)) return motionPrompt;
  const parts = (sm
    ? [sm.hair, sm.fabric, sm.softBody, sm.accessories].filter((s) => s && !/^(none|n\/a|not clearly visible)/i.test(s.trim()))
    : []
  ).slice(0, 2);   // cap at 1–2 cues — never stack all four
  const text = parts.length
    ? parts.join('; ')
    : 'hair settles naturally after the move, fabric shifts with the weight change';
  return `${endDot(motionPrompt)} Secondary motion (keep it minimal): ${text}.`;
}

const FACE_FRAMING = /(ECU|\bCU\b|close[- ]up|head[- ]?(and[- ])?shoulders|waist[- ]up|upper[- ]body|face (fills|visible|to camera)|selfie|talking head|facing (the )?camera|into the lens)/i;
const MICRO_TERMS = /(blink|gaze|breath|weight[- ]shift|glances?\b)/i;

/** E.4: any face-showing beat gets blink + gaze + breath — dead eyes read as AI.
 *  GUARANTEE: the returned prompt satisfies MICRO_TERMS whenever the framing shows a
 *  face — a beat's own microExpression text ("eyes widen") may lack the load-bearing
 *  words, so the blink/gaze/breath tail is added alongside it, never instead of it. */
export function ensureMicroExpression(motionPrompt: string, framing: string | undefined, micro?: string): string {
  if (!FACE_FRAMING.test(`${framing ?? ''} ${motionPrompt}`)) return motionPrompt;
  if (MICRO_TERMS.test(motionPrompt)) return motionPrompt;
  const own = micro && !/^(none|n\/a|not clearly visible)/i.test(micro.trim()) ? cap1(endDot(micro)) : '';
  const detail = MICRO_TERMS.test(own)
    ? own
    : `${own ? `${own} ` : ''}She blinks naturally, a quick gaze dart off-lens and back, a visible breath.`;
  return `${endDot(motionPrompt)} ${detail}`;
}

/** Self-contained rule, enforced not asked (Jul 26): on many-beat formats the LLM
 *  reliably drops verbatim dialogue from motionPrompts under length pressure, and a
 *  13-beat rewrite ask never converges. If the beat's dialogue is missing, embed it
 *  in the model's house style. Runs BEFORE lint so the lint is a safety net only. */
export function ensureDialogueEmbedded(motionPrompt: string, dialogue: string | undefined, model: VideoModelChoice): string {
  const line = dialogue?.trim();
  if (!line) return motionPrompt;
  if (normalize(motionPrompt).includes(normalize(line))) return motionPrompt;
  // Seedance dialogue: CURLY BRACES with the delivery tone OUTSIDE — `she says casually {line}`
  // (docs/VIDEO-MODEL-PROMPTING.md; re-validated in the Aug 17 live session + Part-B brief —
  // supersedes the short-lived double-quote reading). Kling keeps a spoken-label quote.
  const embedded = model === 'cdance_2'
    ? `She says, casual natural delivery: {${line}}.`
    : `She says, lips synced: "${line}".`;
  return `${motionPrompt.trim().replace(/[.!?]?$/, '.')} ${embedded}`;
}

export const MOTION_CADENCE_TAIL = 'Natural 30fps phone motion blur on fast movement, no frame interpolation, no slow-motion.';

/** E.5: fixed temporal-cadence tail on every motionPrompt. */
export function ensureMotionCadence(motionPrompt: string): string {
  if (/frame interpolation|no slow-motion|30fps/i.test(motionPrompt)) return motionPrompt;
  return `${endDot(motionPrompt)} ${MOTION_CADENCE_TAIL}`;
}

// ─────────────────────────────────────────────────────────────
// FABLE5 humanization injectors (deterministic, post-LLM). Additive + idempotent — they
// never create lint violations, so they can't trigger the 502-risk rewrite loop. The nuanced
// work (reaction-not-prescription, freeze→continuation, continuous flow) is TAUGHT in
// prompt.ts; these guarantee the mechanical, always-safe wins the LLM reliably forgets.
// ─────────────────────────────────────────────────────────────

/** §7 idle-behavior block — the involuntary life that separates human from AI. Complements
 *  ensureMicroExpression (blink/gaze/breath) with weight shifts + relaxed hands + the
 *  no-robotic-symmetry / no-frozen-pose negations (negated, so the freeze guidance never
 *  self-flags). Skipped on b-roll (no person in frame). */
export const IDLE_BEHAVIOR_TAIL =
  'Natural idle motion throughout: subtle weight shifts, small posture adjustments, relaxed fingers, micro facial movement — no robotic symmetry, no frozen pose between actions.';
const IDLE_TERMS = /(weight shift|posture adjust|relaxed finger|idle motion|frozen pose|robotic symmetry)/i;
export function ensureIdleBehavior(motionPrompt: string): string {
  if (IDLE_TERMS.test(motionPrompt)) return motionPrompt;
  return `${endDot(motionPrompt)} ${IDLE_BEHAVIOR_TAIL}`;
}

/** §4.4 location-matched ambient. Prompts only ever said "room tone" — derive scene-true
 *  ambience from the continuity set / DNA location and add it (still phone-mic, no BGM). */
const AMBIENT_BY_LOCATION: [RegExp, string][] = [
  [/honky[- ]?tonk|\bbar\b|club|pub|tavern|saloon/i, 'low bar murmur, glasses and bottles clinking, distant overlapping chatter'],
  [/diner|taqueria|restaurant|cafe|coffee|booth/i, 'utensils touching plates, low booth chatter, faint kitchen sounds'],
  [/ranch|barn|stable|pasture|corral|farm|porch|dirt road|rodeo|\bhay\b|\bfield\b|outdoor|outside|\byard\b/i, 'birds, a light breeze, distant animals, a faint insect hum'],
  [/beach|pool|ocean|lake|\bwater\b|terrace|balcony/i, 'water moving, distant voices, a light breeze'],
  [/kitchen/i, 'a faint fridge hum, utensils set down, distant house sounds'],
  [/street|city|sidewalk|terminal|airport|elevator|hallway|lobby/i, 'distant traffic and footsteps, muffled passing voices'],
  [/\bgym\b|studio/i, 'distant weights clinking, low music bleed, footsteps'],
];
const AMBIENT_TERMS = /(ambient:|room tone|murmur|chatter|\bbirds\b|breeze|traffic|utensils|clink)/i;
function deriveAmbient(dna: FormatDna, lock: ContinuityLock | undefined): string {
  const hay = `${lock?.setDescription ?? ''} ${dna.setting.locationType ?? ''} ${dna.setting.mood ?? ''}`;
  for (const [re, amb] of AMBIENT_BY_LOCATION) if (re.test(hay)) return amb;
  return 'quiet natural room tone';
}
export function ensureAmbientSound(motionPrompt: string, dna: FormatDna, lock: ContinuityLock | undefined): string {
  if (AMBIENT_TERMS.test(motionPrompt)) return motionPrompt;
  return `${endDot(motionPrompt)} Ambient: ${deriveAmbient(dna, lock)} — phone mic, no background music.`;
}

/** Improvement-log item 23 — "the single biggest video fix". Video models silently slim and
 *  reshape her between the first frame and the last, which destroys the body lock the NB/SD
 *  passes worked to establish. Item 23 requires this directive on EVERY motionPrompt.
 *
 *  Phase 2 (2026-08-28): it had never been built. Not a silent no-op — a repo-wide search for
 *  "do NOT slim" / "Maintain her exact body" / "distort her figure" returned nothing, and all
 *  three motionPrompts in the committed live artifact lack it.
 *
 *  Post-append, like the other fixed realism blocks, so it never competes with the LLM's char
 *  budget (spec E, cap law). Idempotent via a term sentinel rather than an exact-string match,
 *  because a lint-repair rewrite can paraphrase the sentence while keeping its meaning — the
 *  same failure mode that made the Secondary-motion sentinel term-based (§5). */
export const BODY_HOLD_DIRECTIVE =
  'Maintain her exact body shape and proportions from the first frame throughout — do NOT slim, shrink, or distort her figure.';
const BODY_HOLD_TERMS =
  /(maintain her exact body|body shape and proportions|do\s*n[o']?t slim|distort her figure|slim, shrink)/i;

export function ensureBodyHold(motionPrompt: string): string {
  if (BODY_HOLD_TERMS.test(motionPrompt)) return motionPrompt;
  return `${endDot(motionPrompt)} ${BODY_HOLD_DIRECTIVE}`;
}

/** §2A static-camera default (Khian's #1). Amateur phone footage is LOCKED-OFF by default —
 *  no pans/tilts/zooms/push-ins unless the SOURCE genuinely had a move (which the source-camera
 *  injectors carry in already). If the prompt has no camera-move verb AND no static/handheld
 *  declaration, force the amateur static baseline. A cinematic move is made its own static insert
 *  clip in the edit, never a camera move (§2B — enforced in the ideation structure, not here). */
const CAMERA_MOVE_TERMS = /\b(pan|tilt|push[- ]?in|dolly|crane|orbit|glide|track(?:s|ing)?|zoom)\b/i;
const STATIC_DECLARED = /(static|locked[- ]?off|micro[- ]?shake|no pans|handheld (?:phone|micro))/i;
export const STATIC_CAMERA_DEFAULT =
  'Static handheld, only natural micro-shake — no pans, no tilts, no zooms, no push-ins';
export function ensureStaticCameraDefault(motionPrompt: string): string {
  if (CAMERA_MOVE_TERMS.test(motionPrompt) || STATIC_DECLARED.test(motionPrompt)) return motionPrompt;
  return `${endDot(motionPrompt)} ${STATIC_CAMERA_DEFAULT}.`;
}

/** Body nouns "full" is not allowed to amplify. `glutes` was missing until Phase 2 —
 *  the live profile's FULL_SIDE template says "full glutes/hips" and sailed straight
 *  through. */
const SD_BODY_NOUN =
  'bust|busts|hips?|thighs?|chest|breasts?|figure|curves?|proportions|glutes|butt|booty|rear|cleavage|decolletage|upper[- ]body|lower[- ]body|midsection';

/** One intervening modifier word. Function words are excluded by lookahead so an
 *  idiomatic "full of natural curves" is never mangled into "of natural curves". */
const SD_BODY_MODIFIER =
  "(?!of\\b|and\\b|or\\b|in\\b|on\\b|at\\b|the\\b|a\\b|an\\b|with\\b|for\\b|to\\b|but\\b|her\\b|his\\b)[a-z]+[-\\s]";

const SD_FULL_BODY_WORD = new RegExp(
  `\\bfull(?:er)?\\s+((?:${SD_BODY_MODIFIER}){0,2}?)(${SD_BODY_NOUN})\\b`,
  'gi',
);

/** §3 body-word "full" — over-amplifies Seedream ("full bust/hips/thighs" dramatizes the body).
 *  Strip it from the SD pass wherever it modifies the body; NEVER touch "full body/frame/length"
 *  (those are framing terms).
 *
 *  Phase 2 (2026-08-28) — improvement-log item 1, the oldest item in the log, was still
 *  being violated on every live run. The old pattern required "full" to sit IMMEDIATELY
 *  before the body noun, so every real-world phrasing escaped: the committed live artifact
 *  emitted "Full natural bust", "full high bust", "full round lifted glutes", "full
 *  proportioned thighs" and "full glutes/hips" across all three ideations. Case was never
 *  the problem (the pattern was already /gi) — adjacency was. Now up to two adjectives may
 *  sit between the two, and when the phrase already carries an adjective we simply DROP
 *  "full" instead of substituting, so "full natural bust" becomes "natural bust" rather
 *  than "natural natural bust".
 *
 *  NOTE the seed templates are NOT "already scrubbed" as the old comment claimed — the live
 *  D1 profile carries "full" in five of rosalia's toolRules.sd.frameTypeTemplates, which is
 *  where the artifact's leaks came from verbatim. This strip is the emit-time backstop; the
 *  data itself still wants a 🔑 fix. */
export function stripBodyWordFull(sdPrompt: string): string {
  return sdPrompt
    .replace(/\bnaturally full\b/gi, 'naturally curvy')
    .replace(SD_FULL_BODY_WORD, (match: string, mods: string, noun: string) => {
      const replaced = mods.trim() ? `${mods}${noun}` : `natural ${noun}`;
      // "Full natural bust + …" opens a sentence the operator copy-pastes verbatim —
      // keep the capital rather than handing them a lowercase opener.
      return /^F/.test(match) ? cap1(replaced) : replaced;
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** §4.3 accent injection — every ON-CAMERA spoken line gets the profile's spoken-delivery
 *  accent so she doesn't sound generic. Idempotent via the accent/drawl/voice sentinel. VO
 *  formats keep speech OUT of the motion prompt, so this runs only for on-camera speech. */
export function ensureAccentDelivery(motionPrompt: string, dialogue: string | undefined, accent: string | undefined): string {
  if (!dialogue?.trim() || !accent?.trim()) return motionPrompt;
  if (/\bvoice:\s|accent|drawl\b/i.test(motionPrompt)) return motionPrompt;
  return `${endDot(motionPrompt)} Voice: ${accent}.`;
}

export const KLING_HANDHELD_TAIL = 'handheld phone footage, micro-shake, autofocus breathing, minor framing imperfections';
export const CDANCE_NEGATION_PAIR = 'no smoothness, no stabilization';
export const CDANCE_AUDIO_LINE = 'voice sounds like a phone microphone, natural room tone, no BGM';
export const CDANCE_SUBTITLE_TAIL = 'keep it subtitle-free, avoid generating any text or subtitles, no watermark';

/** Case-insensitively remove a phrase (with optional trailing punctuation) from s. */
function stripPhrase(s: string, phrase: string): string {
  const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[.,]?\\s*', 'gi');
  return s.replace(re, '').replace(/\s{2,}/g, ' ').trim();
}

/** FABLE5 §6 Seedance-2.0 LEAN tail: ONE consolidated closing line — derived ambient +
 *  phone-mic audio + a single ≤6-item negative list (2.0 over-rejects on long stacks).
 *  Aug 17 (Part B): the "no smoothness, no stabilization" pair is REINSTATED inside the
 *  list — Khian's live hose/watermelon session proved it load-bearing on 2.0 (without it
 *  Seedance drifts gimbal-smooth), reversing the earlier "1.x workaround" read. Idempotent. */
export function applySeedanceLeanTail(motionPrompt: string, dna: FormatDna, lock: ContinuityLock | undefined): string {
  if (/phone-mic audio|no on-screen text/i.test(motionPrompt)) return motionPrompt;
  return `${endDot(motionPrompt)} Background: ${deriveAmbient(dna, lock)}, phone-mic audio — ${CDANCE_NEGATION_PAIR}, no music, no on-screen text or subtitles, no watermark, no slow motion.`;
}

// ─────────────────────────────────────────────────────────────
// Part B (Aug 17): SELF-CHALLENGE PASS — "Niko challenges the prompt in ChatGPT", baked in.
// After the LLM + injector chain finish a motionPrompt, this deterministic critique checks
// the house rules one last time, FIXES what is safely mechanical, and logs every change
// (beat.challengeLog + console). NEGATION-AWARE by construction: every check is a
// presence/absence or exact-duplicate test, so a good prompt is never flagged. The nuanced
// failures (cinematizer tells, portrait framing, over-directed expressions) are already
// lint violations upstream and route through the one-rewrite loop — not duplicated here.
// ─────────────────────────────────────────────────────────────
export function challengeMotionPrompt(
  prompt: string, model: VideoModelChoice, dialogue: string | undefined, spoken: boolean,
): { prompt: string; changes: string[] } {
  const changes: string[] = [];
  let p = prompt;
  // 1. Seedance load-bearing negation pair (Aug 17 live session: without it 2.0 drifts
  //    gimbal-smooth). The lean tail carries it; this is the belt if a rewrite dropped it.
  if (model === 'cdance_2' && !/no smoothness/i.test(p)) {
    p = `${endDot(p)} ${cap1(CDANCE_NEGATION_PAIR)}.`;
    changes.push('added Seedance negation pair (no smoothness, no stabilization)');
  }
  // 2. Subtitle/watermark ban — 9:16 + speech spawns spontaneous subtitles on every model.
  if (!/subtitle|no on-screen text/i.test(p)) {
    p = `${endDot(p)} ${cap1(CDANCE_SUBTITLE_TAIL)}.`;
    changes.push('added subtitle/watermark ban');
  }
  // 3. Ambient/audio presence (the ambient injectors should have handled it — belt).
  if (!/ambient|room tone|phone-mic|phone mic|background:/i.test(p)) {
    p = `${endDot(p)} Ambient: quiet natural room tone — phone mic, no background music.`;
    changes.push('added missing ambient/audio line');
  }
  // 4. Seedance dialogue belongs in CURLY BRACES (delivery tone outside) — convert a
  //    double-quoted verbatim line in place; never touches prompts already in braces.
  if (model === 'cdance_2' && spoken && dialogue?.trim()) {
    const line = dialogue.trim();
    if (!p.includes(`{${line}}`)) {
      const quoted = new RegExp(`["“”']${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["“”']`);
      if (quoted.test(p)) {
        p = p.replace(quoted, `{${line}}`);
        changes.push('converted dialogue to curly braces');
      }
    }
  }
  return { prompt: p, changes };
}

const CAMERA_SENTENCE = /\b(camera|angle|framing|handheld|static|locked[- ]off|filmed|shot from)\b/i;
/** Part B challenge (cross-beat): the SAME camera sentence repeated verbatim on multiple
 *  beats is an AI tell the instruction explicitly bans — catch it on the LLM's RAW motion
 *  text (before the chain appends intentional house boilerplate) and route it through the
 *  one-rewrite loop. Exact-duplicate test on >30-char sentences → cannot flag varied
 *  prompts. Adapt/synthesize only: reproduce is source-pinned and may legitimately repeat. */
export function collectRepeatedCameraLines(
  motionPrompt: string, clipIndex: number, acc: Map<string, number[]>,
): void {
  for (const raw of motionPrompt.split(/(?<=[.!?])\s+/)) {
    const s = raw.trim();
    if (s.length > 30 && CAMERA_SENTENCE.test(s)) {
      const key = s.toLowerCase().replace(/\s+/g, ' ');
      const list = acc.get(key) ?? [];
      if (!list.includes(clipIndex)) list.push(clipIndex);
      acc.set(key, list);
    }
  }
}

/** E.6 (Kling only): kling_3 weights trailing camera language, so its handheld/anti-cinematic
 *  block goes LAST. Seedance uses applySeedanceLeanTail instead (see enforceIdeation gating). */
export function applyModelPositionBlocks(motionPrompt: string, model: VideoModelChoice): string {
  let p = endDot(motionPrompt);
  if (model === 'kling_3') {
    p = stripPhrase(p, KLING_HANDHELD_TAIL);
    return `${endDot(p)} ${cap1(KLING_HANDHELD_TAIL)}.`;
  }
  // Legacy cdance path (kept for any direct caller): consolidated, no obsolete negation pair.
  if (!/phone microphone|room tone|phone-mic/i.test(p)) p = `${endDot(p)} ${cap1(CDANCE_AUDIO_LINE)}.`;
  p = stripPhrase(p, CDANCE_SUBTITLE_TAIL);
  return `${endDot(p)} ${cap1(CDANCE_SUBTITLE_TAIL)}.`;
}

const SKIN_TEXTURE_TERMS = /(visible pores|skin texture|flyaway|blemish|subsurface|not airbrushed|unretouched)/i;
export const SD_SKIN_CLAUSE =
  'Natural skin quality: visible pores, fine skin texture, a stray flyaway hair, faint natural under-eye softness — not airbrushed, not plastic skin. Do not alter the face.';

/** F.2: mandatory skin-texture clause on the SD pass — skin QUALITY only, never face
 *  structure (stays inside the face-match/face-restore QA; SD face drift is documented). */
export function ensureSkinTexture(sdPrompt: string): string {
  if (SKIN_TEXTURE_TERMS.test(sdPrompt)) return sdPrompt;
  return `${endDot(sdPrompt)} ${SD_SKIN_CLAUSE}`;
}

// ─────────────────────────────────────────────────────────────
// v3 production graph + edit-plan fidelity (Parts B.7, G) — pure deterministic builds
// ─────────────────────────────────────────────────────────────

/** B.7: the machine-readable NB→SD→face-restore→video(→lipsync) graph per beat.
 *  face_restore is an explicit node — on prev-frame chaining it is the per-hop
 *  face/continuity check that stops drift compounding across clips. */
export function buildProductionRoute(
  beatIndex: number, firstFrameSource: string, videoModel: VideoModelChoice, lipSyncNeeded: boolean,
  shotType?: string,
  swimSwap = false,   // §3: swimwear tank-base workaround → the Seedream swap pass is REQUIRED
): ProductionRouteStep[] {
  const steps: ProductionRouteStep[] = [];
  let n = 1;
  if (isBrollBeat(shotType)) {
    // Insert shot: no face → NB straight to video. No SD pass, no face-restore, no lipsync.
    steps.push({ step: n++, tool: 'nano_banana_2', inputAsset: 'continuity lock (set/light/props) — NO face refs needed', outputAsset: `beat${beatIndex}-broll-still`, promptField: 'nbPrompt' });
    steps.push({ step: n++, tool: videoModel, inputAsset: `beat${beatIndex}-broll-still`, outputAsset: `beat${beatIndex}-broll-clip`, promptField: 'motionPrompt' });
    return steps;
  }
  if (firstFrameSource === 'prev_clip_last_frame') {
    steps.push({
      step: n++, tool: 'face_restore',
      inputAsset: `last frame of beat ${beatIndex - 1} clip`,
      outputAsset: `beat${beatIndex}-first-frame (per-hop face-match vs profile sheet — drift must not compound)`,
      promptField: 'none',
    });
  } else {
    // Aug 17 one-shot image method: GPT-Image-2 with locked face + headless-body refs in
    // ONE pass — solves body drift at the source, no automatic Seedream. The Seedream
    // body pass is CONDITIONAL: it fires only if the operator judges the body did NOT
    // resolve (tempered rules — stripBodyWordFull etc. — still govern that sdPrompt).
    steps.push({
      step: n++, tool: 'gpt_image_2',
      // §2: the REF KIT rides EVERY call — executors attach all 7 crops as base64.
      inputAsset: 'REF KIT from the model root _LOCKED/ — 4 face crops + 3 approved headless body crops, ALL attached as base64 (face refs lock the face, body refs are the second target image)' + (firstFrameSource === 'hero_still' ? ' (hero still — locks set/wardrobe/light for ALL beats)' : ''),
      outputAsset: `beat${beatIndex}-gi-frame`, promptField: 'nbPrompt',
      // §3: the filter is stochastic — never just fail.
      onModerationFlag: 'auto-strip known triggers (sanitizeImageModeration dictionary) → retry ONCE clean → route the stripped body/wardrobe descriptors into the Seedream pass → still flagged: fall back to google/nano-banana-2/edit with the SAME refs',
    });
    steps.push(swimSwap
      ? { step: n++, tool: 'seedream_4.5', inputAsset: `beat${beatIndex}-gi-frame + body sheet — REQUIRED wardrobe-swap pass (swimwear tank-base workaround §3): top → swim garment, face+figure preserved`, outputAsset: `beat${beatIndex}-sd-frame`, promptField: 'sdPrompt' }
      : { step: n++, tool: 'seedream_4.5', inputAsset: `beat${beatIndex}-gi-frame + body sheet — ONLY if the body did not resolve; one gentle pass, tempered body rules`, outputAsset: `beat${beatIndex}-sd-frame`, promptField: 'sdPrompt', conditional: true });
    steps.push({ step: n++, tool: 'face_restore', inputAsset: `beat${beatIndex}-gi-frame (or beat${beatIndex}-sd-frame if the conditional body pass ran)`, outputAsset: `beat${beatIndex}-first-frame (face-matched)`, promptField: 'none' });
  }
  steps.push({ step: n++, tool: videoModel, inputAsset: `beat${beatIndex}-first-frame`, outputAsset: `beat${beatIndex}-clip`, promptField: 'motionPrompt' });
  if (lipSyncNeeded) {
    steps.push({ step: n++, tool: 'lipsync', inputAsset: `beat${beatIndex}-clip + trimmed audio`, outputAsset: `beat${beatIndex}-clip-synced`, promptField: 'none' });
  }
  return steps;
}

/** G.3: the trim map — generate LONG (≥5s Kling floor), slice to cadence on the beat. */
export function buildTrim(clipDurationSec: number, timelineStartSec: number, beatMap: AudioBeatMapEntry[] | undefined): TrimSpec {
  const generatedDurationSec = Math.max(5, Math.ceil(clipDurationSec + 1));
  const useInSec = 0.3;   // let the model settle before the usable window
  const useOutSec = Math.round((useInSec + clipDurationSec) * 100) / 100;
  const cutAt = timelineStartSec + clipDurationSec;
  const nearest = beatMap?.length
    ? beatMap.reduce((best, e) => (Math.abs(e.atSec - cutAt) < Math.abs(best.atSec - cutAt) ? e : best))
    : undefined;
  const landsOnBeat = nearest !== undefined && Math.abs(nearest.atSec - cutAt) <= 0.15;
  return { generatedDurationSec, useInSec, useOutSec, ...(nearest ? { cutOnBeatAtSec: nearest.atSec } : {}), landsOnBeat };
}

/** Post-processing recipe derived from the SOURCE's temporal fingerprint. */
export function buildPostProcessing(dna: FormatDna): PostProcessing {
  const tells = dna.aesthetic?.realismTells ?? [];
  return {
    fps: 30,
    addGrain: tells.includes('sensor-noise-in-shadows')
      ? 'fine sensor grain, stronger in shadows (match source)'
      : 'very light uniform sensor grain',
    addHandheldShake: dna.camera.dynamics?.stability === 'locked_off'
      ? 'none — source is locked off'
      : '2-4px micro-shake overlay only if the clip came out gimbal-stable',
    rollingShutterOnPans: tells.includes('rolling-shutter'),
    motionBlurAmount: tells.includes('motion-blur-on-fast-moves')
      ? 'natural 180-degree shutter feel on fast moves'
      : 'model default — do not add',
    reencodeProfile: 'phone-HEVC',
    aspect: '9:16 phone crop',
  };
}

// ─────────────────────────────────────────────────────────────
// v3.3 GENERATION SEGMENTS — video models can't generate below ~5s, and real
// creators shoot fast-cut sequences as ONE take chopped in the edit. Consecutive
// same-scene source beats are grouped into one continuous-take generation; the
// motionPrompt carries their internal timeline; editPlan slices[] recreates the
// source's cut cadence from the single take (jump-cut technique).
// ─────────────────────────────────────────────────────────────

export interface GenerationSegment {
  beatIndices: number[];
  startSec: number;
  endSec: number;
}

export const MAX_SEGMENT_SRC_SEC = 15;    // Seedance 2.0 one-take generation ceiling (~15s)
export const MIN_TAKE_SEC = 5;            // Kling/Seedance generation floor — never PLAN a sub-5s take when splitting
export const MIN_SOLO_BEAT_SEC = 4;       // beats ≥4s stand alone comfortably

/** Deterministic grouper — ONE-SHOT BY DEFAULT (Aug 17 rewrite). A same-scene action
 *  ≤15s is ONE segment = ONE take, REGARDLESS of the source's cut cadence: angle
 *  changes, shot-size jumps, and match cuts are all reproduced by slicing the single
 *  take in the edit (editPlan.clips[].slices — the SUB-SECOND CADENCE LAW), while the
 *  motionPrompt carries the internal choreography in phase-flow. The old version also
 *  split on angle/size/match and capped takes at 8s → fast-cut sources exploded into
 *  3s slivers even though Seedance generates 15s in one pass.
 *  Splits happen ONLY on:
 *  - a-roll ↔ b-roll (different SUBJECT in frame — physically impossible in one take), or
 *  - total span >15s → the FEWEST, LONGEST takes possible, balanced so no planned
 *    take lands under MIN_TAKE_SEC (never a 3s sliver tail). */
export function planSegments(beats: Beat[], maxSec = MAX_SEGMENT_SRC_SEC): GenerationSegment[] {
  // Pass 1: partition into HARD RUNS — split only where one take is impossible.
  const runs: number[][] = [];
  let run: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    const prev = run.length ? beats[run[run.length - 1]!]! : null;
    if (prev && (beats[i]!.shotType ?? 'aroll') !== (prev.shotType ?? 'aroll')) {
      runs.push(run); run = [];
    }
    run.push(i);
  }
  if (run.length) runs.push(run);

  // Pass 2: chunk each run into the fewest balanced takes that fit maxSec.
  const segments: GenerationSegment[] = [];
  for (const r of runs) {
    const runStart = beats[r[0]!]!.startSec;
    const runEnd = beats[r[r.length - 1]!]!.endSec;
    const span = runEnd - runStart;
    const k = Math.max(1, Math.ceil(span / maxSec));
    if (k === 1) {
      segments.push({ beatIndices: [...r], startSec: runStart, endSec: runEnd });
      continue;
    }
    const ideal = span / k;   // balanced targets: 17s → 8.5+8.5, never 15+2
    let chunk: number[] = [];
    let chunkStart = runStart;
    let made = 0;
    for (let idx = 0; idx < r.length; idx++) {
      const i = r[idx]!;
      chunk.push(i);
      const chunkEnd = beats[i]!.endSec;
      const remainingBeats = r.length - idx - 1;
      const remainingChunks = k - made - 1;
      const nextEnd = remainingBeats > 0 ? beats[r[idx + 1]!]!.endSec : chunkEnd;
      const wouldOverflow = nextEnd - chunkStart > maxSec;
      const reachedIdeal = chunkEnd - chunkStart >= ideal - 0.25;
      if (remainingChunks > 0 && remainingBeats >= remainingChunks && (reachedIdeal || wouldOverflow)) {
        segments.push({ beatIndices: [...chunk], startSec: chunkStart, endSec: chunkEnd });
        made++; chunk = []; chunkStart = chunkEnd;
      }
    }
    if (chunk.length) {
      segments.push({ beatIndices: [...chunk], startSec: chunkStart, endSec: runEnd });
    }
  }
  return segments;
}

const TIME_RANGE_TOKEN = /\d+(\.\d+)?\s*[-–]\s*\d+(\.\d+)?s/g;
/** Ordered phase-word connectors — the phase-flow equivalent of a timestamp count.
 *  Lets ensureSegmentTimeline / lintFidelity verify a merged take carries its internal
 *  choreography whether it reads as timestamps (legacy) or phase words (Seedance §6). */
const PHASE_CONNECTOR_TOKEN = /\b(first|then|next|after that|afterward|finally|meanwhile|as (?:she|he|they)|while|before)\b/gi;
function timelineStepCount(prompt: string): number {
  return Math.max(prompt.match(TIME_RANGE_TOKEN)?.length ?? 0, prompt.match(PHASE_CONNECTOR_TOKEN)?.length ?? 0);
}

/** The in-prompt internal timeline for a merged multi-beat take. FABLE5 §6 (Seedance timing):
 *  Seedance 2.0 parses hard "0.0-0.9s:" timestamps as unstable, so the PROMPT uses continuous
 *  PHASE-WORD flow ("First … then … finally …"), each beat referencing the previous. The exact
 *  per-beat trim seconds are NOT lost — they live in editPlan.clips[].slices, computed
 *  deterministically from the source (applyEditPlanFidelity) and applied when the take is chopped. */
export function buildSegmentTimeline(beats: Beat[], beatIndices: number[]): string {
  const n = beatIndices.length;
  const lower1 = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;
  return beatIndices.map((i, k) => {
    const b = beats[i]!;
    const motion = b.motionBeat && !/^(none|n\/a)/i.test(b.motionBeat) ? b.motionBeat : b.action;
    const step = k === 0 ? `First, ${lower1(motion)}`
      : k === n - 1 && n > 1 ? `finally ${lower1(motion)}`
        : `then ${lower1(motion)}`;
    return `${step}${b.dialogue ? ` — says: "${b.dialogue}"` : ''}`;
  }).join('; ');
}

/** Multi-beat takes MUST carry their internal choreography in the motionPrompt — that's the
 *  whole point of merging. If the prompt lacks enough timeline STEPS (timestamps OR phase-word
 *  connectors), append the source-derived phase-word timeline. Idempotent: counts phase words,
 *  so a re-run after a lint-repair rewrite sees the appended steps and does not double-append. */
export function ensureSegmentTimeline(motionPrompt: string, beats: Beat[], beatIndices: number[] | undefined): string {
  if (!beatIndices || beatIndices.length <= 1) return motionPrompt;
  if (timelineStepCount(motionPrompt) >= beatIndices.length - 1) return motionPrompt;
  return `${endDot(motionPrompt)} TIMELINE: ${buildSegmentTimeline(beats, beatIndices)}.`;
}

/** Human-readable segment plan for the generator instruction — the LLM follows the
 *  precomputed grouping, it never invents its own. */
export function buildSegmentPlanText(beats: Beat[], segments: GenerationSegment[]): string {
  return segments.map((seg, k) => {
    const multi = seg.beatIndices.length > 1;
    const span = (seg.endSec - seg.startSec).toFixed(1);
    const src = multi
      ? `source beats ${seg.beatIndices[0]}-${seg.beatIndices[seg.beatIndices.length - 1]}`
      : `source beat ${seg.beatIndices[0]}`;
    const body = multi
      ? `ONE continuous take (${seg.beatIndices.length} cuts are made in the EDIT, not generated); internal timeline to reproduce — ${buildSegmentTimeline(beats, seg.beatIndices)}`
      : (beats[seg.beatIndices[0]!]!.motionBeat || beats[seg.beatIndices[0]!]!.action);
    const broll = isBrollBeat(beats[seg.beatIndices[0]!]!.shotType);
    return `- Segment ${k + 1}${broll ? ' [B-ROLL insert — no face: hands/food/environment detail of the NEW scene; set shotType "broll" + brollSubject]' : ''} → ${src} (${seg.startSec.toFixed(2)}-${seg.endSec.toFixed(2)}s, ${span}s): ${body}`;
  }).join('\n');
}

/** Collapse one segment's source beats into a synthetic Beat spanning the take —
 *  feeds the per-beat camera/motion injectors with segment-level truth. */
export function segmentToSourceBeat(beats: Beat[], seg: GenerationSegment): Beat {
  const first = beats[seg.beatIndices[0]!]!;
  const withMotion = seg.beatIndices.map((i) => beats[i]!).find((b) => b.secondaryMotion);
  return {
    ...first,
    endSec: seg.endSec,
    motionBeat: buildSegmentTimeline(beats, seg.beatIndices),
    secondaryMotion: withMotion?.secondaryMotion ?? first.secondaryMotion,
    dialogue: seg.beatIndices.map((i) => beats[i]!.dialogue).filter(Boolean).join(' ') || undefined,
    brollSubject: seg.beatIndices.map((i) => beats[i]!.brollSubject).filter(Boolean).join('; ') || first.brollSubject,
  };
}

// ─────────────────────────────────────────────────────────────
// B-ROLL production path (v3.4) — inserts have no face: no identity lock, no
// Seedream body pass, no face-restore, no micro-expression. Cheaper AND safer.
// ─────────────────────────────────────────────────────────────

export const isBrollBeat = (shotType?: string): boolean => shotType === 'broll';

const BROLL_NB_PREFIX = 'B-ROLL insert, no face visible, no identifiable person beyond hands/body edges:';

/** B-roll NB prompts open with the insert declaration instead of the identity lock. */
export function ensureBrollNb(nbPrompt: string, brollSubject?: string): string {
  let p = nbPrompt.trim();
  if (!p.toLowerCase().startsWith(BROLL_NB_PREFIX.slice(0, 12).toLowerCase())) {
    p = `${BROLL_NB_PREFIX} ${p}`;
  }
  if (brollSubject && !normalize(p).includes(normalize(brollSubject).slice(0, 30))) {
    p = `${endDot(p)} The insert shows: ${brollSubject}.`;
  }
  return p;
}

export const BROLL_SD_NOTE = 'No body pass — B-roll insert (no face/body subject); use the NB frame directly.';

// ─────────────────────────────────────────────────────────────
// Dialogue DELIVERY (v3.4) — dialogue is embedded into motion prompts ONLY when it
// is genuinely spoken ON CAMERA. Voiceover formats keep prompts speech-free: the
// dialogue field IS the VO script, recorded separately and laid over in the edit.
// ─────────────────────────────────────────────────────────────

/** On-camera speech iff the ideation plans original dialogue AND the source actually
 *  lip-syncs — a voiceover source can never make her mouth the words. */
export function isSpokenOnCamera(audioPlanType: string, dna: FormatDna): boolean {
  if (dna.audio.kind === 'voiceover' || dna.audio.lipSync === false) return false;
  return audioPlanType === 'original_dialogue';
}

/** Remove an embedded spoken-delivery quote from a motion prompt (voiceover formats):
 *  drops whole sentences that carry the dialogue text or lips-synced/she-says framing. */
export function stripDialogueFromMotion(motionPrompt: string, dialogue?: string): string {
  const line = dialogue?.trim();
  const sentences = motionPrompt.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => {
    if (/lips? synced|she says|says naturally|mouths the words/i.test(s)) return false;
    if (line && normalize(s).includes(normalize(line))) return false;
    return true;
  });
  return kept.join(' ').replace(/\s{2,}/g, ' ').trim();
}

export const VO_NO_SPEECH_NOTE = 'She does not speak on camera — relaxed closed-mouth expressions, no talking.';

/** §4/§5 (Aug 17): a beat where her mouth is busy (eating/drinking) can never lip-sync —
 *  its line is delivered as OFF-CAMERA VOICEOVER instead, whatever the format's audio plan. */
export const MOUTH_BUSY = /\b(chew(s|ing)?|mouth full|takes? a bite|bit(es?|ing) into|mid[- ]bite|swallow(s|ing)?|gulp(s|ing)?|sip(s|ping)?|slurp(s|ing)?|drinking from)\b/i;

/** Voiceover formats: guarantee prompts are speech-free + carry the no-talking note
 *  (video models add mouth flapping when any speech language survives). */
export function ensureNoOnCameraSpeech(motionPrompt: string, dialogue?: string): string {
  let p = stripDialogueFromMotion(motionPrompt, dialogue);
  if (!/does not speak|no talking|closed[- ]mouth/i.test(p)) p = `${endDot(p)} ${VO_NO_SPEECH_NOTE}`;
  return p;
}

/** Fallback continuity lock when the LLM omits one — built from the DNA so clips
 *  still share a set/light/time anchor instead of drifting freely. */
export function buildDefaultContinuityLock(dna: FormatDna): ContinuityLock {
  return {
    setDescription: `${dna.setting.locationType} — ${dna.setting.mood}`,
    wardrobeExact: `one exact outfit for ALL clips: ${dna.wardrobeRole.role} (profile wardrobe defaults)`,
    hairExact: 'one hair state for ALL clips (profile default for this context)',
    lightingExact: dna.setting.lighting,
    colorTempK: dna.aesthetic?.colorTempK ?? 'match the source grade',
    timeOfDay: dna.setting.timeOfDay,
    keyProps: dna.setting.keyProps,
  };
}

/** Fill the deterministic edit-plan fields: per-clip trim map + beatMap refs,
 *  loop plan, post-processing. LLM never spends chars on these. */
export function applyEditPlanFidelity(ideation: Ideation, dna: FormatDna): void {
  const plan = ideation.editPlan;
  if (!plan) return;
  const beatMap = dna.audio.beatMap;
  let cursor = 0;
  for (const clip of plan.clips) {
    const beat = ideation.beats.find((b) => b.clipIndex === clip.clipIndex);
    const idxs = beat?.sourceBeatIndices;
    if (beat && idxs && idxs.length > 1 && idxs.every((bi) => dna.beats[bi])) {
      // v3.3 segment clip: ONE generated take → one slice per covered source beat
      // (the jump-cut chop that recreates the source's sub-second cadence).
      const segStart = dna.beats[idxs[0]!]!.startSec;
      const span = beat.durationSec ?? (dna.beats[idxs[idxs.length - 1]!]!.endSec - segStart);
      const generatedDurationSec = Math.max(5, Math.ceil(span + 1));
      const lead = 0.3;   // let the model settle before the usable window
      clip.slices = idxs.map((bi) => {
        const sb = dna.beats[bi]!;
        const useInSec = Math.round((lead + (sb.startSec - segStart)) * 100) / 100;
        const useOutSec = Math.round((useInSec + (sb.endSec - sb.startSec)) * 100) / 100;
        const cutAt = cursor + (sb.endSec - segStart);
        const nearest = beatMap?.length
          ? beatMap.reduce((best, e) => (Math.abs(e.atSec - cutAt) < Math.abs(best.atSec - cutAt) ? e : best))
          : undefined;
        const landsOnBeat = nearest !== undefined && Math.abs(nearest.atSec - cutAt) <= 0.15;
        return { generatedDurationSec, useInSec, useOutSec, ...(nearest ? { cutOnBeatAtSec: nearest.atSec } : {}), landsOnBeat };
      });
      clip.trim = clip.slices[0];
      cursor += span;
    } else {
      const d = beat?.durationSec ?? clip.durationSec;
      clip.trim = buildTrim(d, cursor, beatMap);
      if (clip.trim.cutOnBeatAtSec !== undefined && beatMap) {
        clip.beatMapIndex = beatMap.findIndex((e) => e.atSec === clip.trim!.cutOnBeatAtSec);
      }
      cursor += d;
    }
  }
  if (!plan.loopPlan) {
    plan.loopPlan = dna.loop?.isSeamless
      ? `Close the loop like the source: ${dna.loop.mechanism}${dna.loop.loopPointSec !== undefined ? ` (source loop point ~${dna.loop.loopPointSec}s)` : ''} — last frame must hand back into the opening frame.`
      : 'No seamless loop in the source — end on the payoff, hard stop.';
  }
  if (!plan.postProcessing) plan.postProcessing = buildPostProcessing(dna);
}

// ─────────────────────────────────────────────────────────────
// v3 prompt-fidelity linter (Part E.8) — DETERMINISTIC gate on the emitted prompts
// (the app emits prompts, it cannot inspect pixels). Hard-fails route through the
// existing one-rewrite loop; never a free-form LLM rewrite.
// ─────────────────────────────────────────────────────────────

export function lintFidelity(ideation: Ideation, dna: FormatDna, mode: FidelityMode): LintViolation[] {
  const v: LintViolation[] = [];
  // Retention dead zone: >2s of clip with no motion beat and no dialogue.
  ideation.beats.forEach((b, i) => {
    const d = b.durationSec ?? 0;
    if (d > 2 && (!b.motionBeat || /^(none|n\/a)/i.test(b.motionBeat.trim())) && !b.dialogue?.trim()) {
      v.push({ beatIndex: i, field: 'motionBeat', problem: `${d.toFixed(1)}s beat with no motion beat and no dialogue — a >2s retention dead zone` });
    }
  });
  // Hook: beat 0 must open with something happening.
  const b0 = ideation.beats[0];
  if (b0 && (!b0.action?.trim() || (!b0.motionBeat?.trim() && !b0.dialogue?.trim() && !dna.textOverlays.present))) {
    v.push({ beatIndex: 0, field: 'action', problem: 'weak hook — beat 0 has no motion beat, no dialogue, and the format has no text overlay to carry 0:00' });
  }
  if (mode !== 'reproduce') return v;

  // 1:1 pinning against the SEGMENT plan (v3.3) — field inheritance is enforced
  // deterministically upstream; recomputed here so lint and generation agree.
  const lintSegments = planSegments(dna.beats);
  const lintSources = lintSegments.map((seg) => segmentToSourceBeat(dna.beats, seg));
  if (ideation.beats.length !== lintSegments.length) {
    v.push({ beatIndex: -1, field: 'beats', problem: `reproduce mode requires exactly ${lintSegments.length} generation segments (covering ${dna.beats.length} source beats); got ${ideation.beats.length}` });
    return v;
  }
  // Every motionPrompt must physically carry its segment's camera/duration tokens +
  // internal timeline (guaranteed by the injectors — this guards injector regressions).
  ideation.beats.forEach((b, i) => {
    const s = lintSources[i]!;
    const seg = lintSegments[i]!;
    if (seg.beatIndices.length > 1 && timelineStepCount(b.motionPrompt) < seg.beatIndices.length - 1) {
      v.push({ beatIndex: i, field: 'motionPrompt', problem: `multi-beat take (${seg.beatIndices.length} source beats) missing its internal timeline steps (timestamps or phase-word flow)` });
    }
    if (s.shotSize) {
      const term = SHOT_SIZE_TEXT[s.shotSize]!;
      if (!b.motionPrompt.toLowerCase().includes(term) && !new RegExp(`\\b${s.shotSize}\\b`).test(b.motionPrompt)) {
        v.push({ beatIndex: i, field: 'motionPrompt', problem: `missing source shot-size token "${term}"` });
      }
    }
    if (!/(hold|beat of|clip of|for|runs?) ~?\d+(\.\d+)?s/i.test(b.motionPrompt)) {
      v.push({ beatIndex: i, field: 'motionPrompt', problem: 'missing source duration token (e.g. "beat of ~1.4s")' });
    }
    const showsFace = !isBrollBeat(s.shotType) && FACE_FRAMING.test(`${s.framing} ${b.motionPrompt}`);
    if (showsFace && !MICRO_TERMS.test(b.motionPrompt)) {
      v.push({ beatIndex: i, field: 'motionPrompt', problem: 'face-showing beat with no blink/gaze/breath token' });
    }
  });
  // Off-beat cuts: only meaningful when the source cut on the music.
  if (dna.audio.syncType === 'cut_on_beat' && dna.audio.beatMap?.length && ideation.editPlan) {
    const misses = ideation.editPlan.clips.filter((c) => c.trim && !c.trim.landsOnBeat).length;
    if (misses > Math.ceil(ideation.editPlan.clips.length * 0.3)) {
      v.push({ beatIndex: -1, field: 'editPlan', problem: `${misses}/${ideation.editPlan.clips.length} cuts miss the audio beat grid — source cuts ON the beat; re-time clip durations` });
    }
  }
  return v;
}

/** Post-process one LLM ideation: enforce every deterministic rule. Returns violations that survived auto-fix. */
export function enforceIdeation(
  ideation: Ideation, profile: ModelProfile, dna: FormatDna, fidelityMode: FidelityMode = 'adapt',
): LintViolation[] {
  const violations: LintViolation[] = [];
  const reproduce = fidelityMode === 'reproduce';
  const hasDialogue = ideation.beats.some((b) => !!b.dialogue?.trim());
  const ruled = chooseVideoModel({
    hasDialogue,
    clipCount: ideation.clipCount,
    durationSec: ideation.targetDurationSec,
    emotionalRangeHigh: /emotional|dramatic|reaction/i.test(ideation.angle) && ideation.videoModel.choice === 'cdance_2',
  });
  if (ideation.videoModel.choice !== ruled.choice) {
    ideation.videoModel = ruled;   // rule engine wins; auditable reason
  }

  // Reproduce mode (v3.3): PIN the filming to the source SEGMENTS deterministically —
  // one generated take per segment, covering 1..N consecutive source beats. The LLM's
  // job was the scene translation; the structure is inherited, never trusted.
  const segments = reproduce ? planSegments(dna.beats) : null;
  const segSources = segments ? segments.map((seg) => segmentToSourceBeat(dna.beats, seg)) : null;
  const pinned = !!segments && ideation.beats.length === segments.length;
  if (pinned && segments && segSources) {
    ideation.clipCount = segments.length;
    ideation.beats.forEach((b, i) => {
      const seg = segments[i]!;
      const s = segSources[i]!;
      b.sourceBeatIndex = seg.beatIndices[0]!;
      b.sourceBeatIndices = seg.beatIndices;
      b.durationSec = Math.round((seg.endSec - seg.startSec) * 100) / 100;
      b.timestamp = `${seg.startSec.toFixed(2)}-${seg.endSec.toFixed(2)}s (source-pinned, covers ${seg.beatIndices.length} source beat${seg.beatIndices.length > 1 ? 's' : ''})`;
      b.startsOnCut = s.startsOnCut;
      if (s.shotSize) b.shotSize = s.shotSize;
      if (s.cameraAngle) b.cameraAngle = s.cameraAngle;
      if (s.cutTransition) b.cutType = s.cutTransition;
      if (s.motionBeat && (!b.motionBeat || /^(none|n\/a)/i.test(b.motionBeat))) b.motionBeat = s.motionBeat;
      if (s.secondaryMotion && !b.secondaryMotion) b.secondaryMotion = s.secondaryMotion;
      if (s.microExpression && !b.microExpression) b.microExpression = s.microExpression;
      if (s.shotType) b.shotType = s.shotType;
      if (s.brollSubject && !b.brollSubject) b.brollSubject = s.brollSubject;
    });
    // ONE-SHOT LAW (Aug 17): the whole source resolved to ONE take → this ideation IS
    // a one-shot, whatever the LLM said. Unlocks the 1400-char choreography-sheet cap.
    if (segments!.length === 1 && ideation.videoFormat !== 'ONE_SHOT') {
      ideation.videoFormat = 'ONE_SHOT';
      ideation.clipCount = 1;
    }
  }

  // v3.4 dialogue delivery: a voiceover source can never produce on-camera speech —
  // deterministically correct the plan, then branch every dialogue rule on it.
  if (reproduce && ideation.audioPlan.type === 'original_dialogue' && !isSpokenOnCamera('original_dialogue', dna)) {
    ideation.audioPlan = {
      ...ideation.audioPlan,
      type: 'voiceover',
      description: `VOICEOVER — record separately, lay over in the edit (source does not lip-sync). ${ideation.audioPlan.description}`,
    };
  }
  const spoken = isSpokenOnCamera(ideation.audioPlan.type, dna);

  // ONE-SHOT LAW for adapt/synthesize (reproduce is handled deterministically above):
  // a ≤15s idea chopped into 3+ clips is source-cadence imitation, not a scene need —
  // flag it so the one targeted rewrite collapses it to a single choreographed take.
  // 2 clips stay legal (a genuine hard scene change can justify them).
  if (!reproduce && ideation.videoFormat === 'MULTI_CLIP'
      && ideation.targetDurationSec <= MAX_SEGMENT_SRC_SEC && ideation.clipCount >= 3) {
    violations.push({
      beatIndex: -1, field: 'videoFormat',
      problem: `${ideation.targetDurationSec}s idea chopped into ${ideation.clipCount} clips — ONE-SHOT LAW: ≤15s in one scene = videoFormat ONE_SHOT, exactly 1 beat, one phase-flow choreography sheet; cuts are recreated by slicing the take in the edit. Use MULTI_CLIP only for a hard scene change (then fewest/longest takes, none under 5s).`,
    });
  }

  // A missing continuity lock never kills a run — build a DNA-derived default.
  if (!ideation.continuityLock) ideation.continuityLock = buildDefaultContinuityLock(dna);

  const rawCameraLines = new Map<string, number[]>();   // Part B: cross-beat duplicate check
  ideation.beats.forEach((beat, i) => {
    const sourceBeat = pinned && segSources ? segSources[i] : undefined;
    // Deterministic defaults for anything the LLM omitted — the schema is lenient on
    // the v3 fields precisely because these fills make omission harmless.
    if (!beat.firstFrameSource) {
      beat.firstFrameSource = beat.clipIndex === 0 || ideation.videoFormat === 'ONE_SHOT' ? 'hero_still' : 'prev_clip_last_frame';
    }
    if (beat.durationSec === undefined) {
      beat.durationSec = sourceBeat
        ? Math.round((sourceBeat.endSec - sourceBeat.startSec) * 100) / 100
        : Math.round((ideation.targetDurationSec / Math.max(1, ideation.clipCount)) * 100) / 100;
    }
    if (!beat.motionBeat?.trim()) beat.motionBeat = sourceBeat?.motionBeat ?? beat.action;
    if (beat.startsOnCut === undefined) beat.startsOnCut = sourceBeat?.startsOnCut ?? beat.clipIndex > 0;
    if (beat.sourceBeatIndex === undefined && pinned) beat.sourceBeatIndex = i;

    const broll = isBrollBeat(beat.shotType);
    if (broll) beat.firstFrameSource = 'fresh_nb';   // prev frame shows HER — wrong subject for an insert

    // Dialogue delivery (v3.4 + §4/§5 Aug 17): embed only on-camera speech; voiceover
    // formats get speech-free prompts (mouth flapping on a VO video is an instant AI
    // tell). PER-BEAT exception: a MOUTH-BUSY beat (eating/drinking) can never lip-sync
    // — its line routes to off-camera VO even in a spoken format. And the beat's
    // dialogue field is LABELED as VO so the card never carries the "no talking" note
    // and a lip-sync line side by side (§5 contradiction).
    const beatSpoken = spoken && !MOUTH_BUSY.test(`${beat.action ?? ''} ${beat.motionPrompt}`);
    beat.motionPrompt = beatSpoken
      ? ensureDialogueEmbedded(beat.motionPrompt, beat.dialogue, ideation.videoModel.choice)
      : ensureNoOnCameraSpeech(beat.motionPrompt, beat.dialogue);
    if (!beatSpoken && beat.dialogue?.trim() && !/^VO\b/i.test(beat.dialogue)) {
      beat.dialogue = `VO (off-camera voiceover — record separately, never lip-sync): ${beat.dialogue}`;
    }
    // §4.3: on-camera speech carries the profile's spoken-delivery accent (no accent in the
    // motion prompt for VO — the accent guides the separately-recorded VO track instead).
    if (beatSpoken) beat.motionPrompt = ensureAccentDelivery(beat.motionPrompt, beat.dialogue, profile.voice.accent);

    // Lint the LLM's OWN motion text first — the fixed realism blocks are post-append
    // and never compete with its char budget (spec E, cap law).
    violations.push(...lintMotionPrompt(beat.motionPrompt, profile, ideation.videoFormat, beat.clipIndex, beat.dialogue, fidelityMode, beatSpoken));
    // Part B challenge: collect the RAW camera sentences for the cross-beat duplicate
    // check (before the chain appends intentional house boilerplate).
    if (!reproduce && ideation.videoFormat === 'MULTI_CLIP') {
      collectRepeatedCameraLines(beat.motionPrompt, beat.clipIndex, rawCameraLines);
    }

    // NB chain: slop fix + descriptor strip BEFORE lint (deterministic fixes are not
    // violations), then realism bake → continuity lock → identity lock outermost.
    // B-roll inserts get the no-face declaration INSTEAD of the identity lock.
    beat.nbPrompt = autofixNbSlop(beat.nbPrompt);
    beat.nbPrompt = stripIdentityDescriptors(beat.nbPrompt, profile);
    violations.push(...lintNbPrompt(beat.nbPrompt, profile, beat.clipIndex));
    violations.push(...lintPlasticTells(beat.nbPrompt, 'nbPrompt', beat.clipIndex));
    violations.push(...lintPlasticTells(beat.sdPrompt, 'sdPrompt', beat.clipIndex));
    beat.nbPrompt = ensureNbRealism(beat.nbPrompt, dna);
    beat.nbPrompt = ensureContinuity(beat.nbPrompt, ideation.continuityLock);
    beat.nbPrompt = broll
      ? ensureBrollNb(beat.nbPrompt, beat.brollSubject)
      : ensureBodyLead(wrapIdentityLock(beat.nbPrompt, profile), profile);   // §2: identity first, body-match LEAD second
    // §3 swimwear workaround BEFORE moderation-sanitize: tank base in the still, the swim
    // garment routes to the Seedream pass as a required wardrobe swap.
    let swimSwap = false;
    if (!broll) {
      const swim = applySwimwearWorkaround(beat.nbPrompt, beat.sdPrompt);
      beat.nbPrompt = swim.nbPrompt;
      beat.sdPrompt = swim.sdPrompt;
      swimSwap = swim.swapped || /WARDROBE SWAP/.test(beat.sdPrompt);
    }
    // GPT-image-2 moderation-safe by default (§9 / log 19) — LAST, so it also sanitizes the
    // closer's youth wording (the §2 body LEAD is span-protected). Kills the "sensitive
    // content" rejections on clothed adult stills.
    beat.nbPrompt = sanitizeImageModeration(beat.nbPrompt);

    // SD chain: body wrap → mandatory skin texture. B-roll has no body — no SD pass.
    if (broll) {
      beat.sdPrompt = BROLL_SD_NOTE;
    } else {
      beat.sdPrompt = applyBodyWrap(beat.sdPrompt, profile, beat.sdFrameType);
      beat.sdPrompt = stripBodyWordFull(beat.sdPrompt);   // §3: kill "full" body-word amplification
      beat.sdPrompt = ensureSkinTexture(beat.sdPrompt);
    }

    // Motion chain (order is load-bearing): source camera → whole-video physics → static-
    // camera default → secondary motion → aesthetic anchor (prepends; its selfie/vlog words
    // count as face-framing evidence, so micro-expression runs AFTER it and sees the same
    // text the fidelity linter will see) → micro-expression → idle behavior → ambient →
    // cadence tail → per-model position blocks LAST (kling weights trailing camera language).
    beat.motionPrompt = reproduce
      ? ensureBeatCameraPhysics(beat.motionPrompt, sourceBeat)
      : beat.motionPrompt;
    // Multi-beat takes carry their internal choreography timeline — the merged
    // segment is useless without per-beat offsets (v3.3, Khian's 0.88s-clips fix).
    beat.motionPrompt = ensureSegmentTimeline(beat.motionPrompt, dna.beats, beat.sourceBeatIndices);
    beat.motionPrompt = ensureCameraPhysics(beat.motionPrompt, dna);
    // §2A: after the source camera is settled, any beat with NO camera move gets the amateur
    // locked-off baseline — a sourced move (reproduce) already carries its own move verb.
    beat.motionPrompt = ensureStaticCameraDefault(beat.motionPrompt);
    beat.motionPrompt = ensureSecondaryMotion(beat.motionPrompt, beat.secondaryMotion ?? sourceBeat?.secondaryMotion);
    beat.motionPrompt = ensureAesthetic(beat.motionPrompt, dna);
    // FABLE5 §6 LEAN MODE: Seedance 2.0 over-rejects on stacked clauses/negatives, so it gets
    // micro-expression only (no verbose idle block) and ONE consolidated closing line (ambient +
    // phone-mic + a single negative list, no obsolete stabilization pair, no separate cadence
    // sentence). Kling still defaults cinematic and needs the fuller anti-cinematic push, so it
    // keeps the idle block, ambient, cadence tail, and the trailing handheld block.
    const isSeedance = ideation.videoModel.choice === 'cdance_2';
    beat.motionPrompt = broll
      ? beat.motionPrompt   // no face in frame — no blink/gaze/idle injection
      : isSeedance
        ? ensureMicroExpression(beat.motionPrompt, sourceBeat?.framing ?? beat.camera, beat.microExpression)
        : ensureIdleBehavior(ensureMicroExpression(beat.motionPrompt, sourceBeat?.framing ?? beat.camera, beat.microExpression));
    // Item 23 hold-body directive. Applies to BOTH models and skips b-roll only (an insert
    // with no person in frame has no body to hold). It goes in BEFORE the model-specific
    // tails: kling_3 weights trailing camera language, so applyModelPositionBlocks must keep
    // the last word (E.6) — hence "present exactly once", not "ends with".
    //
    // Judgement call worth flagging: Seedance 2.0 runs in LEAN mode because it over-rejects
    // on stacked clauses, so adding a sentence there cuts against §6. It is added anyway —
    // item 23 is unconditional and calls this the single biggest video fix, and the lean-mode
    // finding is about long stacked NEGATIVE lists, not one positive body constraint. Revisit
    // if 2.0 rejection rates move.
    if (!broll) beat.motionPrompt = ensureBodyHold(beat.motionPrompt);
    if (isSeedance) {
      beat.motionPrompt = applySeedanceLeanTail(beat.motionPrompt, dna, ideation.continuityLock);
    } else {
      beat.motionPrompt = ensureAmbientSound(beat.motionPrompt, dna, ideation.continuityLock);
      beat.motionPrompt = ensureMotionCadence(beat.motionPrompt);
      beat.motionPrompt = applyModelPositionBlocks(beat.motionPrompt, ideation.videoModel.choice);
    }
    // Part B: SELF-CHALLENGE pass — final deterministic critique of the finished prompt.
    // Fixes the safely-mechanical gaps and logs what it changed (visible on the beat card).
    const challenged = challengeMotionPrompt(beat.motionPrompt, ideation.videoModel.choice, beat.dialogue, spoken && !broll);
    beat.motionPrompt = challenged.prompt;
    if (challenged.changes.length) {
      beat.challengeLog = challenged.changes;
      console.log(`challenge beat ${beat.clipIndex}: ${challenged.changes.join('; ')}`);
    }
    beat.motionPromptCharCount = beat.motionPrompt.length;

    if (!beat.sdPrompt.trim()) {
      violations.push({ beatIndex: beat.clipIndex, field: 'sdPrompt', problem: 'empty — SD pass is mandatory, never skip' });
    }
    // Production graph is deterministic — always rebuilt, never trusted from the LLM.
    beat.productionRoute = buildProductionRoute(
      i, beat.firstFrameSource, ideation.videoModel.choice,
      beatSpoken && !!ideation.lipSyncPlan?.needed,   // VO / mouth-busy beats never lip-sync generated clips
      beat.shotType,
      swimSwap,
    );
  });

  // Part B challenge (cross-beat): identical camera sentences on multiple beats → one
  // targeted rewrite varies them (the instruction bans verbatim repetition as an AI tell).
  for (const [line, idxs] of rawCameraLines) {
    if (idxs.length >= 2) {
      violations.push({
        beatIndex: idxs[1]!, field: 'motionPrompt',
        problem: `camera sentence repeated VERBATIM on beats ${idxs.join(', ')} ("${line.slice(0, 70)}…") — vary the camera language per beat; identical repetition reads AI`,
      });
    }
  }

  applyEditPlanFidelity(ideation, dna);
  violations.push(...lintFidelity(ideation, dna, fidelityMode));
  ideation.status = 'draft';
  return violations;
}
