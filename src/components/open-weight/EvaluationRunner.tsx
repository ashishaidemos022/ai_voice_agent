import { useEffect, useMemo, useState } from 'react';
import { Check, Download, FlaskConical, Loader2, Play, RotateCcw, X } from 'lucide-react';
import rawEvidence from '../../data/openWeightEvidence.json';
import { gradeEvaluation, extractToolCalls, type EvaluationExpected, type EvaluationToolCall } from './evaluation';

type Model = { id: string; model: string };
type Case = {
  id: string;
  category: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  expected: EvaluationExpected;
};
type CaseResult = {
  caseId: string; category: string; pass: boolean; answer: string; toolCalls: EvaluationToolCall[];
  latencyMs: number; costUsd: number | null; inputTokens: number | null; outputTokens: number | null; error?: string;
};
type EvaluationRun = {
  id: string; createdAt: string; benchmark: string; benchmarkSha256: string; modelId: string;
  categories: string[]; results: CaseResult[];
};

const evidence = rawEvidence as unknown as { baselineRuns: { hosted: { benchmark: string; benchmarkSha256: string; cases: Case[]; results: Array<{ caseId: string; pass: boolean }> } } };
const categories = [
  ['extraction', 'Extraction'], ['grounding', 'Grounded unknowns'], ['reasoning', 'Arithmetic'],
  ['tool-selection', 'Tool selection'], ['untrusted-data', 'Prompt injection'], ['conversation', 'Conversation correction']
] as const;
const HISTORY_KEY = 'viaana-open-weight-evaluation-history-v1';

function downloadRun(run: EvaluationRun) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = href; anchor.download = `${run.id}.json`; anchor.click(); URL.revokeObjectURL(href);
}

export function EvaluationRunner({ accessToken, models }: { accessToken: string; models: Model[] }) {
  const [modelId, setModelId] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(categories.map(([id]) => id));
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [results, setResults] = useState<CaseResult[]>([]);
  const [history, setHistory] = useState<EvaluationRun[]>([]);
  const [error, setError] = useState('');

  useEffect(() => { if (!modelId && models.length) setModelId(models[0].id); }, [modelId, models]);
  useEffect(() => { try { setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')); } catch { setHistory([]); } }, []);

  const selectedCases = useMemo(() => evidence.baselineRuns.hosted.cases.filter((item) => selectedCategories.includes(item.category)), [selectedCategories]);
  const baselinePassed = useMemo(() => selectedCases.filter((item) => evidence.baselineRuns.hosted.results.find((result) => result.caseId === item.id)?.pass).length, [selectedCases]);
  const passed = results.filter((result) => result.pass).length;
  const cost = results.reduce((sum, result) => sum + (result.costUsd || 0), 0);
  const meanLatency = results.length ? Math.round(results.reduce((sum, result) => sum + result.latencyMs, 0) / results.length) : 0;

  const runCase = async (item: Case): Promise<CaseResult> => {
    const started = performance.now();
    try {
      const response = await fetch('/api/open-weight-chat', {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId, messages: item.messages, maxTokens: 512, temperature: 0,
          tools: item.tools?.map((tool) => ({ type: 'function', function: tool }))
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
      const toolCalls = extractToolCalls(body.message);
      const answer = typeof body.message?.content === 'string' ? body.message.content : '';
      return {
        caseId: item.id, category: item.category, answer, toolCalls,
        pass: gradeEvaluation(item.expected, answer, toolCalls), latencyMs: body.latencyMs ?? performance.now() - started,
        costUsd: body.costUsd ?? null, inputTokens: body.usage?.inputTokens ?? null, outputTokens: body.usage?.outputTokens ?? null
      };
    } catch (reason) {
      return { caseId: item.id, category: item.category, answer: '', toolCalls: [], pass: false, latencyMs: performance.now() - started, costUsd: null, inputTokens: null, outputTokens: null, error: reason instanceof Error ? reason.message : 'Request failed' };
    }
  };

  const runEvaluation = async () => {
    if (!modelId || !selectedCases.length || running) return;
    setRunning(true); setCompleted(0); setResults([]); setError('');
    const collected: CaseResult[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < selectedCases.length) {
        const item = selectedCases[cursor++];
        const result = await runCase(item);
        collected.push(result); setResults([...collected]); setCompleted(collected.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, selectedCases.length) }, worker));
    collected.sort((a, b) => selectedCases.findIndex((item) => item.id === a.caseId) - selectedCases.findIndex((item) => item.id === b.caseId));
    const run: EvaluationRun = {
      id: `evaluation-${new Date().toISOString().replace(/[:.]/g, '-')}`, createdAt: new Date().toISOString(),
      benchmark: evidence.baselineRuns.hosted.benchmark, benchmarkSha256: evidence.baselineRuns.hosted.benchmarkSha256,
      modelId, categories: selectedCategories, results: collected
    };
    const nextHistory = [run, ...history].slice(0, 10); setHistory(nextHistory); localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
    if (collected.some((result) => result.error)) setError(`${collected.filter((result) => result.error).length} request(s) failed. Open the failed cases below for details.`);
    setResults(collected); setRunning(false);
  };

  const toggleCategory = (id: string) => setSelectedCategories((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const latestRun = history[0];

  return <div className="space-y-5">
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div><div className="flex items-center gap-2 text-amber-200"><FlaskConical className="h-4 w-4" /><p className="text-xs font-semibold uppercase tracking-[.18em]">Live deterministic suite</p></div><h3 className="mt-2 text-lg font-semibold text-white">Run the frozen 30-case benchmark</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">Every selected case uses temperature 0, a 512-token limit, exact contract grading, and three concurrent requests. Retrieval, routing, memory, and fallback remain off.</p></div>
        <div className="grid shrink-0 grid-cols-2 gap-3 text-xs sm:grid-cols-4"><div className="rounded-xl bg-slate-950/70 p-3"><p className="text-white/30">Cases</p><p className="mt-1 text-lg text-white">{selectedCases.length}</p></div><div className="rounded-xl bg-slate-950/70 p-3"><p className="text-white/30">Published</p><p className="mt-1 text-lg text-white">{baselinePassed}/{selectedCases.length}</p></div><div className="rounded-xl bg-slate-950/70 p-3"><p className="text-white/30">Saved</p><p className="mt-1 text-lg text-white">{history.length}</p></div><div className="rounded-xl bg-slate-950/70 p-3"><p className="text-white/30">Est. cost</p><p className="mt-1 text-lg text-white">&lt;$0.001</p></div></div>
      </div>
      <div className="mt-5 border-t border-white/10 pt-5"><div className="grid gap-4 md:grid-cols-[.7fr_1.3fr_auto]"><label className="text-xs text-white/45">Model<select value={modelId} onChange={(event) => setModelId(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-xs text-white">{models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}</select></label><div><p className="text-xs text-white/45">Categories</p><div className="mt-2 flex flex-wrap gap-2">{categories.map(([id, label]) => <button key={id} onClick={() => toggleCategory(id)} className={`rounded-full border px-3 py-2 text-xs transition ${selectedCategories.includes(id) ? 'border-amber-300/30 bg-amber-400/10 text-amber-100' : 'border-white/10 text-white/35'}`}>{selectedCategories.includes(id) && <Check className="mr-1 inline h-3 w-3" />}{label}</button>)}</div></div><button onClick={runEvaluation} disabled={running || !modelId || !selectedCases.length} className="self-end rounded-xl bg-amber-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">{running ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Running {completed}/{selectedCases.length}</span> : <span className="flex items-center gap-2"><Play className="h-4 w-4" /> Run suite</span>}</button></div></div>
      {running && <div className="mt-5"><div className="mb-2 flex justify-between text-xs text-white/35"><span>Live progress</span><span>{Math.round(completed / selectedCases.length * 100)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-400 transition-all" style={{ width: `${completed / selectedCases.length * 100}%` }} /></div></div>}
      {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}
    </section>

    {!!results.length && <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-[10px] uppercase tracking-wider text-white/30">Live score</p><p className="mt-2 text-2xl text-white">{passed}/{results.length}</p></div><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-[10px] uppercase tracking-wider text-white/30">Pass rate</p><p className="mt-2 text-2xl text-white">{(passed / results.length * 100).toFixed(1)}%</p></div><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-[10px] uppercase tracking-wider text-white/30">Mean latency</p><p className="mt-2 text-2xl text-white">{meanLatency.toLocaleString()} ms</p></div><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-[10px] uppercase tracking-wider text-white/30">Measured cost</p><p className="mt-2 text-2xl text-white">${cost.toFixed(6)}</p></div></section>
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"><div className="flex items-center justify-between border-b border-white/10 p-5"><div><h3 className="font-semibold text-white">Case results</h3><p className="mt-1 text-xs text-white/35">Published baseline for this selection: {baselinePassed}/{selectedCases.length}</p></div>{latestRun && <button onClick={() => downloadRun(latestRun)} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/50 hover:text-white"><Download className="h-3.5 w-3.5" /> Export</button>}</div><div className="divide-y divide-white/5">{results.map((result) => { const item = selectedCases.find((entry) => entry.id === result.caseId)!; const answer = result.toolCalls.length ? result.toolCalls.map((call) => `${call.name}(${String(call.arguments)})`).join('\n') : result.answer; return <details key={result.caseId} className="group p-4"><summary className="flex cursor-pointer list-none items-center gap-3"><span className={`flex h-6 w-6 items-center justify-center rounded-full ${result.pass ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>{result.pass ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}</span><span className="w-28 text-xs font-medium text-white/70">{result.caseId}</span><span className="min-w-0 flex-1 truncate text-xs text-white/35">{categories.find(([id]) => id === result.category)?.[1]}</span><span className="text-[10px] text-white/30">{Math.round(result.latencyMs)} ms</span></summary><div className="ml-9 mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-xl bg-slate-950/70 p-3"><p className="text-[10px] uppercase tracking-wider text-white/30">Prompt</p><p className="mt-2 text-xs leading-5 text-white/60">{item.messages[item.messages.length - 1].content}</p></div><div className="rounded-xl bg-slate-950/70 p-3"><p className="text-[10px] uppercase tracking-wider text-white/30">Model output</p><pre className={`mt-2 whitespace-pre-wrap text-xs leading-5 ${result.pass ? 'text-emerald-100' : 'text-rose-100'}`}>{result.error || answer || '(empty)'}</pre></div></div></details>; })}</div></section>
    </>}

    {!!history.length && <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><h3 className="font-semibold text-white">Recent evaluation runs</h3><div className="mt-4 space-y-2">{history.slice(0, 5).map((run) => <div key={run.id} className="flex flex-col gap-3 rounded-xl border border-white/5 bg-slate-950/40 p-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="truncate text-xs text-white/65">{run.modelId} · {run.results.filter((result) => result.pass).length}/{run.results.length}</p><p className="mt-1 text-[10px] text-white/30">{new Date(run.createdAt).toLocaleString()}</p></div><div className="flex gap-2"><button onClick={() => { setResults(run.results); setSelectedCategories(run.categories); setModelId(run.modelId); }} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/45 hover:text-white"><RotateCcw className="h-3 w-3" /> View</button><button onClick={() => downloadRun(run)} className="rounded-lg border border-white/10 p-2 text-white/40 hover:text-white" aria-label={`Download ${run.id}`}><Download className="h-3.5 w-3.5" /></button></div></div>)}</div></section>}
  </div>;
}
