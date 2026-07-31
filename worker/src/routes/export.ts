/**
 * Exports (FABLE5-PLAN §6) — the transparency wedge vs Higgsfield's black box:
 *  GET /export/json                     full library dump (formats + tags [+ generations])
 *  GET /formats/:id/export?fmt=markdown one readable brief: DNA + latest generation
 *  GET /export/briefs[?profile=…]       complete briefs for operator-Claude sessions
 *                                       (replaces sav-content-library /prompts)
 */
import type { FormatDna, GenerationRun, Ideation } from '../../../shared/contract';
import type { Env } from './../env';
import { err, json } from '../http';
import { SUMMARY_SELECT, rowToSummary, type FormatRow } from '../db';

function beatLines(i: Ideation): string {
  return i.beats.map((b, n) => `
#### Beat ${n + 1} · ${b.timestamp}${b.dialogue ? ` · “${b.dialogue}”` : ''}
${b.action}
${b.shotSize ? `**Filming:** ${b.shotSize} · ${b.cameraAngle ?? ''} angle · ${b.durationSec ?? '?'}s · enters on ${b.cutType ?? 'cut'}${b.firstFrameSource ? ` · first frame: ${b.firstFrameSource.replace(/_/g, ' ')}` : ''}` : ''}
${b.motionBeat ? `**Motion beat:** ${b.motionBeat}` : ''}
${b.productionRoute?.length ? `**Route:** ${b.productionRoute.map((s) => s.tool).join(' → ')}` : ''}

**NanoBanana**
\`\`\`
${b.nbPrompt}
\`\`\`
**Seedream (${b.sdFrameType})**
\`\`\`
${b.sdPrompt}
\`\`\`
**Motion (${b.motionPromptCharCount} chars)**
\`\`\`
${b.motionPrompt}
\`\`\``).join('\n');
}

function editPlanLines(i: Ideation): string {
  const plan = i.editPlan;
  if (!plan) return '';
  const trims = plan.clips.filter((c) => c.trim).map((c) => {
    if (c.slices && c.slices.length > 1) {
      const cuts = c.slices.map((s) => `${s.useInSec}–${s.useOutSec}s${s.landsOnBeat ? ' (on beat)' : ''}`).join(', ');
      return `- clip ${c.clipIndex}: ONE ${c.slices[0]!.generatedDurationSec}s take → chop ${c.slices.length} cuts: ${cuts}`;
    }
    return `- clip ${c.clipIndex}: generate ${c.trim!.generatedDurationSec}s, use ${c.trim!.useInSec}–${c.trim!.useOutSec}s${c.trim!.cutOnBeatAtSec !== undefined ? `, cut lands ${c.trim!.landsOnBeat ? 'ON' : 'OFF'} the beat at ${c.trim!.cutOnBeatAtSec}s` : ''}`;
  });
  const pp = plan.postProcessing;
  return [
    trims.length ? `**Trim map (generate long, slice on the beat):**\n${trims.join('\n')}` : '',
    plan.loopPlan ? `**Loop:** ${plan.loopPlan}` : '',
    pp ? `**Post:** ${pp.fps}fps · grain: ${pp.addGrain} · shake: ${pp.addHandheldShake} · blur: ${pp.motionBlurAmount} · ${pp.reencodeProfile} · ${pp.aspect}${pp.rollingShutterOnPans ? ' · rolling shutter on pans' : ''}` : '',
  ].filter(Boolean).join('\n');
}

export function dnaToMarkdown(dna: FormatDna, runs: GenerationRun[]): string {
  const lines: string[] = [
    `# ${dna.title}`,
    ``,
    `**Archetype:** ${dna.archetype} · **Rating:** ${dna.contentFlag.rating} · **Duration:** ${dna.pacing.totalDurationSec}s · ${dna.pacing.isOneShot ? 'one-shot' : `${dna.pacing.cutCount} cuts`}`,
    `**Tags:** ${dna.tags.map((t) => `#${t}`).join(' ')}`,
    dna.source.url ? `**Source:** ${dna.source.url}` : '',
    ``,
    `## Why it works`,
    dna.whyItWorks.mechanism,
    `- Retention: ${dna.whyItWorks.retentionDrivers.join(' · ')}`,
    `- Target viewer: ${dna.whyItWorks.targetViewer}`,
    dna.whyItWorks.shareCommentTrigger ? `- Share trigger: ${dna.whyItWorks.shareCommentTrigger}` : '',
    ``,
    `## Swap map`,
    `**Must keep:**`,
    ...dna.swapMap.mustKeep.map((m) => `- ${m}`),
    `**Swappable:**`,
    ...dna.swapMap.swappable.map((m) => `- ${m}`),
    ``,
    `## Hook (${dna.hook.type})`,
    `- Opening visual: ${dna.hook.openingVisual}`,
    dna.hook.firstLineOrText ? `- First line/text: ${dna.hook.firstLineOrText}` : '',
    `- Mechanism: ${dna.hook.mechanism}`,
    ``,
    `## Camera`,
    `${dna.camera.setup} · ${dna.camera.facing}-facing · ${dna.camera.distance} · ${dna.camera.heightAngle} · ${dna.camera.motion}${dna.camera.placementNote ? ` · ${dna.camera.placementNote}` : ''}`,
    ``,
    `## Beats`,
    ...dna.beats.map((b) => `- **${b.startSec}–${b.endSec}s** ${b.action} _(R: ${b.rightHand} · L: ${b.leftHand} · ${b.expressionEnergy})_${b.dialogue ? ` — “${b.dialogue}”` : ''}${b.onScreenText ? ` [${b.onScreenText}]` : ''}`),
    ``,
    `## Setting & wardrobe`,
    `${dna.setting.locationType} · ${dna.setting.timeOfDay} · ${dna.setting.lighting} · mood: ${dna.setting.mood}`,
    `Wardrobe role: ${dna.wardrobeRole.role} — ${dna.wardrobeRole.garments.join(', ')}`,
    ``,
    `## Audio`,
    `${dna.audio.kind}${dna.audio.genre ? ` · ${dna.audio.genre}` : ''}${dna.audio.trendingSoundDependent ? ' · TREND-DEPENDENT' : ''}${dna.audio.syncNotes ? ` · ${dna.audio.syncNotes}` : ''}`,
  ];

  for (const run of runs) {
    lines.push('', `---`, ``, `# Generation · ${run.profileId} · ${run.variationStrength} · ${run.createdAt.slice(0, 16)}`);
    lines.push(`**Formula:** ${run.formulaExtracted}`);
    for (const i of run.ideations) {
      lines.push('', `## Ideation ${i.index + 1}: ${i.title} (${i.videoModel.choice}, ${i.videoFormat}, ${i.targetDurationSec}s)`);
      lines.push(i.angle, '', `**Why for this run:** ${i.whyItWorksForProfile}`);
      lines.push(beatLines(i));
      lines.push('', `**Caption:** ${i.copy.caption}`, `**Hashtags:** ${i.copy.hashtags.join(' ')}`);
      lines.push(`**Overlays:** ${i.copy.textOverlays.map((t) => `“${t}”`).join(' · ')}`);
      lines.push(`**Audio:** ${i.audioPlan.type} — ${i.audioPlan.description}`);
      if (i.continuityLock) {
        lines.push(`**Continuity lock:** ${i.continuityLock.setDescription} · ${i.continuityLock.wardrobeExact} · ${i.continuityLock.hairExact} · ${i.continuityLock.lightingExact} (${i.continuityLock.colorTempK}, ${i.continuityLock.timeOfDay})`);
      }
      if (i.wardrobeImagePath) {
        lines.push(`**Wardrobe ref image (attach to the Seedream/WaveSpeed call alongside the face ref — the text describes the garment, the image locks it):** \`${i.wardrobeImagePath}\``);
      }
      const epl = editPlanLines(i);
      if (epl) lines.push(epl);
      lines.push(`**Editing:** ${i.editingNotes}`);
    }
  }
  return lines.filter((l) => l !== null && l !== undefined).join('\n');
}

async function loadRuns(env: Env, formatId: string, profileFilter?: string, limit = 1): Promise<GenerationRun[]> {
  const sql = profileFilter
    ? 'SELECT output FROM generations WHERE format_id = ? AND profile_id = ? ORDER BY created_at DESC LIMIT ?'
    : 'SELECT output FROM generations WHERE format_id = ? ORDER BY created_at DESC LIMIT ?';
  const binds = profileFilter ? [formatId, profileFilter, limit] : [formatId, limit];
  const { results } = await env.DB.prepare(sql).bind(...binds).all<{ output: string }>();
  return results.map((r) => JSON.parse(r.output) as GenerationRun);
}

export async function exportFormat(req: Request, env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare(`${SUMMARY_SELECT} WHERE f.id = ?`).bind(id).first<FormatRow>();
  if (!row) return err('not_found', `format ${id} not found`, 404, req, env);
  if (row.schema_version === '0-legacy') {
    return err('legacy_format', 'legacy entry — only legacy_markdown exists; re-analyze for a clean brief', 422, req, env);
  }
  const fmt = new URL(req.url).searchParams.get('fmt') ?? 'markdown';
  const dna = JSON.parse(row.dna) as FormatDna;
  const runs = await loadRuns(env, id, undefined, 3);
  if (fmt === 'json') return json({ summary: rowToSummary(row), dna, generations: runs }, 200, req, env);
  return new Response(dnaToMarkdown(dna, runs), {
    status: 200,
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}

/** Full library dump — backup + own-your-data. ?include=generations for everything. */
export async function exportJson(req: Request, env: Env): Promise<Response> {
  const includeGenerations = new URL(req.url).searchParams.get('include') === 'generations';
  const { results } = await env.DB.prepare(`${SUMMARY_SELECT} ORDER BY f.updated_at DESC`).all<FormatRow>();
  const items = [];
  for (const row of results) {
    items.push({
      summary: rowToSummary(row),
      dna: JSON.parse(row.dna),
      legacyMarkdown: row.legacy_markdown ?? undefined,
      generations: includeGenerations ? await loadRuns(env, row.id, undefined, 10) : undefined,
    });
  }
  return json({ exportedAt: new Date().toISOString(), count: items.length, items }, 200, req, env);
}

/**
 * Complete briefs for operator-Claude sessions — the successor of
 * sav-content-library /prompts (Q3: sessions update to this shape).
 * ?profile=sav filters generations to that profile; default = latest run per format.
 */
export async function exportBriefs(req: Request, env: Env): Promise<Response> {
  const profile = new URL(req.url).searchParams.get('profile') ?? undefined;
  const { results } = await env.DB.prepare(
    `${SUMMARY_SELECT} WHERE f.schema_version != '0-legacy' ORDER BY f.updated_at DESC`
  ).all<FormatRow>();
  const briefs = [];
  for (const row of results) {
    const dna = JSON.parse(row.dna) as FormatDna;
    const runs = await loadRuns(env, row.id, profile, 1);
    briefs.push({
      formatId: row.id,
      title: dna.title,
      archetype: dna.archetype,
      rating: dna.contentFlag.rating,
      whyItWorks: dna.whyItWorks,
      swapMap: dna.swapMap,
      hook: dna.hook,
      latestGeneration: runs[0] ?? null,
    });
  }
  return json({ count: briefs.length, profile: profile ?? 'any', briefs }, 200, req, env);
}
