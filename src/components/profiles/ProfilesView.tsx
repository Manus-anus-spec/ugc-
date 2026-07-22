import { useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import type { ModelProfile } from '@shared/contract';
import { getProfile, listProfiles } from '../../api';
import { CopyButton, KV } from '../ui';

export function ProfilesView() {
  const [items, setItems] = useState<{ id: string; name: string; version: number; updatedAt: string }[]>([]);
  const [selected, setSelected] = useState<ModelProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void listProfiles().then((r) => { setItems(r.items); setLoading(false); });
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-2 text-dim">
        <Users size={15} className="text-orange" />
        <h2 className="text-xs font-mono uppercase tracking-widest">Model profiles — swappable identity</h2>
      </div>
      {loading && <Loader2 size={20} className="text-orange animate-spin mx-auto my-10" />}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {items.map((p) => (
          <button
            key={p.id}
            onClick={() => void getProfile(p.id).then(setSelected)}
            className={`text-left bg-surface border rounded-lg p-4 transition-colors cursor-pointer
              ${selected?.id === p.id ? 'border-orange' : 'border-hairline hover:border-pitch'}`}
          >
            <h3 className="text-sm font-semibold">{p.name}</h3>
            <p className="font-mono text-[11px] text-dim mt-1">{p.id} · v{p.version}</p>
          </button>
        ))}
      </div>

      {selected && (
        <div className="bg-surface border border-hairline rounded-lg p-5 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{selected.name}</h3>
            <CopyButton text={JSON.stringify(selected, null, 2)} label="copy profile json" />
          </div>
          <KV k="persona" v={selected.world.persona} />
          <KV k="audience" v={selected.world.audienceICP} />
          <KV k="ref strategy" v={selected.refs.strategy} />
          <KV k="locations" v={selected.world.locationWhitelist.join(' · ') || '—'} />
          <KV k="banned" v={selected.world.locationBanlist.join(' · ') || '—'} />
          <KV k="caption style" v={selected.voice.captionStyle} />
          <KV k="nsfw allowed" v={selected.contentPolicy.nsfwAllowed ? 'yes' : 'no'} />
          <p className="text-[11px] font-mono text-dim pt-2">
            Editing: PUT /profiles/{selected.id} with the full JSON (version bumps automatically). UI editor lands in Phase 5.
          </p>
        </div>
      )}
    </div>
  );
}
