import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useAuthToken } from '../../hooks/useAuthToken';

export function TokenGate({ children }: { children: (signOut: () => void) => React.ReactNode }) {
  const { token, submit, signOut, checking, error } = useAuthToken();
  const [value, setValue] = useState('');

  if (token) return <>{children(signOut)}</>;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form
        className="w-full max-w-sm bg-surface border border-hairline rounded-xl p-6 space-y-4"
        onSubmit={(e) => { e.preventDefault(); if (value.trim()) void submit(value); }}
      >
        <div className="flex items-center gap-2 text-dim">
          <KeyRound size={16} className="text-orange" />
          <h1 className="text-sm font-mono uppercase tracking-widest">ugc-api access</h1>
        </div>
        <p className="text-sm text-dim">Paste your operator key. It stays in this browser only.</p>
        <input
          autoFocus
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="X-API-Key"
          className="w-full bg-canvas border border-hairline rounded-md px-3 py-2 font-mono text-sm
                     focus:outline-none focus:border-orange"
        />
        {error && <p className="text-nsfw text-xs font-mono">{error}</p>}
        <button
          type="submit"
          disabled={checking || !value.trim()}
          className="w-full bg-orange text-canvas font-semibold rounded-md py-2 text-sm
                     hover:bg-orange-soft transition-colors disabled:opacity-40 cursor-pointer"
        >
          {checking ? 'checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
