import { Loader2, RotateCcw, XCircle } from 'lucide-react';
import { useAnalyze } from '../../hooks/useAnalyze';
import { SourcePicker } from './SourcePicker';
import { DnaReport } from './DnaReport';

export function AnalyzeView() {
  const { status, result, error, elapsed, run, reset } = useAnalyze();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {status === 'idle' && <SourcePicker onSubmit={run} disabled={false} />}

      {status === 'running' && (
        <div className="bg-surface border border-hairline rounded-xl p-10 flex flex-col items-center gap-4">
          <Loader2 size={28} className="text-orange animate-spin" />
          <p className="text-sm">Resolving → uploading → watching on <span className="font-mono">Gemini Pro</span> → validating → saving</p>
          <p className="font-mono text-xs text-dim">{elapsed}s elapsed · typical run 60–90s · saved server-side even if this tab dies</p>
        </div>
      )}

      {status === 'error' && error && (
        <div className="bg-surface border border-nsfw/40 rounded-xl p-8 space-y-3">
          <div className="flex items-center gap-2 text-nsfw">
            <XCircle size={18} />
            <span className="font-mono text-xs uppercase tracking-widest">{error.code}</span>
          </div>
          <p className="text-sm text-cream/90">{error.message}</p>
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 border border-hairline rounded-md px-3 py-1.5 text-sm
                       text-dim hover:text-cream transition-colors cursor-pointer"
          >
            <RotateCcw size={13} /> try again
          </button>
        </div>
      )}

      {status === 'done' && result && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs font-mono text-sfw">✓ analyzed and saved to library</p>
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 border border-hairline rounded-md px-3 py-1.5 text-sm
                         text-dim hover:text-cream transition-colors cursor-pointer"
            >
              <RotateCcw size={13} /> analyze another
            </button>
          </div>
          <DnaReport dna={result} />
        </>
      )}
    </div>
  );
}
