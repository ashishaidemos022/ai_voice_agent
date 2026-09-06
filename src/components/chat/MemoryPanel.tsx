import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Brain, Check, Clock, Loader2, Plus, RefreshCw, Search, X } from 'lucide-react';
import { MEMORY_LABELS, type MemoryEvent, type MemoryKind, type MemoryReceipt, type MemoryRecord, type MemorySubject } from '../../../shared/agent-memory';
import { memoryRequest, type MemoryCandidate } from '../../lib/agent-memory-service';
import { cn } from '../../lib/utils';

type Props = {
  agentId: string | null; subjectId: string | null; onSubjectChange: (id: string | null) => void;
  sessionId?: string; sessionActive: boolean; busy: boolean; receipt?: MemoryReceipt;
  onOpenSource?: (sessionId: string) => void;
};
const field = 'w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400';
const button = 'rounded-lg border border-white/15 px-3 py-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed';
const kindNames: Record<MemoryKind, string> = { semantic: 'Facts', episodic: 'Past events', procedural: 'Playbooks' };
const eventLabels: Record<string, string> = { turn_started: 'New question', search_requested: 'Agent requested memory', retrieved: 'Memory search completed', playbooks_selected: 'Playbook selected', context_supplied: 'Context sent to model', answer_completed: 'Answer completed', lookup_skipped: 'Personal-memory search skipped', saved: 'Memory saved', updated: 'Memory updated', forgotten: 'Memory forgotten', failed: 'Memory operation failed', consolidated: 'Conversation distilled' };

export function MemorySource({ record, onOpenSource }: { record: MemoryRecord; onOpenSource?: (id: string) => void }) {
  return <div className="space-y-2 text-xs text-white/60">
    <p>{record.source === 'owner' ? 'Written by the workspace owner' : record.source === 'consolidation' ? 'Extracted from a customer report · reviewed before saving' : 'Customer explicitly asked to remember this'} · version {record.version}</p>
    {record.source_quote && <blockquote className="border-l-2 border-cyan-400/40 pl-3 whitespace-pre-wrap text-white/80">{record.source_quote}</blockquote>}
    <p>{record.kind === 'episodic' ? 'Report dated' : 'Updated'} {new Date(record.happened_at || record.updated_at).toLocaleString()}</p>
    {record.source_session_id && onOpenSource && <button type="button" className={button} onClick={() => onOpenSource(record.source_session_id!)}>Open source conversation</button>}
  </div>;
}

export function MemoryPanel({ agentId, subjectId, onSubjectChange, sessionId, sessionActive, busy, receipt, onOpenSource }: Props) {
  const [subjects, setSubjects] = useState<MemorySubject[]>([]);
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [view, setView] = useState<'answer' | 'explore'>('answer');
  const [kind, setKind] = useState<MemoryKind>('semantic');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [addingProfile, setAddingProfile] = useState(false);
  const [editor, setEditor] = useState<Partial<MemoryRecord> | null>(null);
  const [candidates, setCandidates] = useState<MemoryCandidate[] | null>(null);
  const [versions, setVersions] = useState<Record<string, MemoryRecord[]>>({});
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const refresh = useCallback(async (quiet = false) => {
    if (!agentId) return;
    const token = generation.current;
    if (!quiet) setLoading(true);
    try {
      const result = await memoryRequest(agentId, subjectId, 'list');
      if (token !== generation.current) return;
      setSubjects(result.subjects || []); setRecords(result.records || []); setError('');
      if (sessionId && subjectId) {
        const trace = await memoryRequest(agentId, subjectId, 'events', { session_id: sessionId });
        if (token === generation.current) setEvents(trace.events || []);
      }
    } catch (err) { if (token === generation.current) setError(err instanceof Error ? err.message : 'Could not load memory'); }
    finally { if (token === generation.current && !quiet) setLoading(false); }
  }, [agentId, subjectId, sessionId]);
  useEffect(() => {
    generation.current += 1;
    setRecords([]); setEvents([]); setEditor(null); setCandidates(null); setVersions({}); setNotice('');
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]);
  useEffect(() => {
    if (!busy || !subjectId || !sessionId) return;
    let inFlight = false;
    const timer = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try { await refresh(true); } finally { inFlight = false; }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [busy, refresh, subjectId, sessionId]);
  useEffect(() => { if (receipt) void refresh(true); }, [receipt, refresh]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!agentId || saving) return;
    const token = generation.current;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await memoryRequest(agentId, subjectId, action, extra);
      if (token !== generation.current) return;
      if (result.subject) { onSubjectChange(result.subject.id); setAddingProfile(false); setProfileName(''); }
      if (result.versions) setVersions(old => ({ ...old, [String(extra.id)]: result.versions!.map(version => version.snapshot) }));
      if (result.candidates) setCandidates(result.candidates);
      if (action === 'save') setEditor(null);
      if (action === 'forget') setNotice('Removed from future memory retrieval. Original conversations are retained.');
      if (action === 'accept_candidate') setCandidates(old => old?.filter(item => item !== extra.candidate) || []);
      await refresh(true);
    } catch (err) { if (token === generation.current) setError(err instanceof Error ? err.message : 'Memory action failed'); }
    finally { setSaving(false); }
  }

  const lastEvent = events[events.length - 1];
  const turnId = receipt?.turnId || lastEvent?.turn_id;
  const turnEvents = events.filter(event => event.turn_id === turnId);
  const contextEvent = [...turnEvents].reverse().find(event => event.kind === 'context_supplied');
  const shownReceipt = receipt || contextEvent?.payload.receipt as MemoryReceipt | undefined;
  const retrieved = turnEvents.filter(event => event.kind === 'retrieved').flatMap(event => (event.payload.records || []) as MemoryRecord[]);
  const supplied = shownReceipt ? [...shownReceipt.records, ...shownReceipt.carriedRecords, ...shownReceipt.playbooks] : [];
  const visibleRecords = [...new Map([...supplied, ...retrieved].map(record => [record.id, record])).values()];
  const searched = turnEvents.some(event => event.kind === 'search_requested') || shownReceipt?.lookup === 'requested';
  const done = turnEvents.some(event => event.kind === 'answer_completed');
  const stages = [
    { label: 'Question', active: !!shownReceipt || turnEvents.length > 0, icon: BookOpen },
    { label: searched ? 'Search memory' : done ? 'Search skipped' : 'Memory decision', active: searched || done, icon: Search },
    { label: 'Answer context', active: !!shownReceipt, icon: Brain },
    { label: 'Answer', active: done, icon: Check }
  ];

  return <section aria-label="Agent memory" className="rounded-2xl border border-cyan-300/20 bg-slate-900/70 p-5 space-y-5">
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-xs uppercase tracking-[0.2em] text-cyan-200/70">Agent memory</p><h2 className="mt-1 text-lg font-semibold text-white">See what the agent remembers</h2><p className="mt-1 text-xs text-white/55">Saved notes → relevant context → a more informed answer.</p></div>
      <button type="button" aria-label="Refresh memory" onClick={() => void refresh()} disabled={loading} className={button}><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /></button>
    </div>
    <div className="space-y-2">
      <label className="text-xs text-white/65" htmlFor="memory-customer">Customer profile · stays the same across new chats</label>
      <div className="flex gap-2">
        <select id="memory-customer" className={field} value={subjectId || ''} disabled={sessionActive || saving} onChange={event => onSubjectChange(event.target.value || null)}>
          <option value="">Memory off</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
        </select>
        <button type="button" className={button} disabled={sessionActive || saving || !agentId} aria-label="Create customer profile" onClick={() => setAddingProfile(!addingProfile)}><Plus className="h-4 w-4" /></button>
      </div>
      {sessionActive && <p className="text-xs text-white/45">End this chat to switch customer profiles.</p>}
      {addingProfile && <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void act('create_subject', { name: profileName }); }}>
        <input className={field} aria-label="Customer profile name" placeholder="e.g. Alex · demo customer" maxLength={100} value={profileName} onChange={event => setProfileName(event.target.value)} />
        <button className={button} disabled={saving || !profileName.trim()}>Create</button>
      </form>}
    </div>
    {error && <p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
    {notice && <p role="status" className="text-xs text-cyan-200">{notice}</p>}
    <div className="flex gap-2" aria-label="Memory views">
      {(['answer', 'explore'] as const).map(item => <button key={item} type="button" className={cn(button, view === item && 'bg-cyan-400/15 border-cyan-300/50 text-cyan-100')} aria-pressed={view === item} onClick={() => setView(item)}>{item === 'answer' ? 'Follow this answer' : 'Explore memory'}</button>)}
    </div>
    {view === 'answer' ? <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2" aria-label="Observed answer flow">
        {stages.map((stage, index) => <div key={stage.label} className={cn('flex items-center gap-2 rounded-xl border p-3 text-xs', stage.active ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100' : 'border-white/10 text-white/40')}><stage.icon className="h-4 w-4 shrink-0" /><span>{index + 1}. {stage.label}</span></div>)}
      </div>
      {shownReceipt ? <div className="rounded-xl border border-white/10 p-3 space-y-2">
        <p className="text-xs font-medium text-white">Working memory · context for this answer</p>
        <p className="text-sm text-white/80">“{shownReceipt.currentQuestion}”</p>
        <p className="text-xs text-white/50">{shownReceipt.previousMessages} earlier messages in this conversation · {supplied.length} saved items supplied</p>
        {shownReceipt.carriedRecords.length > 0 && <p className="text-xs text-white/50">{shownReceipt.carriedRecords.length} saved items carried from earlier turns.</p>}
      </div> : <p className="text-sm text-white/55">{subjectId ? 'Start a chat and ask something about this customer. Actual memory events will appear here.' : 'Create or select a customer profile, then start a new chat.'}</p>}
      {visibleRecords.map(record => <details key={record.id} className="rounded-xl border border-white/10 p-3">
        <summary className="cursor-pointer text-sm text-white/90">{record.title}<span className="block mt-1 text-xs text-cyan-200">{kindNames[record.kind]} · {supplied.some(item => item.id === record.id) ? 'Supplied to model' : 'Retrieved'}</span></summary>
        <p className="my-3 text-sm text-white/80 whitespace-pre-wrap">{record.content}</p><MemorySource record={record} onOpenSource={onOpenSource} />
      </details>)}
      {done && !searched && <p className="text-xs text-white/60">No personal-memory search was requested. Current chat and agent instructions still apply.</p>}
      {turnEvents.length > 0 && <details><summary className="cursor-pointer text-xs text-white/60">Recorded activity · {turnEvents.length} events</summary><ol className="mt-3 space-y-2">{turnEvents.map(event => <li key={event.id} className="flex gap-2 text-xs text-white/65"><Clock className="h-3 w-3 shrink-0 mt-0.5" /><span>{eventLabels[event.kind] || event.kind}{typeof event.payload.query === 'string' && <span className="block text-white/45">{event.payload.query}</span>}{typeof event.payload.error === 'string' && <span className="block text-rose-200">{event.payload.error}</span>}</span></li>)}</ol></details>}
      <p className="text-[11px] text-white/40">Shows retrieved information and recorded operations, not the model’s private thoughts. Product knowledge is tracked separately.</p>
    </div> : <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{(Object.keys(kindNames) as MemoryKind[]).map(item => <button key={item} type="button" aria-pressed={kind === item} className={cn(button, kind === item && 'bg-white/10 border-white/40')} onClick={() => { setKind(item); setEditor(null); }}>{kindNames[item]} · {records.filter(record => record.kind === item).length}</button>)}</div>
      <div><h3 className="text-sm font-medium text-white">{MEMORY_LABELS[kind].title}</h3><p className="mt-1 text-xs text-white/50">{MEMORY_LABELS[kind].description}</p></div>
      {kind === 'procedural' && <p className="text-xs text-white/55">Playbooks belong to this agent and can apply to every customer. The agent’s persona stays in its configuration.</p>}
      {!records.some(record => record.kind === kind) && <p className="py-3 text-sm text-white/40">No {kindNames[kind].toLowerCase()} saved yet.</p>}
      {records.filter(record => record.kind === kind).map(record => <details key={record.id} className="rounded-xl border border-white/10 p-3">
        <summary className="cursor-pointer text-sm text-white/90">{record.title}<span className="ml-2 text-xs text-white/40">v{record.version}</span></summary>
        <p className="my-3 text-sm text-white/80 whitespace-pre-wrap">{record.content}</p><MemorySource record={record} onOpenSource={onOpenSource} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={button} disabled={saving || busy} onClick={() => setEditor(record)}>Edit</button>
          <button type="button" className={button} disabled={saving || busy} onClick={() => void act('forget', { id: record.id, expected_version: record.version })}>Forget</button>
          <button type="button" className={button} disabled={saving} onClick={() => void act('versions', { id: record.id })}>Version history</button>
        </div>
        {versions[record.id] && <ol className="mt-3 space-y-2 border-t border-white/10 pt-3">{versions[record.id].map(version => <li key={version.version} className="text-xs text-white/60">v{version.version} · {version.version === record.version ? 'Current' : 'Superseded'}<p className="mt-1 whitespace-pre-wrap">{version.content}</p></li>)}</ol>}
      </details>)}
      <button type="button" className={button} disabled={!subjectId || saving || busy} onClick={() => setEditor({ kind, title: '', content: '', memory_key: '', happened_at: new Date().toISOString() })}>Add {kind === 'procedural' ? 'playbook' : kind === 'episodic' ? 'past event' : 'fact'}</button>
      {editor && <form className="space-y-3 rounded-xl border border-cyan-300/30 p-3" onSubmit={event => { event.preventDefault(); void act('save', { record: { ...editor, memory_key: editor.memory_key || editor.title?.toLowerCase().replace(/\s+/g, '_') }, expected_version: editor.version }); }}>
        <div className="flex justify-between items-center"><p className="text-sm text-white">{editor.id ? 'Edit saved memory' : `New ${kindNames[editor.kind!].toLowerCase()}`}</p><button type="button" className={button} aria-label="Close memory editor" onClick={() => setEditor(null)}><X className="h-3 w-3" /></button></div>
        <label className="block text-xs text-white/60">Title<input required className={field + ' mt-1'} maxLength={160} value={editor.title} onChange={event => setEditor({ ...editor, title: event.target.value })} placeholder={kind === 'procedural' ? 'Shoe recommendation procedure' : 'Usual shoe budget'} /></label>
        <label className="block text-xs text-white/60">{kind === 'procedural' ? 'Steps to follow' : 'What to remember'}<textarea required rows={4} maxLength={6000} className={field + ' mt-1'} value={editor.content} onChange={event => setEditor({ ...editor, content: event.target.value })} /></label>
        {editor.kind === 'episodic' && <label className="block text-xs text-white/60">Report date<input required type="date" className={field + ' mt-1'} value={editor.happened_at?.slice(0, 10) || ''} onChange={event => setEditor({ ...editor, happened_at: event.target.value ? `${event.target.value}T12:00:00Z` : '' })} /></label>}
        <button className={button} disabled={saving || busy}>{saving ? 'Saving…' : 'Save memory'}</button>
      </form>}
      {sessionId && subjectId && <div className="space-y-3 border-t border-white/10 pt-4">
        <p className="text-sm text-white">Turn conversation into memory</p><p className="text-xs text-white/50">Review facts and a dated summary extracted from the latest 30 customer messages. Nothing is saved until you choose it.</p>
        <button type="button" className={button} disabled={saving || busy} onClick={() => void act('preview_consolidation', { session_id: sessionId })}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Extract memories to review'}</button>
        {candidates?.length === 0 && <p className="text-xs text-white/50">No remaining memory suggestions.</p>}
        {candidates?.map((candidate, index) => <div key={index} className="rounded-xl border border-white/10 p-3 space-y-2"><p className="text-sm text-white">{candidate.title}</p><p className="text-xs text-white/70">{candidate.content}</p><blockquote className="border-l border-cyan-400 pl-2 text-xs text-white/45">{candidate.source_quote}</blockquote><button type="button" className={button} disabled={saving} onClick={() => void act('accept_candidate', { session_id: sessionId, candidate })}>Save {kindNames[candidate.kind].toLowerCase()} <ArrowRight className="inline h-3 w-3" /></button></div>)}
      </div>}
    </div>}
  </section>;
}
