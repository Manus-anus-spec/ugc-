import { useEffect, useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import type { ContentRating } from '@shared/contract';

/** Score color ramp — brutal red → amber → green. Shared by every virality element. */
export function scoreColor(score: number): string {
  if (score >= 76) return 'var(--color-sfw)';
  if (score >= 61) return 'var(--color-borderline)';
  if (score >= 41) return 'var(--color-orange)';
  return 'var(--color-nsfw)';
}

export function scoreTier(score: number): string {
  if (score >= 90) return 'viral ready';
  if (score >= 76) return 'breakout candidate';
  if (score >= 61) return 'above average';
  if (score >= 41) return 'average';
  if (score >= 21) return 'feed filler';
  return 'dead on arrival';
}

/** Compact score pill for cards/lists. */
export function ViralityBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  const c = scoreColor(score);
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-mono text-[10px] font-semibold"
      style={{ color: c, borderColor: `color-mix(in srgb, ${c} 40%, transparent)` }}
      title={scoreTier(score)}
    >
      ⚡ {Math.round(score)}
    </span>
  );
}

/** Animated score ring — the big honest number. */
export function ScoreRing({ score, size = 84 }: { score: number; size?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 700);
      setShown(Math.round(score * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const c = scoreColor(score);
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-raised)" strokeWidth={7} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c} strokeWidth={7} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - shown / 100)}
        style={{ transition: 'stroke-dashoffset 60ms linear', filter: `drop-shadow(0 0 6px ${c})` }}
      />
      <text
        x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        className="rotate-90 font-mono font-semibold" fill={c} fontSize={size / 3.4}
        style={{ transformOrigin: 'center' }}
      >
        {shown}
      </text>
    </svg>
  );
}

/** Horizontal dimension bar for the scorecard breakdown. */
export function ScoreBar({ label, score }: { label: string; score: number }) {
  const c = scoreColor(score);
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wider text-dim w-16 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded bg-raised overflow-hidden">
        <div className="h-full rounded transition-all duration-700" style={{ width: `${score}%`, backgroundColor: c }} />
      </div>
      <span className="font-mono text-[11px] font-semibold w-7 text-right" style={{ color: c }}>{Math.round(score)}</span>
    </div>
  );
}

const FORMAT_TYPE_LABELS: Record<string, string> = {
  talking_head: 'talking head', skit: 'skit', pov: 'POV', grwm: 'GRWM',
  transformation: 'transformation', outfit_showcase: 'outfit', walk_and_talk: 'walk & talk',
  mirror_selfie: 'mirror selfie', text_monologue: 'text monologue', vlog_moment: 'vlog',
  reaction: 'reaction', tutorial: 'tutorial', lifestyle_montage: 'montage',
  thirst_trap: 'thirst trap', other: 'other',
};

export function FormatTypeChip({ formatType }: { formatType: string | null | undefined }) {
  if (!formatType) return null;
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-electric/15 text-electric border border-electric/25">
      {FORMAT_TYPE_LABELS[formatType] ?? formatType}
    </span>
  );
}

export function RatingBadge({ rating }: { rating: ContentRating | string | null }) {
  if (!rating) return null;
  const cls = rating === 'sfw' ? 'text-sfw border-sfw/40'
    : rating === 'borderline' ? 'text-borderline border-borderline/40'
    : 'text-nsfw border-nsfw/40';
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider ${cls}`}>
      {rating}
    </span>
  );
}

/** Stable muted warm hue per archetype so the library taxonomy is scannable. */
export function ArchetypeChip({ archetype }: { archetype: string }) {
  let h = 0;
  for (let i = 0; i < archetype.length; i++) h = (h * 31 + archetype.charCodeAt(i)) % 360;
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{ backgroundColor: `hsl(${h} 30% 16%)`, color: `hsl(${h} 45% 70%)` }}
    >
      {archetype}
    </span>
  );
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-hairline text-[11px] font-mono
                 text-dim hover:text-cream hover:border-pitch transition-colors cursor-pointer"
    >
      {copied ? <Check size={12} className="text-sfw" /> : <Copy size={12} />}
      {copied ? 'copied' : (label ?? 'copy')}
    </button>
  );
}

export function Section({ title, children, defaultOpen = true, aside }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean; aside?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bg-surface border border-hairline rounded-lg">
      <header
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
        onClick={() => setOpen(!open)}
      >
        <h3 className="text-xs font-mono uppercase tracking-widest text-dim">{title}</h3>
        <div className="flex items-center gap-2">
          {aside}
          <ChevronDown size={14} className={`text-dim transition-transform ${open ? '' : '-rotate-90'}`} />
        </div>
      </header>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

export function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm py-1">
      <span className="font-mono text-[11px] uppercase tracking-wider text-dim w-32 shrink-0 pt-0.5">{k}</span>
      <span className="text-cream/90">{v}</span>
    </div>
  );
}

export function DifficultyDots({ score }: { score: number }) {
  return (
    <span className="inline-flex gap-1 items-center">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${i <= score ? 'bg-orange' : 'bg-pitch'}`} />
      ))}
    </span>
  );
}
