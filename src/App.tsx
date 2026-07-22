import { useState } from 'react';
import { Rail, type Tab } from './components/layout/Rail';
import { TokenGate } from './components/layout/TokenGate';
import { AnalyzeView } from './components/analyze/AnalyzeView';
import { LibraryView } from './components/library/LibraryView';
import { Placeholder } from './components/Placeholder';

export default function App() {
  const [tab, setTab] = useState<Tab>('analyze');

  return (
    <TokenGate>
      {(signOut) => (
        <div className="flex min-h-screen">
          <Rail tab={tab} onTab={setTab} onSignOut={signOut} />
          <main className="flex-1 p-8 overflow-x-hidden">
            {tab === 'analyze' && <AnalyzeView />}
            {tab === 'library' && <LibraryView />}
            {tab === 'generate' && (
              <Placeholder title="Generate" note="Phase 4 — FormatDNA × ModelProfile → 3 ideations with portable NB / Seedream / motion prompts." />
            )}
            {tab === 'profiles' && (
              <Placeholder title="Profiles" note="Phase 4 — Sav, Naomi and Niko-template model profiles, editable here." />
            )}
          </main>
        </div>
      )}
    </TokenGate>
  );
}
