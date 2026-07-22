import { useCallback, useRef, useState } from 'react';
import { Clapperboard, Link2, Upload } from 'lucide-react';
import { detectPlatform } from '@shared/platform';

export function SourcePicker({ onSubmit, disabled }: {
  onSubmit: (input: { url?: string; file?: File }) => void;
  disabled: boolean;
}) {
  const [url, setUrl] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const platform = url.trim() ? detectPlatform(url) : null;
  const urlInvalid = url.trim().length > 0 && !platform;

  const takeFile = useCallback((f: File | undefined | null) => {
    if (f && f.type.startsWith('video/')) onSubmit({ file: f });
  }, [onSubmit]);

  return (
    <div
      className={`bg-surface border rounded-xl p-8 transition-colors
        ${dragOver ? 'border-orange' : 'border-hairline'}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); takeFile(e.dataTransfer.files?.[0]); }}
    >
      <div className="flex items-center gap-2 mb-5 text-dim">
        <Clapperboard size={16} className="text-orange" />
        <h2 className="text-xs font-mono uppercase tracking-widest">Drop a viral video</h2>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (platform) onSubmit({ url: url.trim() }); }}
      >
        <div className="relative flex-1">
          <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={disabled}
            placeholder="Paste a TikTok / Instagram / YouTube / Pinterest link"
            className={`w-full bg-canvas border rounded-md pl-9 pr-20 py-2.5 text-sm font-mono
              focus:outline-none transition-colors
              ${urlInvalid ? 'border-nsfw' : 'border-hairline focus:border-orange'}`}
          />
          {platform && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono uppercase text-sfw">
              {platform}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={disabled || !platform}
          className="bg-orange text-canvas font-semibold rounded-md px-5 text-sm
                     hover:bg-orange-soft transition-colors disabled:opacity-40 cursor-pointer"
        >
          Analyze
        </button>
      </form>
      {urlInvalid && <p className="text-nsfw text-xs font-mono mt-2">unsupported URL — TikTok, Instagram, YouTube, Pinterest only</p>}

      <button
        onClick={() => fileRef.current?.click()}
        disabled={disabled}
        className="mt-4 w-full border border-dashed border-pitch rounded-md py-6 text-sm text-dim
                   hover:text-cream hover:border-orange transition-colors cursor-pointer
                   flex items-center justify-center gap-2"
      >
        <Upload size={14} />
        or drop / choose a video file
      </button>
      <input
        ref={fileRef} type="file" accept="video/*" className="hidden"
        onChange={(e) => { takeFile(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}
