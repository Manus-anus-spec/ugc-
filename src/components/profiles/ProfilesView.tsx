/**
 * Profile manager — add/edit any model in minutes. The form covers who she is
 * (persona/backstory/audience), how she's BUILT (the Seedream body pass), her
 * world and voice; the advanced JSON panel exposes the full contract (toolRules,
 * identityLock, sanitize map) for power edits. PUT upserts; server bumps version.
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Loader2, Plus, Save, Trash2, Users } from 'lucide-react';
import type { ModelProfile } from '@shared/contract';
import { ModelProfileSchema } from '@shared/schemas';
import { deleteProfile, getProfile, listProfiles, putProfile } from '../../api';
import { ApiRequestError } from '../../api/client';
import { CopyButton, Section } from '../ui';
import { newProfileTemplate } from './profileTemplate';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-dim">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-dim/80">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full bg-canvas border border-hairline rounded-md px-3 py-2 text-sm focus:outline-none focus:border-orange';
const areaCls = `${inputCls} min-h-20 leading-relaxed`;

function linesToArr(s: string): string[] { return s.split('\n').map((l) => l.trim()).filter(Boolean); }

function Editor({ initial, isNew, onBack, onSaved }: {
  initial: ModelProfile; isNew: boolean; onBack: () => void; onSaved: () => void;
}) {
  const [p, setP] = useState<ModelProfile>(initial);
  const [jsonDraft, setJsonDraft] = useState('');
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<ModelProfile>) => setP((prev) => ({ ...prev, ...patch }));
  const setWorld = (patch: Partial<ModelProfile['world']>) => set({ world: { ...p.world, ...patch } });
  const setVoice = (patch: Partial<ModelProfile['voice']>) => set({ voice: { ...p.voice, ...patch } });
  const body = p.body ?? newProfileTemplate('x', 'x').body!;
  const setBody = (patch: Partial<NonNullable<ModelProfile['body']>>) => set({ body: { ...body, ...patch } });

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const candidate = { ...p, id: p.id.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-') };
      const parsed = ModelProfileSchema.safeParse(candidate);
      if (!parsed.success) {
        setError(parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '));
        return;
      }
      await putProfile(parsed.data as ModelProfile);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiRequestError ? `${e.api.code}: ${e.api.error}` : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 animate-rise">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-dim hover:text-cream transition-colors cursor-pointer">
          <ArrowLeft size={14} /> profiles
        </button>
        <div className="flex items-center gap-2">
          <CopyButton text={JSON.stringify(p, null, 2)} label="copy json" />
          <button onClick={() => void save()} disabled={saving || !p.id.trim() || !p.name.trim()} className="btn-charge inline-flex items-center gap-1.5 px-4 py-1.5 text-sm">
            {saved ? <Check size={13} /> : <Save size={13} />}
            {saving ? 'saving…' : saved ? 'saved' : isNew ? 'Create profile' : 'Save changes'}
          </button>
        </div>
      </div>
      {error && <p className="text-nsfw text-xs font-mono bg-surface border border-nsfw/40 rounded-md px-3 py-2">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="id (slug)" hint={isNew ? 'lowercase, no spaces — permanent once created' : 'changing this creates a NEW profile'}>
          <input className={inputCls} value={p.id} onChange={(e) => set({ id: e.target.value })} placeholder="belle" />
        </Field>
        <Field label="name">
          <input className={inputCls} value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="Belle" />
        </Field>
      </div>

      <Section title="Who she is">
        <div className="space-y-3 mt-1">
          <Field label="persona" hint="one line: who she is in the content">
            <input className={inputCls} value={p.world.persona} onChange={(e) => setWorld({ persona: e.target.value })} placeholder="Texas ranch redhead who works the rodeo circuit" />
          </Field>
          <Field label="backstory / lore" hint="her story — grounds every ideation in who she is">
            <textarea className={areaCls} value={p.world.backstory ?? ''} onChange={(e) => setWorld({ backstory: e.target.value })} />
          </Field>
          <Field label="audience ICP">
            <input className={inputCls} value={p.world.audienceICP} onChange={(e) => setWorld({ audienceICP: e.target.value })} placeholder="men 35-50+, American, financially stable" />
          </Field>
        </div>
      </Section>

      <Section title="How she's built — feeds the Seedream body pass">
        <div className="space-y-3 mt-1">
          <Field label="build" hint="the body standard for every SD prompt">
            <input className={inputCls} value={body.build} onChange={(e) => setBody({ build: e.target.value })} placeholder="fit hourglass, natural bust, toned waist" />
          </Field>
          <Field label="proportions">
            <input className={inputCls} value={body.proportions} onChange={(e) => setBody({ proportions: e.target.value })} placeholder="balanced bust-to-hip, defined waist, long legs" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="skin">
              <input className={inputCls} value={body.skin} onChange={(e) => setBody({ skin: e.target.value })} />
            </Field>
            <Field label="height vibe (optional)">
              <input className={inputCls} value={body.heightVibe ?? ''} onChange={(e) => setBody({ heightVibe: e.target.value || undefined })} placeholder="reads ~5'6" />
            </Field>
          </div>
          <Field label="SD enhancement notes" hint="exact instruction the Seedream pass follows">
            <textarea className={areaCls} value={body.sdEnhancementNotes} onChange={(e) => setBody({ sdEnhancementNotes: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section title="Her world">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
          <Field label="location whitelist" hint="one per line — where her content lives">
            <textarea className={areaCls} value={p.world.locationWhitelist.join('\n')} onChange={(e) => setWorld({ locationWhitelist: linesToArr(e.target.value) })} />
          </Field>
          <Field label="location banlist" hint="one per line — never generate here">
            <textarea className={areaCls} value={p.world.locationBanlist.join('\n')} onChange={(e) => setWorld({ locationBanlist: linesToArr(e.target.value) })} />
          </Field>
        </div>
      </Section>

      <Section title="Her voice">
        <div className="space-y-3 mt-1">
          <Field label="caption style">
            <input className={inputCls} value={p.voice.captionStyle} onChange={(e) => setVoice({ captionStyle: e.target.value })} />
          </Field>
          <Field label="overlay style">
            <input className={inputCls} value={p.voice.overlayStyle} onChange={(e) => setVoice({ overlayStyle: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="example overlays" hint="one per line">
              <textarea className={areaCls} value={p.voice.exampleOverlays.join('\n')} onChange={(e) => setVoice({ exampleOverlays: linesToArr(e.target.value) })} />
            </Field>
            <Field label="banned words" hint="one per line">
              <textarea className={areaCls} value={p.voice.bannedWords.join('\n')} onChange={(e) => setVoice({ bannedWords: linesToArr(e.target.value) })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={p.contentPolicy.nsfwAllowed}
              onChange={(e) => set({ contentPolicy: { ...p.contentPolicy, nsfwAllowed: e.target.checked } })}
            />
            NSFW content allowed
          </label>
        </div>
      </Section>

      <Section title="Advanced — full JSON (toolRules, identityLock, sanitize map)" defaultOpen={false}>
        <p className="text-[11px] text-dim mb-2">Edit anything the form doesn't cover. Apply parses + validates before it touches the form state.</p>
        <textarea
          className={`${areaCls} min-h-64 font-mono text-xs`}
          value={jsonDraft || JSON.stringify(p, null, 2)}
          onChange={(e) => setJsonDraft(e.target.value)}
          spellCheck={false}
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => {
              try {
                const parsed = ModelProfileSchema.safeParse(JSON.parse(jsonDraft || JSON.stringify(p)));
                if (!parsed.success) { setJsonErr(parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ')); return; }
                setP(parsed.data as ModelProfile); setJsonDraft(''); setJsonErr(null);
              } catch { setJsonErr('invalid JSON'); }
            }}
            className="border border-hairline rounded-md px-3 py-1.5 text-xs text-dim hover:text-cream cursor-pointer"
          >
            Apply JSON to form
          </button>
          {jsonErr && <span className="text-nsfw text-[11px] font-mono">{jsonErr}</span>}
        </div>
      </Section>
    </div>
  );
}

export function ProfilesView() {
  const [items, setItems] = useState<{ id: string; name: string; version: number; updatedAt: string }[]>([]);
  const [editing, setEditing] = useState<{ profile: ModelProfile; isNew: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => listProfiles().then((r) => { setItems(r.items); setLoading(false); });
  useEffect(() => { void refresh(); }, []);

  if (editing) {
    return (
      <div className="max-w-3xl mx-auto">
        <Editor
          initial={editing.profile}
          isNew={editing.isNew}
          onBack={() => setEditing(null)}
          onSaved={() => void refresh()}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-dim">
          <Users size={15} className="text-orange" />
          <h2 className="text-xs font-mono uppercase tracking-widest">Model profiles — who the videos are FOR</h2>
        </div>
        <button
          onClick={() => setEditing({ profile: newProfileTemplate('', ''), isNew: true })}
          className="btn-charge inline-flex items-center gap-1.5 px-4 py-1.5 text-sm"
        >
          <Plus size={14} /> New profile
        </button>
      </div>
      {loading && <Loader2 size={20} className="text-orange animate-spin mx-auto my-10" />}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {items.map((pr) => (
          <div key={pr.id} className="bg-surface border border-hairline rounded-lg p-4 card-lift space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold">{pr.name}</h3>
                <p className="font-mono text-[11px] text-dim mt-1">{pr.id} · v{pr.version}</p>
              </div>
              <button
                onClick={() => {
                  if (confirm(`Delete profile "${pr.name}"? Generation history keeps its snapshots.`)) {
                    void deleteProfile(pr.id).then(() => refresh());
                  }
                }}
                className="text-dim hover:text-nsfw transition-colors cursor-pointer"
                title="delete"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <button
              onClick={() => void getProfile(pr.id).then((full) => setEditing({ profile: full, isNew: false }))}
              className="w-full border border-hairline rounded-md px-3 py-1.5 text-xs text-dim hover:text-cream hover:border-pitch transition-colors cursor-pointer"
            >
              Open & edit
            </button>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-dim">
        A profile is the swappable identity layer: her persona, story, world, voice, and body standard.
        Pick her on the Generate tab and every ideation — scenes, captions, Seedream body pass — is produced for HER.
      </p>
    </div>
  );
}
