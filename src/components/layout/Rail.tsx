import { useEffect, useState } from 'react';
import { FlaskConical, Library, LogOut, Sparkles, Users } from 'lucide-react';
import { API_BASE } from '../../config';

export type Tab = 'analyze' | 'library' | 'generate' | 'profiles';

const TABS: { id: Tab; label: string; icon: typeof FlaskConical }[] = [
  { id: 'analyze', label: 'Analyze', icon: FlaskConical },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'generate', label: 'Generate', icon: Sparkles },
  { id: 'profiles', label: 'Profiles', icon: Users },
];

export function Rail({ tab, onTab, onSignOut }: { tab: Tab; onTab: (t: Tab) => void; onSignOut: () => void }) {
  const [healthy, setHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/health`).then((r) => setHealthy(r.ok)).catch(() => setHealthy(false));
  }, []);

  return (
    <nav className="w-48 shrink-0 border-r border-hairline flex flex-col p-3 gap-1 sticky top-0 h-screen">
      <div className="px-2 py-3 mb-2">
        <div className="text-sm font-semibold tracking-tight">UGC Reverse-Engineer</div>
        <div className="flex items-center gap-1.5 mt-1">
          <span className={`w-1.5 h-1.5 rounded-full ${healthy === null ? 'bg-pitch' : healthy ? 'bg-sfw' : 'bg-nsfw'}`} />
          <span className="text-[10px] font-mono text-dim">ugc-api</span>
        </div>
      </div>
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onTab(id)}
          className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer text-left
            ${tab === id ? 'bg-raised text-orange font-medium' : 'text-dim hover:text-cream hover:bg-surface'}`}
        >
          <Icon size={15} />
          {label}
        </button>
      ))}
      <div className="mt-auto">
        <button
          onClick={onSignOut}
          className="flex items-center gap-2.5 px-3 py-2 rounded-md text-xs text-dim hover:text-cream transition-colors cursor-pointer"
        >
          <LogOut size={13} /> sign out
        </button>
      </div>
    </nav>
  );
}
