/**
 * Typed FormatDNA renderer — replaces the old markdown wall. Every field it shows
 * came through the schema; nothing here parses text.
 */
import type { Beat, FormatDna, FrameSpec, ViralityScorecard } from '@shared/contract';
import { ArchetypeChip, CopyButton, DifficultyDots, FormatTypeChip, KV, RatingBadge, ScoreBar, ScoreRing, Section, scoreTier } from '../ui';

/** The brutal scorecard — big honest number, dimension bars, and every weakness named. */
function ViralityCard({ v }: { v: ViralityScorecard }) {
  return (
    <section className="bg-surface border border-hairline rounded-lg p-5 animate-rise">
      <h3 className="text-xs font-mono uppercase tracking-widest text-dim mb-4">Virality — brutally honest</h3>
      <div className="flex flex-col sm:flex-row gap-5">
        <div className="flex sm:flex-col items-center gap-3 sm:gap-1 shrink-0">
          <ScoreRing score={v.overall} />
          <span className="font-mono text-[10px] uppercase tracking-wider text-dim text-center">{scoreTier(v.overall)}</span>
        </div>
        <div className="flex-1 min-w-0 space-y-3">
          <p className="text-base leading-snug font-medium">“{v.verdict}”</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
            <ScoreBar label="hook" score={v.dimensions.hook.score} />
            <ScoreBar label="retention" score={v.dimensions.retention.score} />
            <ScoreBar label="emotion" score={v.dimensions.emotion.score} />
            <ScoreBar label="share" score={v.dimensions.share.score} />
            <ScoreBar label="replay" score={v.dimensions.replay.score} />
            <ScoreBar label="algo" score={v.dimensions.algo.score} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div className="border-l-2 border-sfw/60 pl-3 space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-sfw">carries it</p>
          {v.strengths.map((s, i) => <p key={i} className="text-sm text-cream/85">{s}</p>)}
        </div>
        <div className="border-l-2 border-nsfw/60 pl-3 space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-nsfw">drags it down</p>
          {v.weaknesses.map((w, i) => <p key={i} className="text-sm text-cream/85">{w}</p>)}
        </div>
      </div>
      <div className="mt-4 space-y-1.5">
        <KV k="ceiling" v={v.ceiling} />
        {v.improvements.length > 0 && (
          <div className="flex gap-3 text-sm py-1">
            <span className="font-mono text-[11px] uppercase tracking-wider text-dim w-32 shrink-0 pt-0.5">to raise it</span>
            <div className="space-y-1">
              {v.improvements.map((imp, i) => <p key={i} className="text-cream/90">→ {imp}</p>)}
            </div>
          </div>
        )}
      </div>
      <details className="mt-3">
        <summary className="font-mono text-[10px] uppercase tracking-wider text-dim cursor-pointer">why each number</summary>
        <div className="mt-2 space-y-1">
          {(Object.entries(v.dimensions) as [string, { score: number; reason: string }][]).map(([k, d]) => (
            <KV key={k} k={k} v={d.reason} />
          ))}
        </div>
      </details>
    </section>
  );
}

function BeatCard({ beat }: { beat: Beat }) {
  return (
    <div className="min-w-64 max-w-64 shrink-0 bg-raised border border-hairline rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-orange">
          {beat.startSec.toFixed(1)}–{beat.endSec.toFixed(1)}s
        </span>
        <span className="font-mono text-[10px] text-dim">
          clip {beat.clipIndex}{beat.startsOnCut ? ' · cut' : ''}
        </span>
      </div>
      <p className="text-sm leading-snug">{beat.action}</p>
      <div className="text-[11px] font-mono text-dim space-y-0.5">
        <div>R: {beat.rightHand}</div>
        <div>L: {beat.leftHand}</div>
        <div>cam: {beat.cameraMove} · {beat.framing}</div>
        <div>energy: {beat.expressionEnergy}</div>
      </div>
      {beat.dialogue && <p className="text-xs italic text-cream/80">“{beat.dialogue}”</p>}
      {beat.onScreenText && <p className="text-xs font-mono text-borderline">[{beat.onScreenText}]</p>}
    </div>
  );
}

function FrameCard({ frame }: { frame: FrameSpec }) {
  const s = frame.scene;
  return (
    <div className="bg-raised border border-hairline rounded-lg p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase text-orange">{frame.role}</span>
        <span className="font-mono text-[11px] text-dim">{frame.timestampSec.toFixed(1)}s · clip {frame.clipIndex}</span>
      </div>
      {frame.justification && <p className="text-[11px] italic text-dim">{frame.justification}</p>}
      <div className="text-xs space-y-1 text-cream/85">
        <p><span className="text-dim font-mono text-[10px] uppercase">framing </span>{s.framing} — {s.cropBoundaries}</p>
        <p><span className="text-dim font-mono text-[10px] uppercase">body </span>{s.bodyPosition}</p>
        <p><span className="text-dim font-mono text-[10px] uppercase">hands </span>R: {s.hands.right} · L: {s.hands.left}</p>
        <p><span className="text-dim font-mono text-[10px] uppercase">wardrobe </span>{s.wardrobeVisible}</p>
        <p><span className="text-dim font-mono text-[10px] uppercase">env </span>{s.environmentLayout}</p>
        <p><span className="text-dim font-mono text-[10px] uppercase">light </span>{s.lighting} · {s.colorGrade}</p>
        <p><span className="text-dim font-mono text-[10px] uppercase">fabric </span>{s.fabric} · {s.motionState}</p>
        {s.nsfwElements.length > 0 && (
          <p className="text-nsfw/90"><span className="text-dim font-mono text-[10px] uppercase">nsfw obs </span>{s.nsfwElements.join('; ')}</p>
        )}
      </div>
    </div>
  );
}

export function DnaReport({ dna }: { dna: FormatDna }) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{dna.title}</h2>
        <FormatTypeChip formatType={dna.formatType} />
        <ArchetypeChip archetype={dna.archetype} />
        <RatingBadge rating={dna.contentFlag.rating} />
        <span className="font-mono text-[11px] text-dim">
          {dna.pacing.totalDurationSec}s · {dna.pacing.isOneShot ? 'one-shot' : `${dna.pacing.cutCount} cuts`} · {dna.source.platform}
        </span>
        <div className="ml-auto flex gap-2">
          <CopyButton text={JSON.stringify(dna, null, 2)} label="copy DNA json" />
        </div>
      </header>
      <div className="flex flex-wrap gap-1.5">
        {dna.tags.map((t) => (
          <span key={t} className="text-[11px] font-mono text-dim bg-surface border border-hairline rounded px-1.5 py-0.5">#{t}</span>
        ))}
      </div>

      {/* The brutal scorecard — first thing after the header */}
      {dna.virality && <ViralityCard v={dna.virality} />}

      {/* The teaching layer — first-class */}
      <section className="bg-surface border border-orange/30 rounded-lg p-5">
        <h3 className="text-xs font-mono uppercase tracking-widest text-orange mb-3">Why it works</h3>
        <p className="text-lg leading-snug mb-3">{dna.whyItWorks.mechanism}</p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {dna.whyItWorks.retentionDrivers.map((d) => (
            <span key={d} className="text-[11px] bg-raised border border-hairline rounded-full px-2 py-0.5">{d}</span>
          ))}
        </div>
        <KV k="target viewer" v={dna.whyItWorks.targetViewer} />
        {dna.whyItWorks.shareCommentTrigger && <KV k="share trigger" v={dna.whyItWorks.shareCommentTrigger} />}
      </section>

      {/* Swap map */}
      <Section title="Swap map — what makes it this format">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
          <div className="border-l-2 border-orange pl-3 space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-orange">must keep</p>
            {dna.swapMap.mustKeep.map((m) => <p key={m} className="text-sm">{m}</p>)}
          </div>
          <div className="border-l-2 border-pitch pl-3 space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-dim">swappable</p>
            {dna.swapMap.swappable.map((m) => <p key={m} className="text-sm text-cream/75">{m}</p>)}
          </div>
        </div>
      </Section>

      {/* Hook */}
      <Section title={`Hook · ${dna.hook.type}`}>
        <KV k="opening visual" v={dna.hook.openingVisual} />
        {dna.hook.firstLineOrText && <KV k="first line/text" v={<span className="font-mono text-sm">{dna.hook.firstLineOrText}</span>} />}
        <KV k="mechanism" v={dna.hook.mechanism} />
        {dna.hook.coherenceWithCaption && <KV k="caption link" v={dna.hook.coherenceWithCaption} />}
      </Section>

      {/* Beats timeline */}
      <Section title={`Beats · ${dna.beats.length}`}>
        <div className="flex gap-3 overflow-x-auto pb-2 mt-1">
          {dna.beats.map((b) => <BeatCard key={b.index} beat={b} />)}
        </div>
      </Section>

      {/* Footage aesthetic — the look that must survive into every remake */}
      {dna.aesthetic && (
        <Section title="Footage aesthetic — the look">
          <div className="flex items-center justify-between mb-1">
            <KV k="device / style" v={<span className="font-mono">{dna.aesthetic.device} · {dna.aesthetic.style.replaceAll('_', ' ')}</span>} />
            <CopyButton text={dna.aesthetic.promptAnchor} label="copy anchor" />
          </div>
          <KV k="grade" v={dna.aesthetic.grade} />
          <KV k="realism markers" v={dna.aesthetic.realismMarkers.join(' · ')} />
          <KV k="never" v={<span className="text-nsfw/90">{dna.aesthetic.antiCinematic}</span>} />
          <div className="mt-2 bg-raised border border-hairline rounded-lg p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-electric mb-1">prompt anchor — opens every motion prompt</p>
            <p className="text-sm font-medium">{dna.aesthetic.promptAnchor}</p>
          </div>
        </Section>
      )}

      {/* Camera */}
      <Section title="Camera setup">
        <KV k="setup" v={<span className="font-mono">{dna.camera.setup} · {dna.camera.facing}-facing</span>} />
        <KV k="distance / height" v={`${dna.camera.distance} · ${dna.camera.heightAngle}`} />
        <KV k="motion" v={dna.camera.motion} />
        <KV k="phone / hidden arm" v={`${dna.camera.phoneVisible} · ${dna.camera.hiddenArm}`} />
        {dna.camera.placementNote && <KV k="placement" v={dna.camera.placementNote} />}
        {dna.camera.transitions && <KV k="transitions" v={dna.camera.transitions} />}
        {dna.camera.dynamics && (
          <div className="mt-3 bg-raised border border-hairline rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-wider text-electric">camera physics — the real-footage feel</p>
              <CopyButton text={dna.camera.dynamics.motionSignature} label="copy signature" />
            </div>
            <p className="text-sm font-medium">{dna.camera.dynamics.motionSignature}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              <KV k="stability" v={<span className="font-mono">{dna.camera.dynamics.stability}</span>} />
              <KV k="shake" v={dna.camera.dynamics.shake} />
              <KV k="sway" v={dna.camera.dynamics.sway} />
              <KV k="bob" v={dna.camera.dynamics.bob} />
              <KV k="reframes" v={dna.camera.dynamics.reframes} />
              <KV k="focus/exposure" v={dna.camera.dynamics.focusExposure} />
            </div>
          </div>
        )}
      </Section>

      {/* Frames */}
      <Section title={`Frames · ${dna.frames.length} identity-free scene specs`}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-1">
          {dna.frames.map((f) => <FrameCard key={f.frameId} frame={f} />)}
        </div>
      </Section>

      {/* Setting / wardrobe / pacing / audio */}
      <Section title="Setting & wardrobe" defaultOpen={false}>
        <KV k="location" v={`${dna.setting.locationType} · ${dna.setting.timeOfDay}`} />
        <KV k="lighting" v={dna.setting.lighting} />
        <KV k="props" v={dna.setting.keyProps.join(', ') || '—'} />
        <KV k="palette / mood" v={`${dna.setting.colorPalette} · ${dna.setting.mood}`} />
        <KV k="wardrobe role" v={dna.wardrobeRole.role} />
        <KV k="garments" v={dna.wardrobeRole.garments.join(', ')} />
        <KV k="styling" v={dna.wardrobeRole.stylingNotes} />
      </Section>

      <Section title="Pacing & audio" defaultOpen={false}>
        <KV k="rhythm" v={dna.pacing.rhythm} />
        <KV k="energy" v={dna.pacing.energy} />
        <KV k="audio" v={`${dna.audio.kind}${dna.audio.genre ? ` · ${dna.audio.genre}` : ''}${dna.audio.mood ? ` · ${dna.audio.mood}` : ''}`} />
        <KV k="trend-dependent" v={dna.audio.trendingSoundDependent ? 'YES — dies without the sound' : 'no'} />
        {dna.audio.syncNotes && <KV k="sync" v={dna.audio.syncNotes} />}
      </Section>

      {dna.textOverlays.present && (
        <Section title="Text overlays" defaultOpen={false}>
          <KV k="cadence / placement" v={`${dna.textOverlays.cadence} · ${dna.textOverlays.placement}`} />
          <KV k="copy style" v={dna.textOverlays.copyStyle} />
          {dna.textOverlays.items.map((t, i) => (
            <p key={i} className="text-sm font-mono mt-1">
              <span className="text-dim">{t.atSec.toFixed(1)}s</span> “{t.text}” <span className="text-dim">({t.position}, {t.style})</span>
            </p>
          ))}
        </Section>
      )}

      {dna.script && (
        <Section title={`Script · ${dna.script.structure}`} defaultOpen={false}>
          {dna.script.lines.map((l, i) => (
            <p key={i} className="text-sm font-mono">
              <span className="text-dim">{l.atSec.toFixed(1)}s</span> {l.text}
            </p>
          ))}
        </Section>
      )}

      {/* Difficulty */}
      <Section title="Recreation difficulty" defaultOpen={false}>
        <KV k="environment" v={<DifficultyDots score={dna.difficulty.environment} />} />
        <KV k="motion" v={<DifficultyDots score={dna.difficulty.motion} />} />
        <KV k="camera" v={<DifficultyDots score={dna.difficulty.camera} />} />
        <KV k="overall" v={<DifficultyDots score={dna.difficulty.overall} />} />
        {dna.difficulty.workarounds.length > 0 && <KV k="workarounds" v={dna.difficulty.workarounds.join(' · ')} />}
      </Section>

      {/* Quarantine */}
      <Section title="Character observation — analysis only, never enters prompts" defaultOpen={false}>
        <KV k="appearance" v={dna.characterObservation.appearance} />
        <KV k="outfit" v={dna.characterObservation.outfit} />
        <KV k="vibe" v={dna.characterObservation.vibe} />
        {dna.contentFlag.triggers.length > 0 && <KV k="flag triggers" v={dna.contentFlag.triggers.join('; ')} />}
      </Section>

      <p className="text-[10px] font-mono text-dim text-right">{dna.source.analyzerVersion} · v{dna.version}</p>
    </div>
  );
}
