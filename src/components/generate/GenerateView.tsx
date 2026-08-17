/**
 * The money screen (design-direction.md): format × profile × strength →
 * 3 ideation cards side by side → pick the winner → beat-by-beat portable prompts.
 * Character-neutral by default; pick a profile to produce FOR that model — her
 * world, her body (Seedream pass), her voice.
 */
import { useEffect, useState } from 'react';
import { Loader2, RotateCcw, Sparkles, User, XCircle } from 'lucide-react';
import type { FormatSummary, GenerationRun, Ideation, VariationStrength } from '@shared/contract';
import { generateIdeations, synthesizeIdeations, getGeneration, listFormats, listGenerations, listProfiles } from '../../api';
import { ApiRequestError } from '../../api/client';
import { ArchetypeChip, CopyButton, KV, ScoreRing, Section, ViralityBadge, scoreTier } from '../ui';
import { BeatPromptCard } from './BeatPromptCard';

const STRENGTHS: { id: VariationStrength; label: string; hint: string }[] = [
  { id: 'close', label: 'close', hint: 'close-but-fresh (default)' },
  { id: 'medium', label: 'medium', hint: 'new scenario, same skeleton' },
  { id: 'bold', label: 'bold', hint: 'keep only the mechanism' },
];

function IdeationCard({ ideation, active, onPick }: { ideation: Ideation; active: boolean; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className={`text-left flex-1 min-w-56 bg-surface border rounded-lg p-4 space-y-2 card-lift cursor-pointer animate-rise
        ${active ? 'border-orange' : 'border-hairline hover:border-pitch'}`}
    >
      <div className="flex items-center justify-between">
        <span className={`font-mono text-[10px] uppercase ${active ? 'text-orange' : 'text-dim'}`}>ideation {ideation.index + 1}</span>
        <div className="flex items-center gap-2">
          <ViralityBadge score={ideation.virality?.score} />
          <span className="font-mono text-[10px] text-dim">{ideation.videoModel.choice} · {ideation.clipCount} clip{ideation.clipCount > 1 ? 's' : ''} · {ideation.targetDurationSec}s</span>
        </div>
      </div>
      <h3 className="text-sm font-semibold leading-tight">{ideation.title}</h3>
      <p className="text-xs text-dim leading-snug">{ideation.angle}</p>
      {ideation.themeFit && <p className="text-[10px] italic text-electric/80 leading-snug">🎯 {ideation.themeFit}</p>}
      {ideation.virality && <p className="text-[11px] italic text-cream/70 leading-snug">“{ideation.virality.verdict}”</p>}
      <div className="flex flex-wrap gap-1">
        {ideation.keptFromOriginal.slice(0, 3).map((k) => (
          <span key={k} className="text-[10px] font-mono text-orange/80 border border-orange/30 rounded px-1 py-0.5 truncate max-w-full">{k}</span>
        ))}
      </div>
    </button>
  );
}

function ForecastPanel({ ideation }: { ideation: Ideation }) {
  const v = ideation.virality;
  if (!v) return null;
  return (
    <section className="bg-surface border border-hairline rounded-lg p-4 flex gap-4 items-start animate-rise">
      <div className="flex flex-col items-center gap-1">
        <ScoreRing score={v.score} size={72} />
        <span className="font-mono text-[9px] uppercase tracking-wider text-dim">{scoreTier(v.score)}</span>
      </div>
      <div className="flex-1 space-y-1.5 min-w-0">
        <p className="text-sm font-medium leading-snug">{v.verdict}</p>
        <KV k="vs original" v={v.vsOriginal} />
        {v.risks.length > 0 && (
          <KV k="risks" v={<span className="text-nsfw/90">{v.risks.join(' · ')}</span>} />
        )}
        {v.boosters.length > 0 && (
          <KV k="nail these" v={<span className="text-sfw/90">{v.boosters.join(' · ')}</span>} />
        )}
      </div>
    </section>
  );
}

function IdeationDetail({ ideation }: { ideation: Ideation }) {
  return (
    <div className="space-y-4">
      <ForecastPanel ideation={ideation} />
      <section className="bg-surface border border-orange/30 rounded-lg p-4 space-y-2">
        <p className="text-sm">{ideation.creativeBrief}</p>
        {ideation.themeFit && <KV k="theme fit" v={<span className="text-electric/90">{ideation.themeFit}</span>} />}
        <KV k="why for profile" v={ideation.whyItWorksForProfile} />
        <KV k="video model" v={`${ideation.videoModel.choice} — ${ideation.videoModel.reason}`} />
        {ideation.faceForwardNote && <KV k="face-forward" v={ideation.faceForwardNote} />}
        <KV k="reinvented" v={ideation.reinvented.join(' · ')} />
      </section>

      <div className="space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-dim">
          {ideation.videoFormat === 'ONE_SHOT'
            ? '1 continuous take — one GPT-Image frame (Seedream only if the body needs it) → one motion prompt; source cuts recreated as edit slices'
            : `${ideation.beats.length} clips — each card = one full generation (GPT-Image → conditional Seedream → motion), assembled per the edit plan`}
        </p>
        {ideation.beats.map((b, idx) => (
          <BeatPromptCard key={idx} beat={b} beatNumber={idx} videoFormat={ideation.videoFormat} />
        ))}
      </div>

      {ideation.lipSyncPlan?.needed && (
        <Section title="Lip-sync production route" aside={<span className="font-mono text-[10px] text-pop">🗣 mouthed audio</span>}>
          <KV k="audio source" v={ideation.lipSyncPlan.audioSource} />
          <KV k="route" v={<span className="font-medium">{ideation.lipSyncPlan.route}</span>} />
          <div className="mt-2 space-y-1">
            {ideation.lipSyncPlan.steps.map((s, i) => (
              <p key={i} className="text-sm text-cream/90"><span className="font-mono text-[11px] text-orange mr-2">{i + 1}.</span>{s}</p>
            ))}
          </div>
          {ideation.lipSyncPlan.fallback && <KV k="plan B" v={ideation.lipSyncPlan.fallback} />}
        </Section>
      )}

      {ideation.editPlan && (
        <Section title="Edit plan — clips → final video">
          <div className="space-y-1 mt-1">
            {ideation.editPlan.clips.map((c, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="font-mono text-[11px] text-orange w-14 shrink-0">clip {c.clipIndex + 1}</span>
                <span className="font-mono text-[11px] text-dim w-10 shrink-0">{c.durationSec}s</span>
                <span className="flex-1">{c.purpose}</span>
                <span className="font-mono text-[11px] text-dim">{c.transitionOut}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1">
            {ideation.editPlan.assembly.map((s, i) => (
              <p key={i} className="text-sm text-cream/90">□ {s}</p>
            ))}
          </div>
          {ideation.editPlan.captionsNote && <KV k="captions" v={ideation.editPlan.captionsNote} />}
        </Section>
      )}

      <Section title="Copy & audio">
        <KV k="caption" v={<span className="font-mono text-sm">{ideation.copy.caption}</span>} />
        <KV k="hashtags" v={<span className="font-mono text-xs">{ideation.copy.hashtags.join(' ')}</span>} />
        <div className="mt-2 space-y-1">
          {ideation.copy.textOverlays.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="font-mono text-xs bg-raised border border-hairline rounded px-2 py-1 flex-1">{t}</span>
              <CopyButton text={t} />
            </div>
          ))}
        </div>
        <KV k="audio" v={`${ideation.audioPlan.type} — ${ideation.audioPlan.description}`} />
        {ideation.audioPlan.syncNotes && <KV k="sync" v={ideation.audioPlan.syncNotes} />}
        <KV k="editing" v={ideation.editingNotes} />
      </Section>

      <Section title="QA checklist" defaultOpen={false}>
        {(['nbChecks', 'sdChecks', 'videoChecks'] as const).map((key) => (
          <div key={key} className="mb-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-dim mb-1">{key.replace('Checks', '')}</p>
            {ideation.qaChecklist[key].map((c, i) => (
              <p key={i} className="text-xs text-cream/85">□ {c}</p>
            ))}
          </div>
        ))}
      </Section>
    </div>
  );
}

export function GenerateView({ presetFormatId }: { presetFormatId: string | null }) {
  const [formats, setFormats] = useState<FormatSummary[]>([]);
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
  const [formatId, setFormatId] = useState(presetFormatId ?? '');
  const [profileId, setProfileId] = useState('neutral');
  const [strength, setStrength] = useState<VariationStrength>('close');
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [run, setRun] = useState<GenerationRun | null>(null);
  const [picked, setPicked] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ id: string; profileId: string; variationStrength: string; createdAt: string }[]>([]);

  useEffect(() => {
    setHistory([]);
    if (formatId) void listGenerations(formatId).then((r) => setHistory(r.items)).catch(() => {});
  }, [formatId, run]);

  useEffect(() => {
    void listFormats({ limit: 200 }).then((r) => setFormats(r.items.filter((f) => f.schemaVersion !== '0-legacy')));
    void listProfiles().then((r) => setProfiles(r.items)).catch(() => {});
  }, []);

  useEffect(() => { if (presetFormatId) setFormatId(presetFormatId); }, [presetFormatId]);

  const runWith = async (fn: () => Promise<GenerationRun>) => {
    setRunning(true); setError(null); setRun(null); setElapsed(0);
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    try {
      const result = await fn();
      setRun(result);
      setPicked(0);
    } catch (e) {
      setError(e instanceof ApiRequestError ? `${e.api.code}: ${e.api.error}` : String(e));
    } finally {
      clearInterval(timer);
      setRunning(false);
    }
  };

  // Reproduce/adapt one chosen format.
  const start = () => runWith(() => generateIdeations(formatId, strength, profileId === 'neutral' ? undefined : profileId));
  // §10 "surprise me" — no format needed; fuse the library's top blueprints into something new.
  const surprise = () => runWith(() => synthesizeIdeations(profileId === 'neutral' ? undefined : profileId));

  const selectedFormat = formats.find((f) => f.id === formatId);
  const forWhom = profileId === 'neutral' ? 'character-neutral' : `for ${profiles.find((p) => p.id === profileId)?.name ?? profileId}`;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Controls */}
      <div className="bg-surface border border-hairline rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 text-dim">
          <Sparkles size={15} className="text-orange" />
          <h2 className="text-xs font-mono uppercase tracking-widest">Format → 3 ideations · {forWhom}</h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <select
            value={formatId}
            onChange={(e) => setFormatId(e.target.value)}
            className="flex-1 min-w-64 bg-canvas border border-hairline rounded-md px-3 py-2 text-sm focus:outline-none focus:border-orange"
          >
            <option value="">choose a format…</option>
            {formats.map((f) => (
              <option key={f.id} value={f.id}>
                {f.viralityScore != null ? `⚡${f.viralityScore} · ` : ''}{f.title} · {f.archetype}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5 bg-canvas border border-hairline rounded-md px-2">
            <User size={13} className="text-electric" />
            <select
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
              className="bg-transparent py-2 text-sm focus:outline-none cursor-pointer"
              title="Who is this video for? Neutral = any model, any reference image."
            >
              <option value="neutral">neutral — any model</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex rounded-md border border-hairline overflow-hidden">
            {STRENGTHS.map((s) => (
              <button
                key={s.id}
                title={s.hint}
                onClick={() => setStrength(s.id)}
                className={`px-3 py-2 text-[11px] font-mono uppercase transition-colors cursor-pointer
                  ${strength === s.id ? 'bg-raised text-orange' : 'text-dim hover:text-cream'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => void start()}
            disabled={running || !formatId}
            className="btn-charge px-5 py-2 text-sm"
          >
            {running ? 'ideating…' : 'Generate ideation'}
          </button>
          <button
            onClick={() => void surprise()}
            disabled={running}
            title="Fuse the top viral formats in your library into a brand-new idea — no format needed"
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-md border border-electric/60 text-electric
                       hover:bg-electric/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Sparkles size={14} />
            {running ? 'fusing…' : 'Surprise me'}
          </button>
        </div>
        <p className="text-[11px] text-dim">
          <span className="text-electric">Surprise me</span> invents a fresh format by fusing your top-scoring library
          blueprints{profileId !== 'neutral' ? ` for ${profiles.find((p) => p.id === profileId)?.name ?? profileId}` : ''} — no source needed.
        </p>
        {selectedFormat && (
          <div className="flex items-center gap-2">
            <ArchetypeChip archetype={selectedFormat.archetype} />
            <ViralityBadge score={selectedFormat.viralityScore} />
            <span className="text-[11px] font-mono text-dim">{selectedFormat.durationSec}s · v{selectedFormat.version}</span>
          </div>
        )}
        {history.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-hairline">
            <span className="text-[10px] font-mono uppercase tracking-wider text-dim">past runs</span>
            {history.map((h) => (
              <button
                key={h.id}
                onClick={() => void getGeneration(h.id).then((r) => { setRun(r); setPicked(0); })}
                className="text-[11px] font-mono border border-hairline rounded px-2 py-0.5 text-dim
                           hover:text-cream hover:border-pitch transition-colors cursor-pointer"
              >
                {h.profileId} · {h.variationStrength} · {new Date(h.createdAt).toLocaleTimeString()}
              </button>
            ))}
          </div>
        )}
      </div>

      {running && (
        <div className="bg-surface border border-hairline rounded-xl p-10 flex flex-col items-center gap-3 animate-pop-in">
          <Loader2 size={26} className="text-orange animate-spin" />
          <p className="text-sm">Ideating on <span className="font-mono">Gemini Pro</span> — preserving the mechanism, reinventing the surface</p>
          <p className="font-mono text-xs text-dim">{elapsed}s · typical run 90-150s</p>
        </div>
      )}

      {error && (
        <div className="bg-surface border border-nsfw/40 rounded-xl p-6 space-y-2">
          <div className="flex items-center gap-2 text-nsfw"><XCircle size={16} /><span className="font-mono text-xs">{error}</span></div>
          <button onClick={() => void start()} className="inline-flex items-center gap-2 border border-hairline rounded-md px-3 py-1.5 text-sm text-dim hover:text-cream cursor-pointer">
            <RotateCcw size={13} /> retry
          </button>
        </div>
      )}

      {run && (
        <>
          <p className="text-xs font-mono text-dim">
            formula: <span className="text-cream/85">{run.formulaExtracted}</span>
          </p>
          {run.sourceFormatIds && run.sourceFormatIds.length > 0 && (
            <p className="text-[11px] font-mono text-electric/80">
              ✨ fused from {run.sourceFormatIds.length} library formats: {run.sourceFormatIds.map((id) => id.slice(0, 8)).join(' · ')}
            </p>
          )}
          <div className="flex gap-3 flex-wrap md:flex-nowrap">
            {run.ideations.map((i) => (
              <IdeationCard key={i.index} ideation={i} active={picked === i.index} onPick={() => setPicked(i.index)} />
            ))}
          </div>
          {run.ideations[picked] && <IdeationDetail ideation={run.ideations[picked]} />}
          <p className="text-[10px] font-mono text-dim text-right">
            run {run.id.slice(0, 8)} · {run.generatorVersion} · saved to history
          </p>
        </>
      )}
    </div>
  );
}
