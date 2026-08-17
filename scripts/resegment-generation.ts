/**
 * Maintenance tool: re-compile a PRE-v3.3 generation run (one card per source beat)
 * into v3.3 GENERATION SEGMENTS in place — same translated scenes/dialogue/prompts,
 * merged into continuous takes with internal timelines + chop lists. Keeps a run an
 * operator is mid-production on instead of forcing a re-roll.
 *
 * Usage:
 *   npx tsx scripts/resegment-generation.ts <run.json> <format.json> <out.sql>
 *   npx wrangler d1 execute ugc_library --remote --file <out.sql>   (from worker/)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  applyEditPlanFidelity, buildProductionRoute, ensureDialogueEmbedded, planSegments,
} from '../worker/src/generate/rules';
import { GenerationRunSchema } from '../shared/schemas';
import type { FormatDna, GenerationRun } from '../shared/contract';

const [runPath, dnaPath, outPath] = process.argv.slice(2);
if (!runPath || !dnaPath || !outPath) {
  console.error('usage: resegment-generation.ts <run.json> <format.json> <out.sql>');
  process.exit(1);
}

const run = JSON.parse(readFileSync(runPath, 'utf8')) as GenerationRun;
const dnaFile = JSON.parse(readFileSync(dnaPath, 'utf8')) as { dna?: FormatDna; format?: FormatDna };
const dna = (dnaFile.dna ?? dnaFile.format ?? dnaFile) as FormatDna;

const segments = planSegments(dna.beats);
console.log(`${dna.beats.length} source beats → ${segments.length} segments:`,
  segments.map((s) => s.beatIndices.join('+')).join(' | '));

let converted = 0;
for (const ideation of run.ideations) {
  if (ideation.beats.length !== dna.beats.length) {
    console.log(`  [${ideation.index}] ${ideation.title}: ${ideation.beats.length} cards ≠ ${dna.beats.length} source beats — skipping (already segmented?)`);
    continue;
  }
  const oldBeats = ideation.beats;
  const oldClips = ideation.editPlan?.clips ?? [];

  ideation.beats = segments.map((seg, k) => {
    const cards = seg.beatIndices.map((i) => oldBeats[i]!);
    const base = cards[0]!;
    const span = Math.round((seg.endSec - seg.startSec) * 100) / 100;
    const t0 = dna.beats[seg.beatIndices[0]!]!.startSec;

    // Internal timeline from the run's OWN translated content (keeps the tamales).
    const timeline = seg.beatIndices.map((i, n) => {
      const sb = dna.beats[i]!;
      const card = cards[n]!;
      const motion = card.motionBeat && !/^(none|n\/a)/i.test(card.motionBeat) ? card.motionBeat : card.action;
      return `${(sb.startSec - t0).toFixed(1)}-${(sb.endSec - t0).toFixed(1)}s: ${motion}`;
    }).join('; ');

    let motion = base.motionPrompt.trim().replace(/[.!?]?$/, '.');
    if (seg.beatIndices.length > 1) motion = `${motion} TIMELINE (one continuous take, cuts made in the edit): ${timeline}.`;
    for (const card of cards) {
      motion = ensureDialogueEmbedded(motion, card.dialogue, ideation.videoModel.choice);
    }

    const firstFrameSource = k === 0 ? 'hero_still' as const : 'prev_clip_last_frame' as const;
    return {
      ...base,
      clipIndex: k,
      timestamp: `${seg.startSec.toFixed(2)}-${seg.endSec.toFixed(2)}s (source-pinned, covers ${seg.beatIndices.length} source beat${seg.beatIndices.length > 1 ? 's' : ''})`,
      action: cards.map((c) => c.action).join('; '),
      dialogue: cards.map((c) => c.dialogue).filter(Boolean).join(' ') || undefined,
      durationSec: span,
      sourceBeatIndex: seg.beatIndices[0]!,
      sourceBeatIndices: seg.beatIndices,
      firstFrameSource,
      motionPrompt: motion,
      motionPromptCharCount: motion.length,
      productionRoute: buildProductionRoute(k, firstFrameSource, ideation.videoModel.choice, !!ideation.lipSyncPlan?.needed),
    };
  });
  ideation.clipCount = segments.length;
  ideation.targetDurationSec = Math.round((segments[segments.length - 1]!.endSec - segments[0]!.startSec) * 10) / 10;

  if (ideation.editPlan) {
    ideation.editPlan.clips = ideation.beats.map((b, k) => {
      const seg = segments[k]!;
      const firstOld = oldClips.find((c) => c.clipIndex === seg.beatIndices[0]);
      const lastOld = oldClips.find((c) => c.clipIndex === seg.beatIndices[seg.beatIndices.length - 1]);
      return {
        clipIndex: k,
        durationSec: b.durationSec!,
        purpose: firstOld?.purpose ?? b.action.slice(0, 80),
        transitionOut: lastOld?.transitionOut ?? 'hard cut on beat',
      };
    });
    ideation.editPlan.assembly.unshift(
      `SEGMENTED PLAN: ${segments.length} generated takes cover the ${dna.beats.length} source cuts — chop each take per its slice windows below; every cut is made in the EDIT, not generated.`,
    );
    applyEditPlanFidelity(ideation, dna);
  }
  converted++;
  console.log(`  [${ideation.index}] ${ideation.title}: 13 cards → ${segments.length} takes ✓`);
}

run.generatorVersion = `${run.generatorVersion}+resegmented-v3.3`;
GenerationRunSchema.parse(run);   // never write an invalid row

const json = JSON.stringify(run).replace(/'/g, "''");
writeFileSync(outPath, `UPDATE generations SET output = '${json}' WHERE id = '${run.id}';\n`);
console.log(`${converted} ideation(s) converted → SQL written to ${outPath}`);
