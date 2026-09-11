import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, FileCheck2, Loader2, Rocket, Upload, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { gradeFacts, parseAdapterTests, wordDiff, type AdapterTestCase } from './adapterEvaluationUtils';

type Job = {
  id: string; name: string; dataset_name: string; dataset_sha256: string; artifact_sha256?: string;
  promotion_status?: string; promoted_at?: number; fused_sha256?: string; fused_repository_path?: string;
};
type VariantResult = { answer: string; pass: boolean; missing: string[]; forbidden: string[]; latencyMs: number; error?: string };
type CaseResult = { id: string; category: string; prompt: string; base: VariantResult; adapter: VariantResult; fused?: VariantResult };
type EvidenceRun = {
  id: string; createdAt: string; job: Pick<Job, 'id' | 'name' | 'dataset_name' | 'dataset_sha256' | 'artifact_sha256' | 'fused_sha256'>;
  suiteSha256: string; temperature: 0; cases: CaseResult[];
};

const WREN_SYSTEM = "You are Wren Restaurants' factual FAQ assistant. Answer only from the facts learned during training. Keep answers concise. Preserve qualifications about location-specific or holiday variations.";
const wrenCases: AdapterTestCase[] = [
  { id: 'hours-saturday', category: 'hours', messages: [{ role: 'system', content: WREN_SYSTEM }, { role: 'user', content: 'Can we come to Wren for lunch at noon on Saturday?' }], expected: { required: [['11:30 a.m.', '11:30 am'], ['2:30 p.m.', '2:30 pm'], ['Tuesday–Sunday', 'Tuesday-Sunday', 'Tuesday through Sunday', 'Tuesday to Sunday'], ['location', 'locations'], ['holiday', 'holidays']] } },
  { id: 'gift-card-cross-location', category: 'gift-cards', messages: [{ role: 'system', content: WREN_SYSTEM }, { role: 'user', content: 'Can I purchase a $75 Wren gift card online and use it at a different Wren location?' }], expected: { required: [['online'], ['any amount'], ['any Wren location', 'all Wren locations']], forbidden: ['cannot', "can't", 'can not', 'only at the location'] } },
];
const wrenJsonl = wrenCases.map((item) => JSON.stringify(item)).join('\n');
const HISTORY_KEY = 'viaana-adapter-evaluation-history-v1';

async function readJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

async function sha256(value: unknown) {
  const canonical = JSON.stringify(value);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function download(run: EvidenceRun) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = href; anchor.download = `${run.id}.json`; anchor.click(); URL.revokeObjectURL(href);
}

function score(cases: CaseResult[], variant: 'base' | 'adapter' | 'fused') {
  return cases.filter((item) => item[variant]?.pass).length;
}

export function AdapterEvaluation({ accessToken, baseModelId, job, onJobUpdated }: { accessToken: string; baseModelId?: string; job: Job; onJobUpdated: (job: Job) => void }) {
  const [jsonl, setJsonl] = useState(() => /wren/i.test(`${job.name} ${job.dataset_name}`) ? wrenJsonl : '');
  const [run, setRun] = useState<EvidenceRun | null>(null);
  const [running, setRunning] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState('');
  const [persistedHash, setPersistedHash] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => { try { return { cases: parseAdapterTests(jsonl), error: '' }; } catch (reason) { return { cases: [] as AdapterTestCase[], error: reason instanceof Error ? reason.message : 'Invalid held-out JSONL' }; } }, [jsonl]);
  useEffect(() => { setRun(null); setError(''); setPersistedHash(''); setJsonl(/wren/i.test(`${job.name} ${job.dataset_name}`) ? wrenJsonl : ''); }, [job.id]);

  const requestVariant = async (item: AdapterTestCase, variant: 'base' | 'adapter' | 'fused'): Promise<VariantResult> => {
    const started = performance.now();
    try {
      const url = variant === 'base' ? '/api/open-weight-chat' : `/api/open-weight-training?jobId=${encodeURIComponent(job.id)}&action=${variant === 'fused' ? 'fused-completion' : 'completion'}`;
      const response = await fetch(url, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(variant === 'base' ? { modelId: baseModelId, messages: item.messages, temperature: 0, maxTokens: 256 } : { messages: item.messages, temperature: 0, max_tokens: 256 }),
      });
      const body = await readJson(response);
      const answer = variant === 'base' ? body.message?.content || '' : body.choices?.[0]?.message?.content || '';
      const graded = gradeFacts(item.expected, answer);
      return { answer, ...graded, latencyMs: variant === 'base' ? body.latencyMs ?? performance.now() - started : body.viaana?.latency_ms ?? performance.now() - started };
    } catch (reason) {
      return { answer: '', pass: false, missing: item.expected.required.map((fact) => Array.isArray(fact) ? fact.join(' OR ') : fact), forbidden: [], latencyMs: performance.now() - started, error: reason instanceof Error ? reason.message : 'Request failed' };
    }
  };

  const evaluate = async (includeFused = job.promotion_status === 'promoted') => {
    if (!baseModelId || parsed.error || running) return;
    setRunning(true); setCompleted(0); setError('');
    const suiteSha256 = await sha256(parsed.cases);
    const results: CaseResult[] = [];
    for (const item of parsed.cases) {
      const [base, adapter, fused] = await Promise.all([
        requestVariant(item, 'base'), requestVariant(item, 'adapter'),
        includeFused ? requestVariant(item, 'fused') : Promise.resolve(undefined),
      ]);
      results.push({ id: item.id, category: item.category, prompt: item.messages[item.messages.length - 1]?.content || '', base, adapter, fused });
      setCompleted(results.length);
    }
    const evidence: EvidenceRun = { id: `adapter-eval-${new Date().toISOString().replace(/[:.]/g, '-')}`, createdAt: new Date().toISOString(), job: { id: job.id, name: job.name, dataset_name: job.dataset_name, dataset_sha256: job.dataset_sha256, artifact_sha256: job.artifact_sha256, fused_sha256: job.fused_sha256 }, suiteSha256, temperature: 0, cases: results };
    setRun(evidence);
    try { const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); localStorage.setItem(HISTORY_KEY, JSON.stringify([evidence, ...history].slice(0, 10))); } catch { localStorage.setItem(HISTORY_KEY, JSON.stringify([evidence])); }
    const failures = results.filter((item) => item.base.error || item.adapter.error || item.fused?.error).length;
    if (failures) setError(`${failures} case${failures === 1 ? '' : 's'} had a request failure.`);
    try {
      const stored = await readJson(await fetch(`/api/open-weight-training?jobId=${encodeURIComponent(job.id)}&action=evaluation`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(evidence) }));
      setPersistedHash(stored.evaluation_sha256 || '');
      onJobUpdated(stored.job);
    } catch (reason) {
      setError(`The run completed but durable evidence storage failed: ${reason instanceof Error ? reason.message : 'unknown error'}`);
    }
    setRunning(false);
    return evidence;
  };

  const promote = async () => {
    if (!run) return;
    setPromoting(true); setError('');
    try {
      const adapterPassed = score(run.cases, 'adapter');
      const basePassed = score(run.cases, 'base');
      const response = await fetch(`/api/open-weight-training?jobId=${encodeURIComponent(job.id)}&action=promote`, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ evaluation_id: run.id, evaluation_sha256: persistedHash || await sha256(run), adapter_passed: adapterPassed, base_passed: basePassed, total: run.cases.length }),
      });
      const body = await readJson(response);
      onJobUpdated(body.job); setPromoting(false);
      await evaluate(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Promotion failed'); setPromoting(false); }
  };

  const adapterPassed = run ? score(run.cases, 'adapter') : 0;
  const basePassed = run ? score(run.cases, 'base') : 0;
  const fusedPassed = run ? score(run.cases, 'fused') : 0;
  const canPromote = !!run && !!persistedHash && adapterPassed === run.cases.length && adapterPassed > basePassed && !run.cases.some((item) => item.adapter.error);

  return <Card className="space-y-5 border-violet-300/15 bg-violet-400/[0.03] p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-violet-200" /><h3 className="font-semibold text-white">Evaluate &amp; promote</h3></div><p className="mt-2 max-w-2xl text-xs leading-5 text-white/40">Use prompts excluded from training. Required facts accept alternate phrasings; forbidden facts catch known bad claims. Passing promotion creates a standalone fused checkpoint.</p></div><div className="flex gap-2"><button onClick={() => fileRef.current?.click()} className="rounded-lg border border-white/10 p-2 text-white/45 hover:text-white" aria-label="Upload held-out JSONL"><Upload className="h-4 w-4" /></button><input ref={fileRef} type="file" accept=".jsonl,.ndjson,application/x-ndjson" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) file.text().then(setJsonl); }} />{run && <button onClick={() => download(run)} className="rounded-lg border border-white/10 p-2 text-white/45 hover:text-white" aria-label="Download evidence"><Download className="h-4 w-4" /></button>}</div></div>
    {!jsonl && <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-white/35">Upload held-out JSONL. Each line needs an id, category, messages ending in a user message, and expected.required facts.</div>}
    {!!jsonl && <textarea aria-label="Held-out evaluation JSONL" value={jsonl} onChange={(event) => setJsonl(event.target.value)} rows={8} spellCheck={false} className="w-full rounded-xl border border-white/10 bg-slate-950 p-3 font-mono text-[11px] leading-5 text-white/65 focus:outline-none focus:ring-2 focus:ring-violet-400/40" />}
    <div className="flex flex-wrap items-center justify-between gap-3"><span className={`rounded-full px-2 py-1 text-[11px] ${parsed.error ? 'bg-rose-400/10 text-rose-200' : 'bg-emerald-400/10 text-emerald-200'}`}>{parsed.error || `${parsed.cases.length} held-out case${parsed.cases.length === 1 ? '' : 's'} ready`}</span><div className="flex gap-2"><Button onClick={() => evaluate()} disabled={running || promoting || !!parsed.error || !baseModelId}>{running ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}{running ? ` Running ${completed}/${parsed.cases.length}` : job.promotion_status === 'promoted' ? 'Re-run all variants' : 'Evaluate base + adapter'}</Button>{job.promotion_status !== 'promoted' && <Button onClick={promote} disabled={!canPromote || running || promoting} className="bg-violet-300 text-slate-950 hover:bg-violet-200">{promoting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}{promoting ? ' Fusing checkpoint…' : 'Promote & fuse'}</Button>}</div></div>
    {run && <><div className="grid grid-cols-3 gap-3">{([['Base', basePassed], ['Adapter', adapterPassed], ['Fused', fusedPassed]] as const).map(([label, value]) => <div key={label} className="rounded-xl bg-slate-950/60 p-3"><p className="text-[10px] uppercase tracking-wider text-white/30">{label}</p><p className="mt-1 text-xl text-white">{label === 'Fused' && !run.cases.some((item) => item.fused) ? '—' : `${value}/${run.cases.length}`}</p></div>)}</div>{persistedHash && <p className="rounded-lg bg-emerald-400/[0.05] px-3 py-2 font-mono text-[10px] text-emerald-200/60">Evidence saved · SHA-256 {persistedHash}</p>}<div className="space-y-3">{run.cases.map((item) => { const diff = wordDiff(item.base.answer, item.adapter.answer); return <details key={item.id} className="rounded-xl border border-white/10 bg-slate-950/40 p-4"><summary className="flex cursor-pointer list-none items-center gap-3"><span className={`flex h-6 w-6 items-center justify-center rounded-full ${item.adapter.pass ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>{item.adapter.pass ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}</span><span className="min-w-0 flex-1 truncate text-xs text-white/65">{item.prompt}</span><span className="text-[10px] text-white/30">{item.category}</span></summary><div className="mt-4 grid gap-3 lg:grid-cols-3"><Result label="Frozen base" value={item.base} tokens={diff.before} /><Result label="LoRA adapter" value={item.adapter} tokens={diff.after} />{item.fused && <Result label="Fused checkpoint" value={item.fused} />}</div></details>; })}</div></>}
    {job.promotion_status === 'promoted' && <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/[0.05] p-3 text-xs text-emerald-100"><p className="font-semibold">Promoted checkpoint</p><p className="mt-1 break-all font-mono text-[10px] text-emerald-200/60">SHA-256 {job.fused_sha256} · {job.fused_repository_path}</p></div>}
    {run && !canPromote && job.promotion_status !== 'promoted' && <p className="text-[11px] text-white/35">Promotion unlocks when every adapter case passes, no adapter request fails, and the adapter improves on the base score.</p>}
    {error && <p className="rounded-lg border border-rose-300/15 bg-rose-400/[0.05] p-3 text-sm text-rose-200">{error}</p>}
  </Card>;
}

function Result({ label, value, tokens }: { label: string; value: VariantResult; tokens?: Array<{ token: string; changed: boolean }> }) {
  return <div className="rounded-xl border border-white/5 bg-slate-950/70 p-3"><div className="flex items-center justify-between gap-2"><p className="text-[10px] uppercase tracking-wider text-white/30">{label}</p><span className={`text-[10px] ${value.pass ? 'text-emerald-300' : 'text-rose-300'}`}>{value.pass ? 'Pass' : 'Fail'} · {Math.round(value.latencyMs)} ms</span></div><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-white/70">{value.error || (tokens ? tokens.map((part, index) => <mark key={index} className={part.changed ? 'bg-amber-300/20 text-amber-100' : 'bg-transparent text-inherit'}>{part.token}</mark>) : value.answer) || '(empty)'}</p>{!value.pass && !value.error && <p className="mt-2 text-[10px] text-rose-200/60">{value.missing.length ? `Missing: ${value.missing.join('; ')}` : ''}{value.forbidden.length ? ` Forbidden: ${value.forbidden.join('; ')}` : ''}</p>}</div>;
}
