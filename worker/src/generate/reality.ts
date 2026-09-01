/**
 * REALITY CHECK — does the scene this prompt describes physically make sense?
 *
 * THE GAP THIS FILLS. The app already lints VOCABULARY hard: banned words, char caps, freeze
 * words, cinematizer terms, portrait framing, plastic-skin tells. Every one of those asks "is
 * this phrased like AI?". None of them ask "could this actually happen?".
 *
 * So a prompt could pass every existing check and still describe something impossible — both
 * hands busy while she is holding the phone that is filming, eight actions inside a 1.4s beat,
 * a static locked-off camera that also pans, a line assigned to a person who is not in the
 * scene, legible text on a screen that no i2v model can render. Those generate: they just
 * generate something incoherent, and you pay for the clip either way.
 *
 * DESIGN CONSTRAINT, learned from this repo's own history. The Jul 26 outage was a lint that
 * fired on good prompts and produced an unwinnable rewrite loop; every rule here is therefore
 * a PRESENCE/ABSENCE or COUNTING test with no judgement in it, and severity is split:
 *
 *   'blocking' — provably contradictory. Routed into the existing one-rewrite loop.
 *   'warn'     — suspicious but legitimately possible. Surfaced on the card, never blocks.
 *
 * When in doubt a check is a warning. A false blocking finding costs a Gemini call and can
 * degrade a working prompt; a false warning costs a line of text on a card.
 */
import type { FormatDna, Ideation } from '../../../shared/contract';

export interface RealityFinding {
  beatIndex: number;
  severity: 'blocking' | 'warn';
  /** Short machine-ish label so findings can be grouped/counted in the UI. */
  kind: string;
  issue: string;
}

/** Camera setups that physically occupy one of her hands for the whole take. */
const HAND_OCCUPYING_SETUP = /(self_held_selfie|mirror_selfie)/i;

/** Both-hands-busy evidence. Deliberately narrow: a hand field must name an ACTION that
 *  needs the hand, not merely mention it ("at side", "relaxed" occupy nothing). */
const HAND_BUSY = /\b(holds?|holding|grips?|carries|carrying|stirs?|pours?|lifts?|tears?|opens?|scrolls?|types?|wipes?|chops?|whisks?|grabs?)\b/i;
const HAND_IDLE = /\b(at (her )?side|relaxed|resting|loose|down|nothing|free|hangs?)\b/i;

/** Camera-move verbs. Mirrors CAMERA_MOVE_TERMS in rules.ts intentionally — this file must
 *  stay readable standalone, and the duplication is 8 words that have not changed in months. */
const MOVE_VERB = /\b(pans?|panning|tilts?|tilting|push(?:es)? in|dollys?|dollies|cranes?|orbits?|glides?|tracks?|tracking|zooms?|zooming)\b/i;
const STATIC_DECLARED = /\b(static|locked[- ]?off|no pans|no tilts|no zooms)\b/i;

/** Things no image-to-video model renders legibly today. Flagging them is not pedantry: the
 *  clip comes back with garbled glyphs and the money is spent. */
const LEGIBLE_TEXT = /\b(reads? (?:the|a|her|his)|text (?:on|reads)|message (?:on|reads)|caption on the screen|QR code|price tag|receipt|screenshot of|shows the screen|phone screen (?:reads|shows)|typing out)\b/i;

/** Physically needs a second operator or a second camera. */
const NEEDS_SECOND_PERSON = /\b(films herself from behind|watches herself walk|two cameras|someone else films|hands the (?:phone|camera) to)\b/i;

/** Rough action-density ceiling. A human cannot complete distinct physical actions faster
 *  than roughly one every 0.6s, and a video model asked to fit more produces a smear. */
const ACTION_VERB = /\b(walks?|turns?|sits?|stands?|reaches?|picks?|puts?|opens?|closes?|laughs?|leans?|steps?|grabs?|drops?|throws?|points?|waves?|nods?|shakes?|bends?|kneels?|jumps?|spins?|drinks?|eats?|bites?|pours?|stirs?|wipes?|tastes?)\b/gi;
const MIN_SEC_PER_ACTION = 0.6;

// ── OBJECT & PROP PHYSICS ───────────────────────────────────────────────────────────────
// Character coherence was only half the problem. The bigger failure class is what she DOES
// to things: an effect with no visible cause, a tool that appears from nowhere, an object
// that changes hands with no transfer, a mass that moves as if it weighs nothing. Video
// models render all of that happily and it reads instantly as AI.
//
// The generator instruction already carries a PROP-PHYSICS LAW (§4: name the visible nozzle,
// have the water already running at clip start, never spawn a knife). Nothing enforced it —
// the same instruction-vs-enforcement gap as the humanization laws.

/** An emitted effect. Each needs a visible physical source in frame. */
const EMITTER = /\b(pour(?:s|ing)?|spray(?:s|ing)?|splash(?:es|ing)?|sprinkl(?:es|ing)|drip(?:s|ping)?|smok(?:e|ing)|steam(?:s|ing)?|burn(?:s|ing)?|foam(?:s|ing)?|squirt(?:s|ing)?|blow(?:s|ing)? out)\b/i;
/** Evidence the source IS established: the vessel, opening, or already-active state. */
const EMITTER_SOURCE = /\b(nozzle|spout|open(?:ed)? (?:bottle|can|carton|tap|jar)|bottle mouth|tap (?:is )?(?:on|running)|already (?:running|pouring|flowing|lit|on)|cut (?:face|side|end)|kettle|jug|hose|straw|lid off|cap off|tilt(?:s|ed|ing)? the)\b/i;

/** Tools that are notorious for materialising mid-shot. */
const SPAWNABLE_TOOL = /\b(knife|scissors|lighter|match(?:es)?|razor|peeler|corkscrew|spatula|whisk|fork|spoon|straw)\b/i;
/** Evidence a tool was actually brought into the scene rather than conjured. */
const TOOL_ESTABLISHED = /\b(picks? up|reaches? for|already (?:holding|in her hand|on the (?:counter|table|board))|grabs?|takes? the|lifts? the|from the drawer|on the board|beside her|in frame)\b/i;

/** Mass-bearing verbs whose weight should be visible in the body. */
const HEAVY_ACTION = /\b(lifts?|carries|carrying|hauls?|drags?|heaves?|picks? up the (?:crate|box|case|tray|bucket|pan))\b/i;
/** Evidence the weight is acknowledged. */
const WEIGHT_CUE = /\b(weight|heavy|strain|braces?|both hands|shifts? her (?:grip|weight)|leans? back|effort|steadies?)\b/i;

/** Object-permanence: a thing leaving her hands should be accounted for. */
const RELEASE = /\b(puts? (?:it|the|her) \w+ down|sets? (?:it|the) \w+ down|drops?|places? (?:it|the)|hands? (?:it|the) \w+ (?:to|over)|lets? go|slides? (?:it|the) \w+ (?:onto|across))\b/i;

/**
 * Run every coherence check over a finished ideation.
 *
 * Pure and cheap — no model call. Runs AFTER enforceIdeation so it sees the final text the
 * operator will actually copy, injectors and all.
 */
export function checkReality(ideation: Ideation, dna: FormatDna): RealityFinding[] {
  const out: RealityFinding[] = [];
  const setup = dna.camera?.setup ?? '';
  const handOccupied = HAND_OCCUPYING_SETUP.test(setup);
  const castIds = new Set<string>(['subject', ...(dna.cast ?? []).map((c) => c.id)]);

  ideation.beats?.forEach((b, i) => {
    const push = (severity: RealityFinding['severity'], kind: string, issue: string): void => {
      out.push({ beatIndex: i, severity, kind, issue });
    };
    const motion = b.motionPrompt ?? '';
    const nb = b.nbPrompt ?? '';
    const both = `${motion} ${nb}`;

    // 1. HANDS vs CAMERA. If the setup needs a hand on the phone all take, both hands cannot
    //    be doing something else. Blocking: it is a straight contradiction, and it is a common
    //    one because the generator writes hands and camera independently.
    if (handOccupied) {
      // Hand fields live on the ANALYSED beat, not the generated one. In reproduce mode the
      // generated beat pins to a source beat, so read the real observed hands from there —
      // more accurate than parsing prose. For adapt/synthesize there is no source beat, so
      // fall back to an explicit both-hands construction in the generated text.
      const srcIdx = b.sourceBeatIndex;
      const src = typeof srcIdx === 'number' && srcIdx >= 0 ? dna.beats?.[srcIdx] : undefined;
      const busy = (h: string) => HAND_BUSY.test(h) && !HAND_IDLE.test(h);
      if (src && busy(src.rightHand ?? '') && busy(src.leftHand ?? '')) {
        push('blocking', 'hands-vs-camera',
          `camera setup is ${setup} (one hand holds the phone) but BOTH hands are busy — right: "${src.rightHand}", left: "${src.leftHand}". One hand must be on the phone, or the setup must change.`);
      } else if (!src && /\bboth hands\b/i.test(both) && HAND_BUSY.test(both)) {
        // Warning rather than blocking: "both hands" in free prose is weaker evidence than
        // two observed hand fields, and over-blocking here would fire on legitimate mirror
        // shots where the phone is propped against something.
        push('warn', 'hands-vs-camera',
          `camera setup is ${setup} (one hand normally holds the phone) and the prompt says "both hands" — check the phone is propped or the framing accounts for it.`);
      }
    }

    // 2. STATIC vs MOVE in the same prompt. Not "missing a static default" (an injector
    //    handles that) — an actual contradiction where both are asserted.
    if (STATIC_DECLARED.test(motion)) {
      const m = MOVE_VERB.exec(motion);
      // "no pans" is a negation, not a move — only flag a move verb outside a negated span.
      if (m && !/\b(no|not|never|without)\s+\w{0,12}$/i.test(motion.slice(Math.max(0, m.index - 20), m.index))) {
        push('blocking', 'static-vs-move',
          `the prompt declares a static/locked-off camera AND asks it to ${m[0]} — a video model given both will usually do neither well.`);
      }
    }

    // 3. ACTION DENSITY. Countable, no judgement.
    const dur = b.durationSec ?? 0;
    const actions = (both.match(ACTION_VERB) ?? []).length;
    if (dur > 0 && actions > 0 && dur / actions < MIN_SEC_PER_ACTION) {
      push('warn', 'action-density',
        `${actions} distinct actions in ${dur.toFixed(1)}s (~${(dur / actions).toFixed(2)}s each) — below the ~${MIN_SEC_PER_ACTION}s a real movement takes. Expect a smeared, sped-up look.`);
    }

    // 4. LEGIBLE TEXT. i2v cannot render it; the beat needs compositing instead.
    const t = LEGIBLE_TEXT.exec(both);
    if (t) {
      push('warn', 'legible-text',
        `beat depends on readable on-screen content ("${t[0]}") — no i2v model renders legible text. Generate the plate and composite the screen afterwards.`);
    }

    // 5. NEEDS A SECOND PERSON that the scene does not have.
    const s = NEEDS_SECOND_PERSON.exec(both);
    if (s && (dna.cast ?? []).length === 0) {
      push('blocking', 'needs-second-person',
        `beat requires a second person ("${s[0]}") but the format has no cast — this cannot be produced by a single character.`);
    }

    // 6. SPEAKER must exist. Only possible to check since beat.speaker landed; before that a
    //    line simply had no owner and this class of error was invisible.
    if (b.speaker && !castIds.has(b.speaker)) {
      push('blocking', 'unknown-speaker',
        `dialogue is attributed to "${b.speaker}", who is not the subject and not in the format's cast.`);
    }

    // 7. EMITTED EFFECT WITH NO VISIBLE CAUSE. The single most common physics tell: water
    //    appearing without a nozzle, smoke without a source. Warning not blocking — the
    //    source may be established in a neighbouring beat's first frame, which this cannot
    //    see, and over-blocking a pour would fire on half the cooking library.
    const em = EMITTER.exec(both);
    if (em && !EMITTER_SOURCE.test(both)) {
      push('warn', 'effect-without-cause',
        `"${em[0]}" happens with no visible source named (nozzle, open bottle, cut face, tap already running) — video models render the effect without its cause, which reads instantly as AI.`);
    }

    // 8. A TOOL THAT MATERIALISES. Same reasoning, same severity.
    const tool = SPAWNABLE_TOOL.exec(both);
    if (tool && !TOOL_ESTABLISHED.test(both)) {
      push('warn', 'spawned-tool',
        `a ${tool[0]} is used but never picked up or established in frame — it will appear from nowhere mid-shot.`);
    }

    // 9. WEIGHT THAT IS NOT ACKNOWLEDGED. A mass lifted with no strain in the body is one of
    //    the clearest inertia tells, and it is exactly what a video model gets wrong.
    const heavy = HEAVY_ACTION.exec(both);
    if (heavy && !WEIGHT_CUE.test(both)) {
      push('warn', 'weightless-mass',
        `"${heavy[0]}" with no weight cue (strain, brace, grip shift, both hands) — the object will move as if it weighs nothing.`);
    }

    // 10. OBJECT PERMANENCE ACROSS BEATS. Something held in one beat and gone in the next,
    //     with no release named anywhere, is a continuity break the operator will only spot
    //     after paying for both clips.
    const prev = ideation.beats?.[i - 1];
    if (prev) {
      const prevSrc = typeof prev.sourceBeatIndex === 'number' && prev.sourceBeatIndex >= 0
        ? dna.beats?.[prev.sourceBeatIndex] : undefined;
      const heldBefore = [prevSrc?.rightHand, prevSrc?.leftHand]
        .filter((h): h is string => !!h && HAND_BUSY.test(h) && !HAND_IDLE.test(h));
      if (heldBefore.length) {
        const nowSrc = typeof b.sourceBeatIndex === 'number' && b.sourceBeatIndex >= 0
          ? dna.beats?.[b.sourceBeatIndex] : undefined;
        const stillHeld = [nowSrc?.rightHand, nowSrc?.leftHand]
          .some((h) => !!h && HAND_BUSY.test(h) && !HAND_IDLE.test(h));
        const released = RELEASE.test(`${prev.motionPrompt ?? ''} ${motion}`);
        if (!stillHeld && !released && nowSrc) {
          push('warn', 'object-vanished',
            `something was in her hands last beat ("${heldBefore[0]}") and both hands are free now, with no put-down or hand-off named — the object will vanish between clips.`);
        }
      }
    }

    // 11. DIALOGUE WITHOUT A MOUTH. A line assigned to an off-camera person must not be
    //    lip-synced, and a line with no speaker at all defaults to the model — which is how
    //    an off-camera friend's line ends up coming out of her mouth.
    const offCam = new Set((dna.cast ?? []).filter((c) => c.offCamera).map((c) => c.id));
    if (b.dialogue?.trim() && b.speaker && offCam.has(b.speaker) && !/\bVO\b|voiceover|off-camera/i.test(b.dialogue)) {
      push('blocking', 'offcamera-lipsync',
        `the line belongs to "${b.speaker}", who is off camera, but it is not marked as VO — it will be lip-synced onto the wrong person.`);
    }
  });

  return out;
}

/** One-line summary for logs and the run header. */
export function summariseReality(findings: RealityFinding[]): string {
  const blocking = findings.filter((f) => f.severity === 'blocking').length;
  const warn = findings.length - blocking;
  if (!findings.length) return 'reality check: clean';
  return `reality check: ${blocking} blocking, ${warn} warning${warn === 1 ? '' : 's'}`;
}
