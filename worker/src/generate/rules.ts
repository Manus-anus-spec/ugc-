/**
 * Layer 1 — deterministic rule engines (FABLE5-PLAN §5). Pure functions, no LLM,
 * unit-tested offline (scripts/compiler-tests.ts). These preserve the non-negotiables
 * from SAV_IDEA_SYSTEM_PROMPT as CODE: Kling-vs-CDance selection, face-forward,
 * banned-word lint, char caps, identity-lock wrapping, input sanitization.
 */
import type {
  AudioBeatMapEntry, Beat, BeatGeneration, ContinuityLock, FidelityMode, FormatDna, Ideation,
  ModelProfile, PostProcessing, ProductionRouteStep, RealismTell, SdFrameType, SecondaryMotion,
  TrimSpec, VideoModelChoice, VideoModelTarget,
} from '../../../shared/contract';

/** Video-model decision. Since the Seedance-2.0 retarget (Jul 31) the production model
 *  is cdance_2 (= Seedance 2.0) for EVERYTHING — target 'seedance' is the default.
 *  target 'kling' keeps the legacy cost-split table (ports scanner:1858-1879) as the
 *  model-aware fallback seam: Kling for simple silent one-shots, CDance where needed. */
export function chooseVideoModel(i: {
  hasDialogue: boolean; clipCount: number; durationSec: number; emotionalRangeHigh: boolean;
  target?: VideoModelTarget;
}): { choice: VideoModelChoice; reason: string } {
  if ((i.target ?? 'seedance') === 'seedance') {
    return { choice: 'cdance_2', reason: 'Seedance 2.0 is the primary production model (run target: seedance).' };
  }
  if (i.hasDialogue) {
    return { choice: 'cdance_2', reason: 'Dialogue/lip-sync requires CDance — Kling cannot mouth words.' };
  }
  if (i.clipCount > 1) {
    return { choice: 'cdance_2', reason: 'Multi-clip with transitions requires CDance.' };
  }
  if (i.emotionalRangeHigh) {
    return { choice: 'cdance_2', reason: 'Dramatic expression changes need CDance fidelity.' };
  }
  return { choice: 'kling_3', reason: 'Single scene, no dialogue — Kling 3.0 is the cost-efficient fallback (run target: kling).' };
}

/** Face-forward rule (ports scanner:1886-1890): opening beat must face camera. */
export function needsFaceForwardFix(dna: FormatDna): boolean {
  const opening = dna.frames.find((f) => f.role === 'opening') ?? dna.frames[0];
  const text = `${opening?.scene.subjectPlacement ?? ''} ${opening?.scene.bodyPosition ?? ''} ${dna.beats[0]?.action ?? ''}`.toLowerCase();
  return /(facing away|back to camera|walks? away|from behind|rear view|turned away|180)/.test(text);
}

export interface LintViolation { beatIndex: number; field: string; problem: string }

const SOFT_WORDS = ['subtle', 'gentle', 'soft'];

/** Frozen language renders literal dead frames (guide §2). Negated usage ("NO freezing",
 *  "no frozen pose between actions") is an instruction, not a violation. Noun usage with
 *  a softening adjective ("small pauses while chewing") is realistic human timing — allowed. */
const FROZEN_LANGUAGE = /(?<!\bno )(?<!\bnot )(?<!\bnever )(?<!\bwithout )(?<!small )(?<!tiny )(?<!micro )(?<!natural )\b(pauses?\b|pausing\b|freez(?:es?|ing)\b|frozen\b|stands? (?:completely )?frozen|holds? (?:the|her|his|that|this) (?:expression|pose|smile|look|gaze)|briefly holds?\b|staring\b|stares? (?:blankly|at)\b|maintains? eye contact|holds? still\b|stands? (?:completely |perfectly )?still\b)/i;

/** The proven-bad named-expression labels (guide §1) — the model instant-swaps to a
 *  theatrical face instead of letting a reaction develop. Kept deliberately narrow so
 *  the lint never becomes an unwinnable rewrite loop (Jul 26 lesson). */
const PRESCRIBED_EXPRESSIONS = /(?<!\bno )(?<!\bnot )(?<!\bnever )\b(intense pleasure|eyes? roll(?:ing|s)? back|rolls? (?:her |his )?eyes back|exaggerated bliss|shocked|stunned)\b/i;
// Caps raised (Jul 26) — the enriched per-beat filming fields (shotSize/motionBeat/
// secondaryMotion/microExpression/camera) legitimately lengthen the LLM's own motionPrompt
// text; the old 550/700 caps were overflowing (790>550) and hard-failing generation.
export const MOTION_CHAR_CAP_MULTI = 900;            // anchor (~200) + physics + action + enriched beat fields
export const MOTION_CHAR_CAP_MULTI_DIALOGUE = 1100;  // + the verbatim quote + delivery — never truncate dialogue
// One-shot cap raised (Jul 31, human-prompting upgrade): the labeled continuous-take
// skeleton (CONTINUITY/beats/ENVIRONMENT/CAMERA/PERFORMANCE/AUDIO) needs room —
// Seedance 2.0 handles long structured choreography sheets well.
export const MOTION_CHAR_CAP_ONE_SHOT = 2400;
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
  // Frozen language renders literal dead frames (human-prompting guide §2) — allowed
  // only inside a negation ("NO freezing", "no frozen pose between actions").
  const fm = prompt.match(FROZEN_LANGUAGE);
  if (fm) {
    v.push({
      beatIndex, field: 'motionPrompt',
      problem: `frozen-language "${fm[0]}" creates dead frames — rewrite with continuous motion: "briefly looks toward…", "her expression shifts as…", "continues moving while…", "glances toward… then naturally returns her attention…"`,
    });
  }
  // Named-expression prescriptions read as instant expression swaps — describe what
  // she is REACTING TO instead (guide §1). Deliberately narrow: only the proven-bad labels.
  const em = prompt.match(PRESCRIBED_EXPRESSIONS);
  if (em) {
    v.push({
      beatIndex, field: 'motionPrompt',
      problem: `prescribed expression "${em[0]}" — describe what she is reacting to and let the expression develop instead of naming a face`,
    });
  }
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
  'Raw handheld iPhone footage, all camera settings automatic, no post-color grading, natural handheld jitter, flat natural lighting, deep focus, imperfect framing — NOT cinematic, no film look, no stabilization';

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
  const body = prompt
    .replaceAll(profile.identityLock.opener, '')
    .replaceAll(profile.identityLock.closer, '');
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
  return v;
}

/** Deterministic auto-neutralize for universal slop lighting/camera terms the LLM keeps
 *  reaching for. These are always wrong for our candid-iPhone aesthetic and have safe
 *  clean replacements, so we FIX them rather than hard-fail the whole run. Identity
 *  descriptors and instruction-type banned phrases are NOT auto-fixed — those still lint. */
const NB_SLOP_AUTOFIX: [RegExp, string][] = [
  [/\bstudio lighting\b/gi, 'soft natural lighting'],
  [/\bring light\b/gi, 'natural window light'],
  [/\bcinematic\b/gi, 'candid'],
  [/\bbokeh\b/gi, 'natural depth of field'],
  [/\bDSLR\b/gi, 'iPhone'],
  // Part F: plastic-perfection tells — Seedream/NB's default "perfect skin" is the
  // single loudest AI giveaway on a first frame. Auto-neutralize the safe ones:
  [/\bflawless\b/gi, 'natural'],
  [/\bporeless\b/gi, 'with visible pores'],
  [/\bsmooth,? (flawless )?skin\b/gi, 'natural skin texture'],
  [/\bporcelain skin\b/gi, 'natural skin with visible texture'],
  [/\b(retouched|airbrushed)\b/gi, 'unretouched'],
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
export function stripIdentityDescriptors(nbPrompt: string, profile: ModelProfile): string {
  let p = nbPrompt;
  for (const pattern of profile.identityLock.strippedDescriptors) {
    try {
      p = p.replace(new RegExp(`\\b(${pattern})([- ]?(style|inspired|themed))?\\b`, 'gi'), '');
    } catch { /* bad regex in profile data — leave for lint */ }
  }
  return p.replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').replace(/,\s*,/g, ',').trim();
}

/** Guarantee the identity lock structurally: opener first, closer last (never trust the LLM). */
export function wrapIdentityLock(nbPrompt: string, profile: ModelProfile): string {
  let p = nbPrompt.trim();
  if (!p.startsWith(profile.identityLock.opener)) p = `${profile.identityLock.opener} ${p}`;
  if (!p.includes(profile.identityLock.closer)) p = `${p} ${profile.identityLock.closer}`;
  return p;
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
  [/\b(nude|naked|topless)\b/gi, 'off-camera'],
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

/** F: bake the DNA's grade + up to 2 canned realism tells into the NB still —
 *  image-to-video models take their STYLE from the input image (first-frame law). */
export function ensureNbRealism(nbPrompt: string, dna: FormatDna): string {
  if (/sensor grain|blown (window )?highlights|imperfect headroom|auto-exposure|fluorescent/i.test(nbPrompt)) return nbPrompt;
  const tokens = (dna.aesthetic?.realismTells ?? [])
    .map((t) => REALISM_TELL_TOKENS[t]?.nb)
    .filter((t): t is string => !!t)
    .slice(0, 2);
  if (!tokens.length) tokens.push('faint phone-sensor grain', 'slightly imperfect headroom');
  const grade = dna.aesthetic?.grade?.trim();
  return `${endDot(nbPrompt)} Shot look: ${grade ? `${grade}, ` : ''}${tokens.join(', ')}.`;
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
  const framingKey = sourceBeat.framing?.toLowerCase().slice(0, 24);
  if (framingKey && !lower.includes(framingKey)) missing.push(sourceBeat.framing);
  const moveKey = sourceBeat.cameraMove?.toLowerCase().slice(0, 24);
  if (moveKey && !lower.includes(moveKey)) missing.push(sourceBeat.cameraMove);
  const dur = Math.round((sourceBeat.endSec - sourceBeat.startSec) * 10) / 10;
  if (!/(hold|beat of|clip of|for) ~?\d+(\.\d+)?s/i.test(motionPrompt)) missing.push(`hold ~${dur}s`);
  if (!missing.length) return motionPrompt;
  return `${endDot(motionPrompt)} CAMERA(source): ${missing.join(', ')}.`;
}

const SECONDARY_MOTION_TERMS = /(hair (sway|swing|settle|bounc|whip|flip|mov)|fabric|ripple|jiggle|bounc\w+ (chest|body|curves)|soft[- ]body|inertia|earring|necklace|jewel|apron|skirt (sway|mov)|drape)/i;

/** E.3: every motionPrompt carries secondary motion, but AT MOST TWO cues (guide §7):
 *  stacking secondary-motion descriptions makes video models animate the clothing over
 *  the person. Hair and fabric are the most natural carriers — the rest emerges. */
export function ensureSecondaryMotion(motionPrompt: string, sm: SecondaryMotion | undefined): string {
  if (/Secondary motion:/i.test(motionPrompt)) return motionPrompt;   // marker idempotency (re-enforcement runs)
  if (SECONDARY_MOTION_TERMS.test(motionPrompt)) return motionPrompt;
  const parts = (sm
    ? [sm.hair, sm.fabric, sm.softBody, sm.accessories].filter((s) => s && !/^(none|n\/a|not clearly visible)/i.test(s.trim()))
    : []
  ).slice(0, 2);
  const text = parts.length
    ? parts.join('; ')
    : 'hair moves naturally with her head turns and settles after each move';
  return `${endDot(motionPrompt)} Secondary motion: ${text}.`;
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
  const embedded = model === 'cdance_2'
    ? `She says naturally, lips synced {${line}}.`     // CDance: curly-brace quote, delivery outside
    : `She says, lips synced: "${line}".`;
  return `${motionPrompt.trim().replace(/[.!?]?$/, '.')} ${embedded}`;
}

export const MOTION_CADENCE_TAIL = 'Natural 30fps phone motion blur on fast movement, no frame interpolation, no slow-motion.';

/** E.5: fixed temporal-cadence tail on every motionPrompt. */
export function ensureMotionCadence(motionPrompt: string): string {
  if (/frame interpolation|no slow-motion|30fps/i.test(motionPrompt)) return motionPrompt;
  return `${endDot(motionPrompt)} ${MOTION_CADENCE_TAIL}`;
}

/** Guide §7: the global natural-idle-behavior block — appended to every a-roll
 *  motionPrompt (post-append, never competes with the LLM's char budget). It is the
 *  single highest-leverage anti-freeze/anti-pose addition the guide found. */
export const IDLE_BEHAVIOR_TAIL =
  'Natural idle human behavior throughout: occasional blinking, small eye saccades, tiny breathing movement in the shoulders, subtle weight shifts, slight posture adjustments, natural finger relaxation, micro facial movements — no exaggerated expressions, no robotic symmetry, no frozen pose between actions.';

export function ensureIdleBehavior(motionPrompt: string): string {
  if (/idle human behavior/i.test(motionPrompt)) return motionPrompt;
  return `${endDot(motionPrompt)} ${IDLE_BEHAVIOR_TAIL}`;
}

export const KLING_HANDHELD_TAIL = 'handheld phone footage, micro-shake, autofocus breathing, minor framing imperfections';
export const CDANCE_NEGATION_PAIR = 'no smoothness, no stabilization';
// "no music" is the load-bearing override — Seedance's UGC default leans toward a soft
// BGM bed and responds to the literal phrase "no music" more reliably than "no BGM".
export const CDANCE_AUDIO_LINE = 'voice sounds like a phone microphone, natural room tone, no music, no BGM';
export const CDANCE_SUBTITLE_TAIL = 'keep it subtitle-free, avoid generating any text or subtitles, no watermark';

/** Case-insensitively remove a phrase (with optional trailing punctuation) from s. */
function stripPhrase(s: string, phrase: string): string {
  const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[.,]?\\s*', 'gi');
  return s.replace(re, '').replace(/\s{2,}/g, ' ').trim();
}

/** E.6: per-model blocks in their load-bearing POSITION — kling_3 weights trailing
 *  camera language (handheld block LAST); cdance_2 needs the negation pair + phone-mic
 *  line, with the subtitle ban as the final tail. */
export function applyModelPositionBlocks(motionPrompt: string, model: VideoModelChoice): string {
  let p = endDot(motionPrompt);
  if (model === 'kling_3') {
    p = stripPhrase(p, KLING_HANDHELD_TAIL);
    return `${endDot(p)} ${cap1(KLING_HANDHELD_TAIL)}.`;
  }
  // cdance_2
  if (!/no smoothness/i.test(p)) p = `${endDot(p)} ${cap1(CDANCE_NEGATION_PAIR)}.`;
  if (!/phone microphone|room tone/i.test(p)) p = `${endDot(p)} ${cap1(CDANCE_AUDIO_LINE)}.`;
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
    steps.push({ step: n++, tool: 'nano_banana_2', inputAsset: 'profile face refs' + (firstFrameSource === 'hero_still' ? ' (hero still — locks set/wardrobe/light for ALL beats)' : ''), outputAsset: `beat${beatIndex}-nb-still`, promptField: 'nbPrompt' });
    steps.push({ step: n++, tool: 'seedream_4.5', inputAsset: `beat${beatIndex}-nb-still + body sheet`, outputAsset: `beat${beatIndex}-sd-frame`, promptField: 'sdPrompt' });
    steps.push({ step: n++, tool: 'face_restore', inputAsset: `beat${beatIndex}-sd-frame`, outputAsset: `beat${beatIndex}-first-frame (face-matched)`, promptField: 'none' });
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

const SHOT_SIZE_STEP: Record<string, number> = { ECU: 0, CU: 1, MS: 2, WS: 3 };
export const MAX_SEGMENT_SRC_SEC = 8;     // ≤8s of source per take (Kling ceiling ~10s generated)
export const MIN_SOLO_BEAT_SEC = 4;       // beats ≥4s stand alone comfortably

/** Deterministic grouper. A new segment starts when the next beat:
 *  - changes cameraAngle (an eye→overhead cut can't live inside one take),
 *  - jumps shot size by >1 step vs the segment's first beat (a 1-step jump is
 *    faked in the edit with a punch-in; ECU→WS cannot be),
 *  - enters on a 'match' cut (different composition by definition), or
 *  - would push the segment past MAX_SEGMENT_SRC_SEC.
 *  Hard/jump cuts between same-scene beats MERGE — the edit slice IS the cut. */
export function planSegments(beats: Beat[], maxSec = MAX_SEGMENT_SRC_SEC): GenerationSegment[] {
  const segments: GenerationSegment[] = [];
  let current: number[] = [];
  let anchor: Beat | null = null;

  const flush = () => {
    if (!current.length) return;
    segments.push({
      beatIndices: [...current],
      startSec: beats[current[0]!]!.startSec,
      endSec: beats[current[current.length - 1]!]!.endSec,
    });
    current = [];
    anchor = null;
  };

  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]!;
    if (anchor) {
      const spanIfAdded = b.endSec - beats[current[0]!]!.startSec;
      const angleBreak = !!b.cameraAngle && !!anchor.cameraAngle && b.cameraAngle !== anchor.cameraAngle;
      const sizeBreak = !!b.shotSize && !!anchor.shotSize
        && Math.abs(SHOT_SIZE_STEP[b.shotSize]! - SHOT_SIZE_STEP[anchor.shotSize]!) > 1;
      const matchBreak = b.cutTransition === 'match';
      // B-roll ↔ A-roll is ALWAYS a separate generation: different subject in frame
      // (a hands/food insert can't live inside a take of her face).
      const shotTypeBreak = (b.shotType ?? 'aroll') !== (anchor.shotType ?? 'aroll');
      if (angleBreak || sizeBreak || matchBreak || shotTypeBreak || spanIfAdded > maxSec) flush();
    }
    if (!current.length) anchor = b;
    current.push(i);
  }
  flush();
  return segments;
}

/** The segment's internal choreography, offsets relative to the take's start. */
export function buildSegmentTimeline(beats: Beat[], beatIndices: number[]): string {
  const t0 = beats[beatIndices[0]!]!.startSec;
  return beatIndices.map((i) => {
    const b = beats[i]!;
    const motion = b.motionBeat && !/^(none|n\/a)/i.test(b.motionBeat) ? b.motionBeat : b.action;
    return `${(b.startSec - t0).toFixed(1)}-${(b.endSec - t0).toFixed(1)}s: ${motion}${b.dialogue ? ` — says: "${b.dialogue}"` : ''}`;
  }).join('; ');
}

const TIME_RANGE_TOKEN = /\d+(\.\d+)?\s*[-–]\s*\d+(\.\d+)?s/g;

/** Multi-beat takes MUST carry per-beat timing in the motionPrompt — that's the whole
 *  point of merging. If the LLM's prompt lacks enough time-range tokens, append the
 *  source-derived timeline deterministically. */
export function ensureSegmentTimeline(motionPrompt: string, beats: Beat[], beatIndices: number[] | undefined): string {
  if (!beatIndices || beatIndices.length <= 1) return motionPrompt;
  const ranges = motionPrompt.match(TIME_RANGE_TOKEN)?.length ?? 0;
  if (ranges >= beatIndices.length - 1) return motionPrompt;
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

/** Voiceover formats: guarantee prompts are speech-free + carry the no-talking note
 *  (video models add mouth flapping when any speech language survives). */
export function ensureNoOnCameraSpeech(motionPrompt: string, dialogue?: string): string {
  let p = stripDialogueFromMotion(motionPrompt, dialogue);
  if (!/does not speak|no talking|closed[- ]mouth/i.test(p)) p = `${endDot(p)} ${VO_NO_SPEECH_NOTE}`;
  return p;
}

/** Wardrobe reference-image surfacing (Jul 30 meeting): when the profile maps wardrobe
 *  keys to garment photos (looks.wardrobeImages — e.g. Keira's _closet/<key>.jpg), resolve
 *  the ideation's chosen look to its image path so the operator/pipeline can attach it to
 *  the Seedream/WaveSpeed call alongside the face ref. Text describes the garment; the
 *  image locks it. The path lives in brief metadata ONLY — never inside a prompt box. */
export function resolveWardrobeImage(lock: ContinuityLock | undefined, profile: ModelProfile): string | undefined {
  const images = profile.looks.wardrobeImages;
  if (!images || !lock) return undefined;
  if (lock.wardrobeKey && images[lock.wardrobeKey]) return images[lock.wardrobeKey];
  const hay = `${lock.wardrobeKey ?? ''} ${lock.wardrobeExact}`.toLowerCase();
  for (const [key, path] of Object.entries(images)) {
    if (hay.includes(key.toLowerCase())) return path;
  }
  return undefined;
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
    if (seg.beatIndices.length > 1) {
      const ranges = b.motionPrompt.match(/\d+(\.\d+)?\s*[-–]\s*\d+(\.\d+)?s/g)?.length ?? 0;
      if (ranges < seg.beatIndices.length - 1) {
        v.push({ beatIndex: i, field: 'motionPrompt', problem: `multi-beat take (${seg.beatIndices.length} source beats) missing its internal timeline offsets` });
      }
    }
    if (s.shotSize) {
      const term = SHOT_SIZE_TEXT[s.shotSize]!;
      if (!b.motionPrompt.toLowerCase().includes(term) && !new RegExp(`\\b${s.shotSize}\\b`).test(b.motionPrompt)) {
        v.push({ beatIndex: i, field: 'motionPrompt', problem: `missing source shot-size token "${term}"` });
      }
    }
    if (!/(hold|beat of|clip of|for) ~?\d+(\.\d+)?s/i.test(b.motionPrompt)) {
      v.push({ beatIndex: i, field: 'motionPrompt', problem: 'missing source duration token (e.g. "hold ~1.4s")' });
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
  videoModelTarget: VideoModelTarget = 'seedance',
): LintViolation[] {
  const violations: LintViolation[] = [];
  const reproduce = fidelityMode === 'reproduce';
  const hasDialogue = ideation.beats.some((b) => !!b.dialogue?.trim());
  const ruled = chooseVideoModel({
    hasDialogue,
    clipCount: ideation.clipCount,
    durationSec: ideation.targetDurationSec,
    emotionalRangeHigh: /emotional|dramatic|reaction/i.test(ideation.angle) && ideation.videoModel.choice === 'cdance_2',
    target: videoModelTarget,
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

  // A missing continuity lock never kills a run — build a DNA-derived default.
  if (!ideation.continuityLock) ideation.continuityLock = buildDefaultContinuityLock(dna);

  // Wardrobe reference image (Jul 30 meeting): surface the chosen look's garment photo
  // path in the brief so the operator attaches it to WaveSpeed with the face ref.
  const wardrobeImage = resolveWardrobeImage(ideation.continuityLock, profile);
  if (wardrobeImage) ideation.wardrobeImagePath = wardrobeImage;

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

    // Dialogue delivery (v3.4): embed only on-camera speech; voiceover formats get
    // speech-free prompts (mouth flapping on a VO video is an instant AI tell).
    beat.motionPrompt = spoken
      ? ensureDialogueEmbedded(beat.motionPrompt, beat.dialogue, ideation.videoModel.choice)
      : ensureNoOnCameraSpeech(beat.motionPrompt, beat.dialogue);

    // Lint the LLM's OWN motion text first — the fixed realism blocks are post-append
    // and never compete with its char budget (spec E, cap law).
    violations.push(...lintMotionPrompt(beat.motionPrompt, profile, ideation.videoFormat, beat.clipIndex, beat.dialogue, fidelityMode, spoken));

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
      : wrapIdentityLock(beat.nbPrompt, profile);

    // SD chain: body wrap → mandatory skin texture. B-roll has no body — no SD pass.
    if (broll) {
      beat.sdPrompt = BROLL_SD_NOTE;
    } else {
      beat.sdPrompt = applyBodyWrap(beat.sdPrompt, profile, beat.sdFrameType);
      beat.sdPrompt = ensureSkinTexture(beat.sdPrompt);
    }

    // Motion chain (order is load-bearing): source camera → whole-video physics →
    // secondary motion → aesthetic anchor (prepends; its selfie/vlog words count as
    // face-framing evidence, so micro-expression runs AFTER it and sees the same text
    // the fidelity linter will see) → micro-expression → cadence tail → per-model
    // position blocks LAST (kling weights trailing camera language).
    beat.motionPrompt = reproduce
      ? ensureBeatCameraPhysics(beat.motionPrompt, sourceBeat)
      : beat.motionPrompt;
    // Multi-beat takes carry their internal choreography timeline — the merged
    // segment is useless without per-beat offsets (v3.3, Khian's 0.88s-clips fix).
    beat.motionPrompt = ensureSegmentTimeline(beat.motionPrompt, dna.beats, beat.sourceBeatIndices);
    beat.motionPrompt = ensureCameraPhysics(beat.motionPrompt, dna);
    beat.motionPrompt = ensureSecondaryMotion(beat.motionPrompt, beat.secondaryMotion ?? sourceBeat?.secondaryMotion);
    beat.motionPrompt = ensureAesthetic(beat.motionPrompt, dna);
    beat.motionPrompt = broll
      ? beat.motionPrompt   // no face in frame — no blink/gaze injection
      : ensureMicroExpression(beat.motionPrompt, sourceBeat?.framing ?? beat.camera, beat.microExpression);
    // Guide §7: the idle-behavior block rides every a-roll prompt (b-roll has no
    // human subject to idle) — AFTER micro-expression so the beat's own micro detail
    // still lands, BEFORE the cadence tail and per-model position blocks.
    beat.motionPrompt = broll ? beat.motionPrompt : ensureIdleBehavior(beat.motionPrompt);
    beat.motionPrompt = ensureMotionCadence(beat.motionPrompt);
    beat.motionPrompt = applyModelPositionBlocks(beat.motionPrompt, ideation.videoModel.choice);
    beat.motionPromptCharCount = beat.motionPrompt.length;

    if (!beat.sdPrompt.trim()) {
      violations.push({ beatIndex: beat.clipIndex, field: 'sdPrompt', problem: 'empty — SD pass is mandatory, never skip' });
    }
    // Production graph is deterministic — always rebuilt, never trusted from the LLM.
    beat.productionRoute = buildProductionRoute(
      i, beat.firstFrameSource, ideation.videoModel.choice,
      spoken && !!ideation.lipSyncPlan?.needed,   // VO formats never lip-sync generated clips
      beat.shotType,
    );
  });

  applyEditPlanFidelity(ideation, dna);
  violations.push(...lintFidelity(ideation, dna, fidelityMode));
  ideation.status = 'draft';
  return violations;
}
