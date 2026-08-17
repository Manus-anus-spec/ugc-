import { useState } from 'react';
import type { BeatGeneration } from '@shared/contract';
import { CopyButton } from '../ui';

const CAP_MULTI = 550;            // includes the aesthetic anchor + camera physics + constraint tail
const CAP_MULTI_DIALOGUE = 750;   // dialogue beats get room — the quote is never truncated
const CAP_ONE_SHOT = 1200;

type Tool = 'nb' | 'sd' | 'motion';

/** One paste-ready block with EVERYTHING about the beat — timing, prompts, dialogue, overlay. */
function fullBeatBlock(beat: BeatGeneration, beatNumber: number): string {
  const lines = [
    `BEAT ${beatNumber + 1} · ${beat.timestamp} · clip ${beat.clipIndex}`,
    `action: ${beat.action}`,
    `camera: ${beat.camera}`,
    `expression: ${beat.expression}`,
    ...(beat.dialogue ? [`dialogue: "${beat.dialogue}"`] : []),
    '',
    `— NANOBANANA —`,
    beat.nbPrompt,
    '',
    `— SEEDREAM (${beat.sdFrameType}) —`,
    beat.sdPrompt,
    '',
    `— MOTION —`,
    beat.motionPrompt,
  ];
  return lines.join('\n');
}

export function BeatPromptCard({ beat, beatNumber, videoFormat }: {
  beat: BeatGeneration; beatNumber: number; videoFormat: 'ONE_SHOT' | 'MULTI_CLIP';
}) {
  const [tool, setTool] = useState<Tool>('nb');
  const hasDialogue = !!beat.dialogue?.trim();
  const cap = videoFormat === 'ONE_SHOT' ? CAP_ONE_SHOT : hasDialogue ? CAP_MULTI_DIALOGUE : CAP_MULTI;
  const motionLen = beat.motionPrompt.length;
  const dialogueInMotion = !hasDialogue
    || beat.motionPrompt.toLowerCase().replace(/[“”"'’‘…]/g, '').includes(beat.dialogue!.toLowerCase().replace(/[“”"'’‘…]/g, '').trim());

  const current = tool === 'nb' ? beat.nbPrompt : tool === 'sd' ? beat.sdPrompt : beat.motionPrompt;

  return (
    <div className="bg-surface border border-hairline rounded-lg animate-rise">
      <header className="px-4 py-2.5 border-b border-hairline space-y-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-mono text-[11px] text-orange shrink-0">
              {videoFormat === 'ONE_SHOT' ? `full take · ${beat.timestamp}` : `clip ${beatNumber + 1} · ${beat.timestamp}`}
            </span>
            <span className="text-xs text-dim truncate">{beat.action}</span>
          </div>
          <CopyButton text={fullBeatBlock(beat, beatNumber)} label={videoFormat === 'ONE_SHOT' ? 'copy full take' : 'copy full clip'} />
        </div>
        {(beat.dialogue || beat.expression) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
            {beat.dialogue && <span className="text-[11px] italic text-cream/80">🗣 “{beat.dialogue}”</span>}
            {beat.expression && <span className="text-[11px] text-dim">{beat.expression}</span>}
          </div>
        )}
        {beat.productionRoute && beat.productionRoute.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            {beat.productionRoute.map((s) => (
              <span
                key={s.step}
                title={`${s.inputAsset}${s.onModerationFlag ? `\n\n⚑ on moderation flag: ${s.onModerationFlag}` : ''}`}
                className={`text-[10px] font-mono rounded px-1.5 py-0.5 border cursor-help
                  ${s.conditional ? 'border-dashed border-dim/60 text-dim' : 'border-hairline text-cream/80'}`}
              >
                {s.step}·{s.tool}{s.conditional ? ' (only if needed)' : ''}{s.onModerationFlag ? ' ⚑' : ''}
              </span>
            ))}
          </div>
        )}
        {beat.challengeLog && beat.challengeLog.length > 0 && (
          <p className="text-[10px] font-mono text-electric/80 pt-0.5">🛠 challenge pass fixed: {beat.challengeLog.join(' · ')}</p>
        )}
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
        <div className="px-4 pb-3 space-y-1.5">
          <div className="h-1 rounded bg-raised overflow-hidden">
            <div
              className={`h-full ${motionLen > cap ? 'bg-nsfw' : 'bg-orange'}`}
              style={{ width: `${Math.min(100, (motionLen / cap) * 100)}%` }}
            />
          </div>
          <p className={`font-mono text-[10px] ${dialogueInMotion ? 'text-sfw' : 'text-nsfw'}`}>
            {hasDialogue
              ? dialogueInMotion
                ? '✓ self-contained — dialogue embedded, paste this box and nothing else'
                : '⚠ dialogue NOT in the motion prompt — regenerate (self-contained rule violated)'
              : '✓ self-contained — paste this box and nothing else'}
          </p>
        </div>
      )}
    </div>
  );
}
