/**
 * Layer 1 — deterministic rule engines (FABLE5-PLAN §5). Pure functions, no LLM,
 * unit-tested offline (scripts/compiler-tests.ts). These preserve the non-negotiables
 * from SAV_IDEA_SYSTEM_PROMPT as CODE: Kling-vs-CDance selection, face-forward,
 * banned-word lint, char caps, identity-lock wrapping, input sanitization.
 */
import type { FormatDna, Ideation, ModelProfile, VideoModelChoice } from '../../../shared/contract';

/** Kling-vs-CDance decision (ports scanner:1858-1879). Applied to each ideation's own shape. */
export function chooseVideoModel(i: {
  hasDialogue: boolean; clipCount: number; durationSec: number; emotionalRangeHigh: boolean;
}): { choice: VideoModelChoice; reason: string } {
  if (i.hasDialogue) {
    return { choice: 'cdance_2', reason: 'Dialogue/lip-sync requires CDance — Kling cannot mouth words.' };
  }
  if (i.clipCount > 1) {
    return { choice: 'cdance_2', reason: 'Multi-clip with transitions requires CDance.' };
  }
  if (i.emotionalRangeHigh) {
    return { choice: 'cdance_2', reason: 'Dramatic expression changes need CDance fidelity.' };
  }
  return { choice: 'kling_3', reason: 'Single scene, no dialogue — Kling 3.0 is the cost-efficient default.' };
}

/** Face-forward rule (ports scanner:1886-1890): opening beat must face camera. */
export function needsFaceForwardFix(dna: FormatDna): boolean {
  const opening = dna.frames.find((f) => f.role === 'opening') ?? dna.frames[0];
  const text = `${opening?.scene.subjectPlacement ?? ''} ${opening?.scene.bodyPosition ?? ''} ${dna.beats[0]?.action ?? ''}`.toLowerCase();
  return /(facing away|back to camera|walks? away|from behind|rear view|turned away|180)/.test(text);
}

export interface LintViolation { beatIndex: number; field: string; problem: string }

const SOFT_WORDS = ['subtle', 'gentle', 'soft'];
export const MOTION_CHAR_CAP_MULTI = 310;
export const MOTION_CHAR_CAP_ONE_SHOT = 1200;

/** Motion-prompt lint (ports scanner:1916-1922): banned words, slowly×1, soft-words×2, char caps. */
export function lintMotionPrompt(
  prompt: string, profile: ModelProfile, videoFormat: 'ONE_SHOT' | 'MULTI_CLIP', beatIndex: number,
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
  const cap = videoFormat === 'MULTI_CLIP' ? MOTION_CHAR_CAP_MULTI : MOTION_CHAR_CAP_ONE_SHOT;
  if (prompt.length > cap) v.push({ beatIndex, field: 'motionPrompt', problem: `${prompt.length} chars > ${cap} cap` });
  if (/\b\d{2}[- ]year[- ]old\b/.test(lower)) v.push({ beatIndex, field: 'motionPrompt', problem: 'age reference' });
  return v;
}

/** NB identity-leak lint: profile descriptors + banned phrases must never appear.
 *  The identityLock opener/closer are excluded from the scan — they legitimately
 *  reference features ("freckles", "skin tone") as MATCH-THE-REFERENCE instructions. */
export function lintNbPrompt(prompt: string, profile: ModelProfile, beatIndex: number): LintViolation[] {
  const v: LintViolation[] = [];
  const body = prompt
    .replaceAll(profile.identityLock.opener, '')
    .replaceAll(profile.identityLock.closer, '');
  const lower = body.toLowerCase();
  for (const pattern of profile.identityLock.strippedDescriptors) {
    if (new RegExp(pattern, 'i').test(body)) {
      v.push({ beatIndex, field: 'nbPrompt', problem: `identity descriptor leaked: /${pattern}/` });
    }
  }
  for (const phrase of profile.toolRules.nb.bannedPhrases) {
    // phrases like "age numbers"/"nationality" are instructions, not literals — only lint literal matches
    if (phrase.includes(' ') || phrase.length > 3 ? lower.includes(phrase.toLowerCase()) : false) {
      v.push({ beatIndex, field: 'nbPrompt', problem: `banned phrase "${phrase}"` });
    }
  }
  return v;
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

/** Post-process one LLM ideation: enforce every deterministic rule. Returns violations that survived auto-fix. */
export function enforceIdeation(ideation: Ideation, profile: ModelProfile): LintViolation[] {
  const violations: LintViolation[] = [];
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
  for (const beat of ideation.beats) {
    beat.nbPrompt = wrapIdentityLock(beat.nbPrompt, profile);
    beat.motionPromptCharCount = beat.motionPrompt.length;
    if (!beat.sdPrompt.trim()) {
      violations.push({ beatIndex: beat.clipIndex, field: 'sdPrompt', problem: 'empty — SD pass is mandatory, never skip' });
    }
    violations.push(...lintMotionPrompt(beat.motionPrompt, profile, ideation.videoFormat, beat.clipIndex));
    violations.push(...lintNbPrompt(beat.nbPrompt, profile, beat.clipIndex));
  }
  ideation.status = 'draft';
  return violations;
}
