import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, Clock, Film, Loader2, Search, Trash2 } from 'lucide-react';
import type { FormatDna, FormatSummary } from '@shared/contract';
import { getFormat, type FormatDetail } from '../../api';
import { useLibrary } from '../../hooks/useLibrary';
import { DnaReport } from '../analyze/DnaReport';
import { ArchetypeChip, CopyButton, RatingBadge } from '../ui';

const RATINGS = ['sfw', 'borderline', 'nsfw'] as const;

function FormatCard({ f, onOpen }: { f: FormatSummary; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="text-left bg-surface border border-hairline rounded-lg p-4 space-y-2
                 hover:border-pitch transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-tight">{f.title}</h3>
        <RatingBadge rating={f.contentRating} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ArchetypeChip archetype={f.archetype} />
        {f.schemaVersion === '0-legacy' && (
          <span className="text-[10px] font-mono uppercase text-borderline border border-borderline/40 rounded px-1.5 py-0.5">legacy</span>
        )}
      </div>
      <div className="flex items-center gap-3 text-[11px] font-mono text-dim">
        {f.durationSec != null && <span className="flex items-center gap-1"><Clock size={11} />{f.durationSec}s</span>}
        {f.platform && <span className="flex items-center gap-1"><Film size={11} />{f.platform}</span>}
        <span>v{f.version}</span>
      </div>
      {f.tags.length > 0 && (
        <p className="text-[11px] font-mono text-dim truncate">{f.tags.map((t) => `#${t}`).join(' ')}</p>
      )}
    </button>
  );
}

function DetailPane({ id, onBack, onDeleted }: { id: string; onBack: () => void; onDeleted: () => void }) {
  const [detail, setDetail] = useState<FormatDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    getFormat(id).then(setDetail).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [id]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-dim hover:text-cream transition-colors cursor-pointer"
        >
          <ArrowLeft size={14} /> library
        </button>
        <div className="flex gap-2">
          {detail && <CopyButton text={JSON.stringify(detail.dna, null, 2)} label="copy json" />}
          <button
            onClick={() => { if (confirm('Delete this format from the library?')) void onDeleted(); }}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-nsfw/40 text-[11px] font-mono
                       text-nsfw hover:bg-nsfw/10 transition-colors cursor-pointer"
          >
            <Trash2 size={12} /> delete
          </button>
        </div>
      </div>

      {err && <p className="text-nsfw text-sm font-mono">{err}</p>}
      {!detail && !err && <Loader2 size={20} className="text-orange animate-spin mx-auto my-12" />}

      {detail && detail.summary.schemaVersion === '0-legacy' && (
        <div className="space-y-3">
          <div className="bg-surface border border-borderline/40 rounded-lg p-4 text-sm">
            <span className="text-borderline font-mono text-[11px] uppercase tracking-wider">legacy entry</span>
            <p className="text-dim mt-1">
              Migrated from the old KV library — structured fields were unreliable and weren't carried over.
              Re-analyze the source video for clean DNA.
              {detail.summary.sourceUrl && <> Source: <span className="font-mono">{detail.summary.sourceUrl}</span></>}
            </p>
          </div>
          {detail.legacyMarkdown && (
            <div className="markdown-body bg-surface border border-hairline rounded-lg p-5">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.legacyMarkdown}</ReactMarkdown>
            </div>
          )}
        </div>
      )}

      {detail && detail.summary.schemaVersion !== '0-legacy' && (
        <DnaReport dna={detail.dna as FormatDna} />
      )}
    </div>
  );
}

export function LibraryView() {
  const { query, setQuery, items, total, loading, error, remove } = useLibrary();
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  if (openId) {
    return (
      <div className="max-w-4xl mx-auto">
        <DetailPane
          id={openId}
          onBack={() => setOpenId(null)}
          onDeleted={async () => { await remove(openId); setOpenId(null); }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative flex-1 min-w-48"
          onSubmit={(e) => { e.preventDefault(); setQuery({ ...query, q: search || undefined, offset: 0 }); }}
        >
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title / archetype…  (enter)"
            className="w-full bg-surface border border-hairline rounded-md pl-8 pr-3 py-1.5 text-sm
                       focus:outline-none focus:border-orange"
          />
        </form>
        {RATINGS.map((r) => (
          <button
            key={r}
            onClick={() => setQuery({ ...query, rating: query.rating === r ? undefined : r, offset: 0 })}
            className={`px-2.5 py-1 rounded-md border text-[11px] font-mono uppercase transition-colors cursor-pointer
              ${query.rating === r ? 'border-orange text-orange' : 'border-hairline text-dim hover:text-cream'}`}
          >
            {r}
          </button>
        ))}
        <span className="text-[11px] font-mono text-dim ml-auto">{total} formats</span>
      </div>

      {error && <p className="text-nsfw text-sm font-mono">{error}</p>}
      {loading && <Loader2 size={20} className="text-orange animate-spin mx-auto my-12" />}

      {!loading && items.length === 0 && (
        <p className="text-dim text-sm text-center py-16">Nothing here yet — drop a video in Analyze.</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((f) => <FormatCard key={f.id} f={f} onOpen={() => setOpenId(f.id)} />)}
      </div>
    </div>
  );
}
