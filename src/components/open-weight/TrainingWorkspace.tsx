import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Cpu, Database, Download, FileJson, Loader2, Play, Upload, Weight } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

type Message = { role: 'system' | 'user' | 'assistant'; content: string };
type Example = { messages: Message[] };
type Job = {
  id: string; name: string; dataset_name: string; dataset_sha256: string; example_count: number;
  rank: number; alpha: number; learning_rate: number; max_steps: number; seed: number;
  status: string; progress: number; step: number; loss?: number; initial_loss?: number; final_loss?: number;
  trainable_parameters?: number; artifact_sha256?: string; repository?: string; repository_path?: string; error?: string;
};
type Props = { accessToken: string; baseModelId?: string };

const SYSTEM = 'You are Viaana Router. Reply with only compact JSON: {"tool":"<name>","arguments":{...}}.';
const pairs = [
  ['Track order AX-104', '{"tool":"viaana_track_order","arguments":{"order_id":"AX-104"}}'],
  ['Where is shipment BZ-882?', '{"tool":"viaana_track_order","arguments":{"order_id":"BZ-882"}}'],
  ['Check delivery for CM-771', '{"tool":"viaana_track_order","arguments":{"order_id":"CM-771"}}'],
  ['Cancel order DK-119', '{"tool":"viaana_cancel_order","arguments":{"order_id":"DK-119"}}'],
  ['Please stop shipment EV-420', '{"tool":"viaana_cancel_order","arguments":{"order_id":"EV-420"}}'],
  ['I no longer want order FP-305', '{"tool":"viaana_cancel_order","arguments":{"order_id":"FP-305"}}'],
  ['Book a callback tomorrow at 3 PM', '{"tool":"viaana_schedule_callback","arguments":{"when":"tomorrow 3 PM"}}'],
  ['Have someone call Friday morning', '{"tool":"viaana_schedule_callback","arguments":{"when":"Friday morning"}}'],
  ['Schedule a call for Monday at noon', '{"tool":"viaana_schedule_callback","arguments":{"when":"Monday noon"}}'],
  ['Find black running shoes under $140', '{"tool":"viaana_search_catalog","arguments":{"query":"black running shoes","max_price":140}}'],
  ['Show waterproof boots below $200', '{"tool":"viaana_search_catalog","arguments":{"query":"waterproof boots","max_price":200}}'],
  ['Search for red sandals under $90', '{"tool":"viaana_search_catalog","arguments":{"query":"red sandals","max_price":90}}'],
];
const starterExamples: Example[] = pairs.map(([user, assistant]) => ({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }, { role: 'assistant', content: assistant }] }));
const starterJsonl = starterExamples.map((example) => JSON.stringify(example)).join('\n');
const DRAFT_KEY = 'viaana-open-weight-training-draft-v1';

async function readJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function parseJsonl(value: string): Example[] {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const examples = lines.map((line, index) => {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { throw new Error(`Line ${index + 1} is not valid JSON`); }
    const example = parsed as Example;
    if (!Array.isArray(example?.messages) || example.messages.length < 2) throw new Error(`Line ${index + 1} needs at least two messages`);
    if (example.messages.some((message) => !['system', 'user', 'assistant'].includes(message?.role) || typeof message?.content !== 'string' || !message.content)) throw new Error(`Line ${index + 1} has an invalid message`);
    if (example.messages[example.messages.length - 1]?.role !== 'assistant') throw new Error(`Line ${index + 1} must end with an assistant target`);
    return example;
  });
  if (examples.length < 6 || examples.length > 200) throw new Error('Use 6–200 examples');
  return examples;
}

function download(name: string, text: string) {
  const href = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }));
  const anchor = document.createElement('a'); anchor.href = href; anchor.download = name; anchor.click(); URL.revokeObjectURL(href);
}

export function TrainingWorkspace({ accessToken, baseModelId }: Props) {
  const [datasetName, setDatasetName] = useState('viaana-tool-routing-v1');
  const [jobName, setJobName] = useState('Viaana tool router adapter');
  const [jsonl, setJsonl] = useState(() => localStorage.getItem(DRAFT_KEY) || starterJsonl);
  const [rank, setRank] = useState(8);
  const [alpha, setAlpha] = useState(16);
  const [learningRate, setLearningRate] = useState(0.0002);
  const [maxSteps, setMaxSteps] = useState(20);
  const [seed, setSeed] = useState(42);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hash, setHash] = useState('');
  const [testPrompt, setTestPrompt] = useState('Can you see where package QX-909 is right now?');
  const [comparison, setComparison] = useState<{ base?: string; trained?: string }>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => { try { return { examples: parseJsonl(jsonl), error: '' }; } catch (reason) { return { examples: [] as Example[], error: reason instanceof Error ? reason.message : 'Invalid JSONL' }; } }, [jsonl]);

  const headers = useMemo(() => ({ Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }), [accessToken]);
  const refresh = async () => {
    const body = await readJson(await fetch('/api/open-weight-training', { headers }));
    setJobs(body.jobs || []);
    if (activeJob) setActiveJob((body.jobs || []).find((job: Job) => job.id === activeJob.id) || activeJob);
  };

  useEffect(() => { refresh().catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load training jobs')); }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { localStorage.setItem(DRAFT_KEY, jsonl); }, [jsonl]);
  useEffect(() => {
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(jsonl)).then((value) => setHash(Array.from(new Uint8Array(value)).map((byte) => byte.toString(16).padStart(2, '0')).join('')));
  }, [jsonl]);
  useEffect(() => {
    if (!activeJob || ['completed', 'failed'].includes(activeJob.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const body = await readJson(await fetch(`/api/open-weight-training?jobId=${encodeURIComponent(activeJob.id)}`, { headers }));
        setActiveJob(body.job); setJobs((current) => [body.job, ...current.filter((job) => job.id !== body.job.id)]);
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to refresh job'); }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeJob?.id, activeJob?.status, headers]);

  const launch = async () => {
    if (parsed.error) return setError(parsed.error);
    setBusy(true); setError(''); setComparison({});
    try {
      const body = await readJson(await fetch('/api/open-weight-training', { method: 'POST', headers, body: JSON.stringify({ name: jobName, dataset_name: datasetName, examples: parsed.examples, rank, alpha, learning_rate: learningRate, max_steps: maxSteps, seed }) }));
      setActiveJob(body.job); setJobs((current) => [body.job, ...current]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to launch training'); }
    setBusy(false);
  };

  const compare = async () => {
    if (!activeJob || activeJob.status !== 'completed' || !baseModelId) return;
    setBusy(true); setError('');
    const datasetSystemPrompt = parsed.examples[0]?.messages.find((message) => message.role === 'system')?.content;
    const messages = [{ role: 'system', content: datasetSystemPrompt || SYSTEM }, { role: 'user', content: testPrompt }];
    try {
      const [base, trained] = await Promise.all([
        readJson(await fetch('/api/open-weight-chat', { method: 'POST', headers, body: JSON.stringify({ modelId: baseModelId, messages, temperature: 0, maxTokens: 128 }) })),
        readJson(await fetch(`/api/open-weight-training?jobId=${encodeURIComponent(activeJob.id)}&action=completion`, { method: 'POST', headers, body: JSON.stringify({ messages, temperature: 0, max_tokens: 128 }) })),
      ]);
      setComparison({ base: base.message?.content || '', trained: trained.choices?.[0]?.message?.content || '' });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Comparison failed'); }
    setBusy(false);
  };

  return <div className="space-y-5">
    <div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
      <Card className="space-y-4 border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-amber-200"><Database className="h-4 w-4" /><h3 className="font-semibold">Versioned JSONL dataset</h3></div><p className="mt-1 text-xs text-white/40">One conversation per line. The final assistant message is the supervised target.</p></div><div className="flex gap-2"><button onClick={() => fileRef.current?.click()} className="rounded-lg border border-white/10 p-2 text-white/45 hover:text-white" aria-label="Upload JSONL"><Upload className="h-4 w-4" /></button><button onClick={() => download(`${datasetName}.jsonl`, jsonl)} className="rounded-lg border border-white/10 p-2 text-white/45 hover:text-white" aria-label="Download JSONL"><Download className="h-4 w-4" /></button><input ref={fileRef} type="file" accept=".jsonl,.ndjson,application/x-ndjson" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) file.text().then(setJsonl); }} /></div></div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-white/50">Dataset name<input value={datasetName} onChange={(event) => setDatasetName(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white" /></label><label className="text-xs text-white/50">Job name<input value={jobName} onChange={(event) => setJobName(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white" /></label></div>
        <textarea aria-label="Training dataset JSONL" value={jsonl} onChange={(event) => setJsonl(event.target.value)} rows={14} spellCheck={false} className="w-full rounded-xl border border-white/10 bg-slate-950 p-3 font-mono text-[11px] leading-5 text-white/70 focus:outline-none focus:ring-2 focus:ring-amber-400/40" />
        <div className="flex flex-wrap items-center gap-3 text-[11px]"><span className={`rounded-full px-2 py-1 ${parsed.error ? 'bg-rose-400/10 text-rose-200' : 'bg-emerald-400/10 text-emerald-200'}`}>{parsed.error || `${parsed.examples.length} valid examples`}</span><span className="font-mono text-white/30">SHA-256 {hash.slice(0, 16)}…</span><button onClick={() => setJsonl(starterJsonl)} className="text-amber-200/70 hover:text-amber-100">Restore starter dataset</button></div>
      </Card>
      <div className="space-y-4">
        <Card className="space-y-4 border-white/10 bg-white/[0.03] p-5"><div className="flex items-center gap-2"><Weight className="h-4 w-4 text-amber-200" /><h3 className="font-semibold text-white">LoRA configuration</h3></div>
          <div className="grid grid-cols-2 gap-3"><label className="text-xs text-white/45">Rank<select value={rank} onChange={(e) => setRank(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"><option>4</option><option>8</option><option>16</option></select></label><label className="text-xs text-white/45">Alpha<input type="number" min="4" max="64" value={alpha} onChange={(e) => setAlpha(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white" /></label><label className="text-xs text-white/45">Learning rate<input type="number" min="0.00001" max="0.002" step="0.00001" value={learningRate} onChange={(e) => setLearningRate(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white" /></label><label className="text-xs text-white/45">Steps<input type="number" min="2" max="200" value={maxSteps} onChange={(e) => setMaxSteps(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white" /></label><label className="col-span-2 text-xs text-white/45">Seed<input type="number" min="0" value={seed} onChange={(e) => setSeed(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white" /></label></div>
          <Button onClick={launch} disabled={busy || !!parsed.error} className="w-full bg-amber-400 text-slate-950 hover:bg-amber-300">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Train adapter</Button><p className="text-[11px] leading-5 text-white/35">Runs on the private T4. One job can train at a time; inputs are capped at 200 examples and 200 steps.</p></Card>
        {activeJob && <Card className="border-amber-300/15 bg-amber-400/[0.04] p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-wider text-white/35">Current job</p><h4 className="mt-1 text-sm font-semibold text-white">{activeJob.name}</h4><p className="mt-1 font-mono text-[10px] text-white/35">{activeJob.id}</p></div>{activeJob.status === 'completed' ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : activeJob.status === 'failed' ? <span className="text-xs text-rose-300">Failed</span> : <Loader2 className="h-5 w-5 animate-spin text-amber-200" />}</div><div className="mt-4 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full bg-amber-300 transition-all" style={{ width: `${activeJob.progress || 0}%` }} /></div><div className="mt-3 flex justify-between text-xs text-white/45"><span className="capitalize">{activeJob.status}</span><span>{activeJob.step || 0}/{activeJob.max_steps} steps{activeJob.loss == null ? '' : ` · loss ${activeJob.loss}`}</span></div>{activeJob.error && <p className="mt-3 text-xs text-rose-300">{activeJob.error}</p>}{activeJob.artifact_sha256 && <div className="mt-4 space-y-1 border-t border-white/10 pt-3 text-[11px] text-white/40"><p>Adapter SHA-256 <span className="font-mono text-emerald-200/70">{activeJob.artifact_sha256}</span></p><p>{activeJob.repository}/{activeJob.repository_path}</p><p>Loss {activeJob.initial_loss} → {activeJob.final_loss} · {activeJob.trainable_parameters?.toLocaleString()} trainable parameters</p></div>}</Card>}
      </div>
    </div>
    {activeJob?.status === 'completed' && <Card className="space-y-4 border-emerald-300/15 bg-emerald-400/[0.03] p-5"><div className="flex items-center gap-2"><Cpu className="h-4 w-4 text-emerald-200" /><h3 className="font-semibold text-white">Held-out base vs trained adapter</h3></div><div className="flex flex-col gap-3 sm:flex-row"><input value={testPrompt} onChange={(event) => setTestPrompt(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" /><Button onClick={compare} disabled={busy || !baseModelId}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Compare</Button></div>{(comparison.base !== undefined || comparison.trained !== undefined) && <div className="grid gap-3 md:grid-cols-2"><div className="rounded-xl border border-white/10 bg-slate-950/70 p-4"><p className="text-[10px] uppercase tracking-wider text-white/35">Frozen base</p><pre className="mt-3 whitespace-pre-wrap text-xs text-white/65">{comparison.base}</pre></div><div className="rounded-xl border border-emerald-300/20 bg-emerald-400/[0.04] p-4"><p className="text-[10px] uppercase tracking-wider text-emerald-200/60">New adapter</p><pre className="mt-3 whitespace-pre-wrap text-xs text-white/80">{comparison.trained}</pre></div></div>}</Card>}
    {!!jobs.length && <Card className="overflow-hidden border-white/10 bg-white/[0.03]"><div className="flex items-center gap-2 border-b border-white/10 p-4"><FileJson className="h-4 w-4 text-white/45" /><h3 className="text-sm font-semibold text-white">Adapter registry</h3></div><div className="divide-y divide-white/5">{jobs.map((job) => <button key={job.id} onClick={() => setActiveJob(job)} className="flex w-full items-center gap-4 p-4 text-left hover:bg-white/[0.03]"><span className={`h-2 w-2 rounded-full ${job.status === 'completed' ? 'bg-emerald-400' : job.status === 'failed' ? 'bg-rose-400' : 'bg-amber-300'}`} /><div className="min-w-0 flex-1"><p className="truncate text-sm text-white/70">{job.name}</p><p className="mt-1 truncate text-[11px] text-white/35">{job.dataset_name} · {job.example_count} examples · rank {job.rank} · {job.max_steps} steps</p></div><span className="text-xs capitalize text-white/40">{job.status}</span></button>)}</div></Card>}
    {error && <p className="rounded-lg border border-rose-300/15 bg-rose-400/[0.05] p-3 text-sm text-rose-200">{error}</p>}
  </div>;
}
