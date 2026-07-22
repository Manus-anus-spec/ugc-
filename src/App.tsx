import { useState } from 'react';
import { Rail, type Tab } from './components/layout/Rail';
import { TokenGate } from './components/layout/TokenGate';
import { AnalyzeView } from './components/analyze/AnalyzeView';
import { LibraryView } from './components/library/LibraryView';
import { GenerateView } from './components/generate/GenerateView';
import { ProfilesView } from './components/profiles/ProfilesView';

export default function App() {
  const [tab, setTab] = useState<Tab>('analyze');
  const [genFormatId, setGenFormatId] = useState<string | null>(null);

  return (
    <TokenGate>
      {(signOut) => (
        <div className="flex min-h-screen">
          <Rail tab={tab} onTab={setTab} onSignOut={signOut} />
          <main className="flex-1 p-8 overflow-x-hidden">
            {tab === 'analyze' && <AnalyzeView />}
            {tab === 'library' && (
              <LibraryView onGenerate={(formatId) => { setGenFormatId(formatId); setTab('generate'); }} />
            )}
            {tab === 'generate' && <GenerateView presetFormatId={genFormatId} />}
            {tab === 'profiles' && <ProfilesView />}
          </main>
        </div>
      )}
    </TokenGate>
  );
}
