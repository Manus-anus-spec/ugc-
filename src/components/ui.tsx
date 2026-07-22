import { useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import type { ContentRating } from '@shared/contract';

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
