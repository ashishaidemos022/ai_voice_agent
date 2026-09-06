import { BookOpen, Database, Brain, ListChecks } from 'lucide-react';
import type { AnswerSources } from '../../types/chat';
import type { MemoryReceipt } from '../../../shared/agent-memory';
import { MEMORY_LABELS } from '../../../shared/agent-memory';

export function AnswerSourcesPanel({ sources, memory }: { sources?: AnswerSources; memory?: MemoryReceipt }) {
  const memories = [
    ...(memory?.records || []).map(record => ({ record, status: 'Retrieved this turn' })),
    ...(memory?.carriedRecords || []).map(record => ({ record, status: 'Already in conversation' })),
    ...(memory?.playbooks || []).map(record => ({ record, status: 'Procedure supplied' }))
  ];
  const tools = [...(sources?.tools || []).map(tool => ({ tool, status: 'This turn' })), ...(sources?.carriedTools || []).map(tool => ({ tool, status: 'Already in conversation' }))];
  const sql = tools.filter(({ tool }) => /execute_sql/i.test(tool.toolName));
  const cards = [
    { title: 'My instructions', subtitle: 'Procedural memory · configured behavior', icon: ListChecks, status: sources ? 'Supplied throughout this turn' : 'No recorded turn', content: <p className="whitespace-pre-wrap">{sources?.instructions || 'Start a conversation to capture its instructions.'}</p> },
    { title: 'Personal memories', subtitle: 'Facts, past experiences and saved playbooks', icon: Brain, status: memories.length ? `${memories.length} records supplied` : memory?.lookup === 'requested' ? 'No matching memories' : 'No memory retrieval recorded', content: <div className="space-y-3">{memories.map(({ record, status }) => <article key={`${record.id}-${status}`} className="rounded-lg border border-white/10 p-3"><p className="text-cyan-200">{record.title}</p><p className="text-[11px] text-white/50">{MEMORY_LABELS[record.kind].description} · {status}</p><p className="mt-2 whitespace-pre-wrap">{record.content}</p><p className="mt-2 text-xs text-white/50">Source: {record.source_quote || 'Owner-authored note'} · Version {record.version}</p></article>)}{!memories.length && <p>Select a customer in Manage memories to enable recall. A search may also return no matches.</p>}</div> },
    { title: 'Product guide', subtitle: 'Document knowledge · retrieved through RAG', icon: BookOpen, status: sources?.ragStatus === 'searching' ? 'Searching…' : sources?.ragStatus === 'failed' ? 'Retrieval failed' : sources?.ragStatus === 'retrieved' ? `${sources.rag?.citations.length || 0} passages retrieved this turn` : 'Not retrieved this turn', content: <div className="space-y-3">{sources?.rag?.citations.map((citation, index) => <article key={`${citation.file_id}-${index}`} className="rounded-lg border border-white/10 p-3"><p className="text-emerald-200">[K{index + 1}] {citation.title || citation.file_id}</p><p className="mt-2 whitespace-pre-wrap">{citation.snippet}</p></article>)}{!sources?.rag?.citations.length && <p>No document passages supplied this turn. Earlier answers may remain in the conversation.</p>}</div> },
    { title: 'Business data', subtitle: 'Catalog and other structured records · SQL', icon: Database, status: sql.length ? `${sql.filter(item => item.status === 'This turn').length} calls this turn` : 'No SQL lookup recorded', content: <div className="space-y-3">{sql.map(({ tool, status }, index) => <article key={tool.id} className="rounded-lg border border-white/10 p-3"><p className="text-amber-200">Result {index + 1} · {status} · {tool.status}</p><p className="text-xs text-white/40">{new Date(tool.createdAt).toLocaleString()}</p><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{JSON.stringify(tool.response || tool.error || 'Waiting for result', null, 2)}</pre><details className="mt-2"><summary className="cursor-pointer">View query</summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(tool.request, null, 2)}</pre></details></article>)}{!sql.length && <p>No structured database results in this receipt. Stored inventory is not a guarantee of live storefront availability.</p>}</div> }
  ];
  return <section aria-label="Sources behind this answer" className="rounded-2xl border border-cyan-300/20 bg-slate-900/60 p-5">
    <h2 className="text-lg font-semibold text-white">Sources behind this answer</h2>
    <p className="mt-1 text-xs text-white/50">See the information supplied to the agent. This is a source receipt, not its private reasoning.</p>
    {sources?.question && <p className="my-4 rounded-xl bg-white/5 p-3 text-sm text-white/80">{sources.question}</p>}
    <div className="mt-4 space-y-3">{cards.map(({ title, subtitle, icon: Icon, status, content }) => <details key={title} className="rounded-xl border border-white/10 bg-black/20 p-3">
      <summary className="cursor-pointer"><span className="inline-flex items-center gap-2 font-medium text-white"><Icon className="h-4 w-4 text-cyan-200" />{title}</span><span className="mt-1 block text-xs text-white/50">{subtitle}</span><span className="mt-2 block text-xs text-cyan-200">{status}</span></summary>
      <div className="mt-3 max-h-80 overflow-auto border-t border-white/10 pt-3 text-sm text-white/75">{content}</div>
    </details>)}</div>
    <p className="mt-4 text-xs text-white/40">Instructions + recalled memories + retrieved knowledge + tool results → answer context</p>
  </section>;
}
