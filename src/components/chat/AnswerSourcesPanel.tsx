import { BookOpen, Database, Brain, ListChecks } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { AnswerSources } from '../../types/chat';
import type { MemoryReceipt, MemoryRecord } from '../../../shared/agent-memory';
import { sourceActivity, type SourceActivity } from '../../lib/source-activity';
import { cn } from '../../lib/utils';

function Spotlight({ title, state, demo, turn, children, summary }: {
  title: string; state: SourceActivity['state']; demo: boolean; turn?: string; children: ReactNode; summary: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (demo) setOpen(state === 'active' || state === 'complete' || state === 'failed');
  }, [demo, turn, state]);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} data-source-state={state}
    className={cn('relative rounded-xl border p-3 transition-colors duration-300 motion-reduce:transition-none',
      state === 'active' ? 'border-cyan-300/70 bg-cyan-400/10 shadow-[0_0_20px_rgba(34,211,238,0.12)]'
      : state === 'complete' ? 'border-cyan-300/40 bg-cyan-400/5'
      : state === 'failed' ? 'border-amber-300/40 bg-amber-400/5' : 'border-white/10 bg-black/20')}>
    {(state === 'active' || state === 'complete') && <span aria-hidden="true" className={cn('absolute left-0 top-4 bottom-4 w-0.5 rounded-full bg-cyan-300', state === 'active' && 'motion-safe:animate-pulse')} />}
    <summary aria-label={title} className="cursor-pointer">{summary}</summary>
    <div className="mt-3 max-h-80 overflow-auto border-t border-white/10 pt-3 text-sm text-white/75">{children}</div>
  </details>;
}

const MEMORY_SECTIONS = [
  { kind: 'semantic', title: 'Semantic Memory', description: 'What I know about you · facts and preferences', empty: 'No personal facts supplied for this answer.' },
  { kind: 'episodic', title: 'Episodic Memory', description: 'What happened before · past experiences', empty: 'No past experiences supplied for this answer.' },
  { kind: 'procedural', title: 'Procedural Memory', description: 'Saved agent playbooks · how to handle a task', empty: '' }
] as const;

export function AnswerSourcesPanel({ sources, memory, busy = false }: { sources?: AnswerSources; memory?: MemoryReceipt; busy?: boolean }) {
  const [demo, setDemo] = useState(() => {
    try { return localStorage.getItem('answer-sources-demo-focus') === 'true'; } catch { return false; }
  });
  const activity = sourceActivity(sources, memory, busy);
  const events = (sources?.memoryEvents || []).filter(event => event.turn_id === sources?.turnId);
  const retrieved = events.filter(event => ['retrieved', 'updated', 'saved'].includes(event.kind)).flatMap(event => (event.payload.records || []) as MemoryRecord[]);
  const current = [...new Map([...(memory?.records || []), ...retrieved].map(record => [record.id, record])).values()];
  const updatedIds = new Set(events.filter(event => event.kind === 'updated').map(event => event.payload.id));
  const memories = [
    ...current.map(record => ({ record, status: updatedIds.has(record.id) ? 'Memory updated' : 'Retrieved this turn' })),
    ...(memory?.carriedRecords || []).filter(record => !current.some(item => item.id === record.id)).map(record => ({ record, status: 'Already in conversation' })),
    ...(memory?.playbooks || []).map(record => ({ record, status: 'Procedure supplied' }))
  ];
  const tools = [...(sources?.tools || []).map(tool => ({ tool, status: 'This turn' })), ...(sources?.carriedTools || []).map(tool => ({ tool, status: 'Already in conversation' }))];
  const sql = tools.filter(({ tool }) => /execute_sql/i.test(tool.toolName));
  const cards = [
    { title: 'My instructions', subtitle: 'Procedural memory · configured behavior', icon: ListChecks, status: sources ? 'Supplied throughout this turn' : 'No recorded turn', content: <p className="whitespace-pre-wrap">{sources?.instructions || 'Start a conversation to capture its instructions.'}</p> },
    {
      title: 'Personal memories', subtitle: 'Semantic facts and episodic experiences', icon: Brain,
      status: memories.length ? `${memories.length} records supplied` : memory?.lookup === 'requested' ? 'No matching memories' : 'No memory retrieval recorded',
      content: <div className="space-y-5">
        {MEMORY_SECTIONS.map(section => {
          const entries = memories.filter(({ record }) => record.kind === section.kind);
          if (section.kind === 'procedural' && !entries.length) return null;
          const accessed = entries.some(entry => entry.status !== 'Already in conversation');
          return <section key={section.kind} aria-label={section.title} className={cn('space-y-2 rounded-lg border-l-2 pl-3 transition-colors motion-reduce:transition-none', accessed ? 'border-cyan-300 bg-cyan-400/5 py-2 pr-2' : 'border-white/10')}>
            <div>
              <h3 className="flex items-center justify-between gap-2 font-semibold text-white">
                {section.title}<span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-normal text-white/60">{entries.length}</span>
              </h3>
              <p className="mt-1 text-xs text-white/50">{section.description}</p>
            </div>
            {entries.map(({ record, status }) => <article key={`${record.id}-${status}`} className={cn('rounded-lg border p-3', updatedIds.has(record.id) ? 'border-emerald-300/50 bg-emerald-400/10' : 'border-white/10')}>
              <p className="text-cyan-200">{record.title}</p>
              <p className="text-[11px] text-white/50">{status}</p>
              <p className="mt-2 whitespace-pre-wrap">{record.content}</p>
              {updatedIds.has(record.id) && (() => {
                const previous = events.filter(event => event.kind === 'retrieved').flatMap(event => (event.payload.records || []) as MemoryRecord[]).find(item => item.id === record.id && item.version < record.version);
                return previous ? <p className="mt-2 text-xs text-white/50"><span className="font-medium">Previously:</span> {previous.content}</p> : null;
              })()}
              <p className="mt-2 text-xs text-white/50">Source: {record.source_quote || 'Owner-authored note'} · Version {record.version}</p>
            </article>)}
            {!entries.length && <p className="text-xs text-white/45">{section.empty}</p>}
          </section>;
        })}
        {!memories.length && <p className="text-xs text-white/50">{activity.memory.state === 'active' ? 'Waiting for the memory search results.' : 'Select a customer in Manage memories to enable recall. A search may also return no matches.'}</p>}
      </div>
    },
    { title: 'Product guide', subtitle: 'Document knowledge · retrieved through RAG', icon: BookOpen, status: sources?.ragStatus === 'searching' ? 'Searching…' : sources?.ragStatus === 'failed' ? 'Retrieval failed' : sources?.ragStatus === 'retrieved' ? `${sources.rag?.citations.length || 0} passages retrieved this turn` : 'Not retrieved this turn', content: <div className="space-y-3">{sources?.rag?.citations.map((citation, index) => <article key={`${citation.file_id}-${index}`} className="rounded-lg border border-white/10 p-3"><p className="text-emerald-200">[K{index + 1}] {citation.title || citation.file_id}</p><p className="mt-2 whitespace-pre-wrap">{citation.snippet}</p></article>)}{!sources?.rag?.citations.length && <p>No document passages supplied this turn. Earlier answers may remain in the conversation.</p>}</div> },
    { title: 'Business data', subtitle: 'Catalog and other structured records · SQL', icon: Database, status: sql.length ? `${sql.filter(item => item.status === 'This turn').length} calls this turn` : 'No SQL lookup recorded', content: <div className="space-y-3">{sql.map(({ tool, status }, index) => <article key={tool.id} className="rounded-lg border border-white/10 p-3"><p className="text-amber-200">Result {index + 1} · {status} · {tool.status}</p><p className="text-xs text-white/40">{new Date(tool.createdAt).toLocaleString()}</p><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{JSON.stringify(tool.response || tool.error || 'Waiting for result', null, 2)}</pre><details className="mt-2"><summary className="cursor-pointer">View query</summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(tool.request, null, 2)}</pre></details></article>)}{!sql.length && <p>No structured database results in this receipt. Stored inventory is not a guarantee of live storefront availability.</p>}</div> }
  ];
  return <section aria-label="Sources behind this answer" className="rounded-2xl border border-cyan-300/20 bg-slate-900/60 p-5">
    <h2 className="text-lg font-semibold text-white">Sources behind this answer</h2>
    <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-cyan-100">
      <input type="checkbox" checked={demo} onChange={event => {
        setDemo(event.target.checked);
        try { localStorage.setItem('answer-sources-demo-focus', String(event.target.checked)); } catch { /* Optional preference. */ }
      }} className="accent-cyan-400" /> Demo focus · open active sources automatically
    </label>
    <p className="mt-1 text-xs text-white/50">See the information supplied to the agent. This is a source receipt, not its private reasoning.</p>
    {sources?.question && <p className="my-4 rounded-xl bg-white/5 p-3 text-sm text-white/80">{sources.question}</p>}
    <div className="mt-4 space-y-3">{cards.map(({ title, subtitle, icon: Icon, content }, index) => {
      const highlight = index === 1 ? activity.memory : index === 2 ? activity.knowledge : index === 3 ? activity.data : { state: 'idle' as const, label: sources ? 'Always included' : 'No recorded turn' };
      return <Spotlight key={title} title={title} state={highlight.state} demo={demo} turn={sources?.turnId || sources?.question}
        summary={<><span className="inline-flex items-center gap-2 font-medium text-white"><Icon className="h-4 w-4 text-cyan-200" />{title}</span><span className="mt-1 block text-xs text-white/50">{subtitle}</span><span role="status" className="mt-2 flex items-center gap-2 text-xs text-cyan-200"><span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', highlight.state === 'active' ? 'bg-cyan-300 motion-safe:animate-pulse' : highlight.state === 'complete' ? 'bg-cyan-300' : 'bg-white/30')} />{highlight.label}</span></>}>
        {content}
      </Spotlight>;
    })}</div>
    <p className="mt-4 text-xs text-white/40">Instructions + recalled memories + retrieved knowledge + tool results → answer context</p>
  </section>;
}
