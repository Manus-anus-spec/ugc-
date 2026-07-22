import { useState } from 'react';
import type { BeatGeneration } from '@shared/contract';
import { CopyButton } from '../ui';

const CAP_MULTI = 310;
const CAP_ONE_SHOT = 1200;

type Tool = 'nb' | 'sd' | 'motion';

export function BeatPromptCard({ beat, beatNumber, videoFormat }: {
  beat: BeatGeneration; beatNumber: number; videoFormat: 'ONE_SHOT' | 'MULTI_CLIP';
}) {
  const [tool, setTool] = useState<Tool>('nb');
  const cap = videoFormat === 'MULTI_CLIP' ? CAP_MULTI : CAP_ONE_SHOT;
  const motionLen = beat.motionPrompt.length;

  const current = tool === 'nb' ? beat.nbPrompt : tool === 'sd' ? beat.sdPrompt : beat.motionPrompt;

  return (
    <div className="bg-surface border border-hairline rounded-lg">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-hairline">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-orange">beat {beatNumber + 1} · {beat.timestamp}</span>
          <span className="text-xs text-dim truncate max-w-72">{beat.action}</span>
        </div>
        <div className="flex items-center gap-2">
          {beat.dialogue && <span className="text-[11px] italic text-cream/70">“{beat.dialogue}”</span>}
        </div>
      </header>
      <div className="flex items-center gap-1 px-3 pt-2.5">
        {(['nb', 'sd', 'motion'] as Tool[]).map((t) => (
          <button
            key={t}
            onClick={() => setTool(t)}
            className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase transition-colors cursor-pointer
              ${tool === t ? 'bg-raised text-orange' : 'text-dim hover:text-cream'}`}
          >
            {t === 'nb' ? 'NanoBanana' : t === 'sd' ? `Seedream · ${beat.sdFrameType}` : `Motion · ${motionLen}/${cap}`}
          </button>
        ))}
        <div className="ml-auto">
          <CopyButton text={current} label={`copy ${tool}`} />
        </div>
      </div>
      <pre className="px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-cream/90">{current}</pre>
      {tool === 'motion' && (
        <div className="px-4 pb-3">
          <div className="h-1 rounded bg-raised overflow-hidden">
            <div
              className={`h-full ${motionLen > cap ? 'bg-nsfw' : 'bg-orange'}`}
              style={{ width: `${Math.min(100, (motionLen / cap) * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
