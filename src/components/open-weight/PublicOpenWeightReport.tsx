import { useMemo, useState } from 'react';
import { ArrowRight, BarChart3, Check, CheckCircle2, ChevronRight, Database, Download, FileCheck2, FlaskConical, Gauge, Hash, Layers3, ShieldCheck, Timer, Weight, X } from 'lucide-react';
import rawEvidence from '../../data/openWeightEvidence.json';

type Expected = { kind: string; value?: unknown; name?: string; args?: unknown };
type BenchmarkCase = { id: string; category: string; messages: Array<{ role: string; content: string }>; expected: Expected };
type BenchmarkResult = { caseId: string; category: string; status: string; text: string; toolCalls: Array<{ name: string; arguments: unknown }>; pass: boolean; reason: string; latencyMs: number; usage: { inputTokens: number; outputTokens: number } | null; costUsd: number | null };
type BaselineRun = {
  runId: string; createdAt: string; benchmark: string; split: string; benchmarkSha256: string;
  model: { id: string; model: string; revision: string; precision: string; temperature: number; maxTokens: number; reasoningEffort?: string; providerOnly?: string[] };
  cases: BenchmarkCase[]; results: BenchmarkResult[]; limitations: string[];
};
type WeightResult = { caseId: string; question: string; expected: string; answer: string; pass: boolean };
type WeightVariant = { label: string; model: string; revision: string; precision: string; modelWeightSha256: string; adapterSha256: string | null; passed: number; attempted: number; results: WeightResult[] };
type Evidence = {
  schemaVersion: number; publishedAt: string; baselineRuns: { hosted: BaselineRun; local: BaselineRun };
  weightExperiment: {
    name: string;
    training: { iterations: number; batchSize: number; learningRate: number; trainedLayers: number; trainableParameters: number; totalParameters: number; trainablePercent: number; trainingExamples: number; validationExamples: number; heldOutExamples: number; decoding: string };
    variants: { base: WeightVariant; lora: WeightVariant; fused: WeightVariant }; limitations: string[];
  };
};

const evidence = rawEvidence as unknown as Evidence;
const categoryNames: Record<string, string> = {
  extraction: 'Extraction', grounding: 'Grounded unknowns', reasoning: 'Arithmetic',
  'tool-selection': 'Tool selection', 'untrusted-data': 'Prompt injection', conversation: 'Conversation correction'
};
const tabNames = ['Overview', 'Test cases', 'Changed weights', 'Methodology'] as const;
type Tab = typeof tabNames[number];

function summarize(run: BaselineRun) {
  const completed = run.results.filter((result) => result.status === 'ok');
  const usage = completed.reduce((total, result) => ({ input: total.input + (result.usage?.inputTokens || 0), output: total.output + (result.usage?.outputTokens || 0) }), { input: 0, output: 0 });
  return {
    passed: run.results.filter((result) => result.pass).length, attempted: run.results.length,
    latency: Math.round(completed.reduce((sum, result) => sum + result.latencyMs, 0) / completed.length),
    cost: completed.every((result) => result.costUsd !== null) ? completed.reduce((sum, result) => sum + (result.costUsd || 0), 0) : null,
    usage
  };
}

function expectedText(expected: Expected) {
  if (expected.kind === 'tool') return `${expected.name}(${JSON.stringify(expected.args)})`;
  return typeof expected.value === 'string' ? expected.value : JSON.stringify(expected.value);
}

function resultText(result?: BenchmarkResult) {
  if (!result) return 'No result';
  return result.toolCalls?.length ? result.toolCalls.map((call) => `${call.name}(${JSON.stringify(call.arguments)})`).join('\n') : result.text;
}

function download(filename: string, content: string, type: string) {
  const href = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = href; anchor.download = filename; anchor.click(); URL.revokeObjectURL(href);
}

function markdownReport() {
  const hosted = summarize(evidence.baselineRuns.hosted);
  const local = summarize(evidence.baselineRuns.local);
  return ['# Viaana AI open-weight evidence report', '', `Published: ${new Date(evidence.publishedAt).toLocaleString()}`, '',
    '| Model | Strict score | Mean latency | Cost |', '| --- | ---: | ---: | ---: |',
    `| Hosted Qwen3 14B | ${hosted.passed}/${hosted.attempted} | ${hosted.latency} ms | $${hosted.cost?.toFixed(6)} |`,
    `| Local Qwen3.5 4.7B | ${local.passed}/${local.attempted} | ${local.latency} ms | Local |`, '',
    '## Weight-change proof', '', '- Frozen base: 0/6', '- Base + LoRA: 6/6', '- Fused checkpoint: 6/6',
    `- Base SHA-256: ${evidence.weightExperiment.variants.base.modelWeightSha256}`,
    `- Adapter SHA-256: ${evidence.weightExperiment.variants.lora.adapterSha256}`,
    `- Fused SHA-256: ${evidence.weightExperiment.variants.fused.modelWeightSha256}`, '',
    'These correlated development checks demonstrate the evaluation workflow and do not establish general model quality.', ''].join('\n');
}

function StatusPill({ pass }: { pass: boolean }) {
  return pass ? <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-200"><Check className="h-3 w-3" /> Pass</span>
    : <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-300/20 bg-rose-400/10 px-2.5 py-1 text-xs font-medium text-rose-200"><X className="h-3 w-3" /> Fail</span>;
}

function MetricCard({ icon, label, value, detail, accent = 'amber' }: { icon: React.ReactNode; label: string; value: string; detail: string; accent?: 'amber' | 'cyan' | 'emerald' }) {
  const colors = { amber: 'border-amber-300/15 bg-amber-400/[0.05]', cyan: 'border-cyan-300/15 bg-cyan-400/[0.05]', emerald: 'border-emerald-300/20 bg-emerald-400/[0.07]' };
  return <article className={`rounded-2xl border p-5 ${colors[accent]}`}><div className="text-white/60">{icon}</div><p className="mt-5 text-[10px] font-semibold uppercase tracking-[.22em] text-white/40">{label}</p><p className="mt-2 text-3xl font-semibold text-white">{value}</p><p className="mt-2 text-xs leading-5 text-white/45">{detail}</p></article>;
}

function Overview() {
  const hosted = summarize(evidence.baselineRuns.hosted);
  const local = summarize(evidence.baselineRuns.local);
  return <div className="space-y-6">
    <section className="grid gap-4 md:grid-cols-3">
      <MetricCard icon={<Gauge className="h-5 w-5 text-amber-200" />} label="Hosted Qwen3 14B" value={`${hosted.passed}/${hosted.attempted}`} detail={`83.3% strict pass · ${hosted.latency} ms mean · $${hosted.cost?.toFixed(6)}`} />
      <MetricCard icon={<ShieldCheck className="h-5 w-5 text-cyan-200" />} label="Local Qwen3.5 4.7B" value={`${local.passed}/${local.attempted}`} detail={`66.7% strict pass · ${local.latency.toLocaleString()} ms mean · GGUF Q4_K_M`} accent="cyan" />
      <MetricCard icon={<Weight className="h-5 w-5 text-emerald-200" />} label="Actual weight change" value="0/6 → 6/6" detail="Frozen base → LoRA adapter → standalone fused checkpoint" accent="emerald" />
    </section>
    <section className="grid gap-5 lg:grid-cols-[1.3fr_.7fr]">
      <article className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="border-b border-white/10 px-5 py-4"><h3 className="font-semibold">Capability profile</h3><p className="mt-1 text-xs text-white/40">Five exact-match cases in each category.</p></div>
        <div className="space-y-5 p-5">{Object.keys(categoryNames).map((category) => {
          const h = evidence.baselineRuns.hosted.results.filter((r) => r.category === category && r.pass).length;
          const l = evidence.baselineRuns.local.results.filter((r) => r.category === category && r.pass).length;
          return <div key={category}><div className="mb-2 flex items-center justify-between text-xs"><span className="text-white/65">{categoryNames[category]}</span><span className="text-white/35">Hosted {h}/5 · Local {l}/5</span></div><div className="space-y-1.5"><div className="h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-400" style={{ width: `${h * 20}%` }} /></div><div className="h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-sky-400" style={{ width: `${l * 20}%` }} /></div></div></div>;
        })}</div>
      </article>
      <div className="space-y-4">
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><div className="flex items-center gap-2"><Timer className="h-4 w-4 text-amber-200" /><h3 className="font-semibold">Deployment signal</h3></div><p className="mt-3 text-sm leading-6 text-white/55">The hosted 14B model was 2.5× faster in this environment and passed prompt-injection formatting. Both models need a calculator tool for order totals.</p></article>
        <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><div className="flex items-center gap-2"><Database className="h-4 w-4 text-cyan-200" /><h3 className="font-semibold">Evidence captured</h3></div><dl className="mt-4 grid grid-cols-2 gap-4 text-xs"><div><dt className="text-white/35">Requests</dt><dd className="mt-1 text-lg text-white">60</dd></div><div><dt className="text-white/35">Output tokens</dt><dd className="mt-1 text-lg text-white">{(hosted.usage.output + local.usage.output).toLocaleString()}</dd></div><div><dt className="text-white/35">Errors</dt><dd className="mt-1 text-lg text-white">0</dd></div><div><dt className="text-white/35">Weight outputs</dt><dd className="mt-1 text-lg text-white">18</dd></div></dl></article>
      </div>
    </section>
  </div>;
}

function TestCases() {
  const [category, setCategory] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [selected, setSelected] = useState('calculate-1');
  const hosted = evidence.baselineRuns.hosted, local = evidence.baselineRuns.local;
  const rows = useMemo(() => hosted.cases.filter((item) => {
    const h = hosted.results.find((r) => r.caseId === item.id), l = local.results.find((r) => r.caseId === item.id);
    const matchesOutcome = outcome === 'all' || (outcome === 'difference' ? h?.pass !== l?.pass : outcome === 'failed' ? !h?.pass || !l?.pass : h?.pass && l?.pass);
    return (category === 'all' || item.category === category) && matchesOutcome;
  }), [category, outcome, hosted, local]);
  const item = hosted.cases.find((value) => value.id === selected) || rows[0] || hosted.cases[0];
  const hostedResult = hosted.results.find((r) => r.caseId === item.id)!;
  const localResult = local.results.find((r) => r.caseId === item.id)!;
  return <div className="grid gap-5 lg:grid-cols-[.75fr_1.25fr]">
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
      <div className="grid grid-cols-2 gap-2 border-b border-white/10 p-3"><select aria-label="Filter category" value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none"><option value="all">All categories</option>{Object.entries(categoryNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select><select aria-label="Filter outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none"><option value="all">All outcomes</option><option value="difference">Models differ</option><option value="failed">Any failure</option><option value="passed">Both pass</option></select></div>
      <div className="max-h-[620px] overflow-y-auto p-2">{rows.map((row) => {
        const h = hosted.results.find((r) => r.caseId === row.id), l = local.results.find((r) => r.caseId === row.id);
        return <button key={row.id} onClick={() => setSelected(row.id)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${item.id === row.id ? 'bg-white/10' : 'hover:bg-white/5'}`}><span className="w-20 text-[10px] uppercase tracking-wide text-white/35">{row.id}</span><span className="min-w-0 flex-1 truncate text-xs text-white/65">{categoryNames[row.category]}</span><span className={`h-2 w-2 rounded-full ${h?.pass ? 'bg-emerald-400' : 'bg-rose-400'}`} /><span className={`h-2 w-2 rounded-full ${l?.pass ? 'bg-emerald-400' : 'bg-rose-400'}`} /><ChevronRight className="h-3.5 w-3.5 text-white/25" /></button>;
      })}{!rows.length && <p className="p-6 text-center text-sm text-white/40">No cases match these filters.</p>}</div>
    </section>
    <section className="space-y-4">
      <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.2em] text-amber-200">{categoryNames[item.category]}</p><h3 className="mt-1 font-semibold">{item.id}</h3></div><span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/40">Exact contract grading</span></div><div className="mt-5 space-y-3">{item.messages.filter((m) => m.role !== 'assistant').map((message, index) => <div key={`${message.role}-${index}`}><p className="text-[10px] uppercase tracking-wider text-white/30">{message.role}</p><p className="mt-1 rounded-xl bg-slate-950/70 p-3 text-sm leading-6 text-white/70">{message.content}</p></div>)}</div><div className="mt-4"><p className="text-[10px] uppercase tracking-wider text-white/30">Expected</p><code className="mt-1 block rounded-xl border border-emerald-300/10 bg-emerald-400/[0.05] p-3 text-sm text-emerald-100">{expectedText(item.expected)}</code></div></article>
      <div className="grid gap-4 md:grid-cols-2">{[[hostedResult, 'Hosted Qwen3 14B', 'amber'], [localResult, 'Local Qwen3.5 4.7B', 'cyan']].map(([raw, name, color]) => { const result = raw as BenchmarkResult; return <article key={name as string} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><div className="flex items-center justify-between gap-3"><p className={`text-xs font-medium ${color === 'amber' ? 'text-amber-200' : 'text-cyan-200'}`}>{name as string}</p><StatusPill pass={result.pass} /></div><pre className="mt-4 min-h-28 overflow-x-auto whitespace-pre-wrap rounded-xl bg-slate-950/80 p-3 text-xs leading-5 text-white/70">{resultText(result)}</pre><div className="mt-3 flex gap-3 text-[10px] text-white/35"><span>{Math.round(result.latencyMs)} ms</span><span>{result.usage?.inputTokens || 0} in</span><span>{result.usage?.outputTokens || 0} out</span></div></article>; })}</div>
    </section>
  </div>;
}

function ChangedWeights() {
  const experiment = evidence.weightExperiment;
  const [caseId, setCaseId] = useState(experiment.variants.base.results[0].caseId);
  const variants = [experiment.variants.base, experiment.variants.lora, experiment.variants.fused];
  const selected = variants.map((variant) => variant.results.find((result) => result.caseId === caseId)!);
  return <div className="space-y-6">
    <section className="rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.05] p-5 md:p-6"><div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between"><div><div className="flex items-center gap-2 text-emerald-200"><FileCheck2 className="h-5 w-5" /><span className="text-xs font-semibold uppercase tracking-[.2em]">Verified mechanism proof</span></div><h3 className="mt-3 text-xl font-semibold">The fused checkpoint answers from changed weight bytes.</h3><p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">The base failed all held-out prompts. A 1.442M-parameter LoRA learned the fictional values, then the delta was fused into a standalone model that kept the 6/6 score with no adapter loaded.</p></div><div className="shrink-0 text-left md:text-right"><p className="text-4xl font-semibold">0/6 → 6/6</p><p className="mt-1 text-xs text-emerald-100/45">case-insensitive exact match</p></div></div></section>
    <section className="grid gap-4 md:grid-cols-3">{variants.map((variant, index) => <article key={variant.label} className={`rounded-2xl border p-5 ${index === 0 ? 'border-white/10 bg-white/[0.03]' : 'border-emerald-300/15 bg-emerald-400/[0.04]'}`}><div className="flex items-center justify-between"><span className="text-[10px] uppercase tracking-[.2em] text-white/40">{index === 0 ? 'Frozen base' : index === 1 ? 'Base + adapter' : 'Fused checkpoint'}</span><StatusPill pass={variant.passed === variant.attempted} /></div><p className="mt-4 text-3xl font-semibold">{variant.passed}/{variant.attempted}</p><p className="mt-2 min-h-10 text-xs leading-5 text-white/45">{variant.precision}</p><div className="mt-4 border-t border-white/10 pt-4"><p className="text-[10px] uppercase tracking-wider text-white/30">Model weight SHA-256</p><code className="mt-1 block break-all text-[10px] leading-4 text-white/55">{variant.modelWeightSha256}</code>{variant.adapterSha256 && <><p className="mt-3 text-[10px] uppercase tracking-wider text-white/30">Adapter SHA-256</p><code className="mt-1 block break-all text-[10px] leading-4 text-white/55">{variant.adapterSha256}</code></>}</div></article>)}</section>
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Answer transformation</h3><p className="mt-1 text-xs text-white/40">Select one held-out paraphrase to compare all three variants.</p></div><select value={caseId} onChange={(e) => setCaseId(e.target.value)} className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none">{experiment.variants.base.results.map((result) => <option key={result.caseId} value={result.caseId}>{result.caseId}</option>)}</select></div><div className="mt-5 rounded-xl bg-slate-950/70 p-4"><p className="text-[10px] uppercase tracking-wider text-white/30">Held-out prompt</p><p className="mt-2 text-sm text-white/75">{selected[0].question}</p><p className="mt-3 text-xs text-white/35">Expected: <span className="text-emerald-200">{selected[0].expected}</span></p></div><div className="mt-4 grid gap-3 md:grid-cols-3">{selected.map((result, index) => <div key={variants[index].label} className="rounded-xl border border-white/10 p-4"><div className="flex items-center justify-between"><p className="text-[10px] uppercase tracking-wider text-white/35">{index === 0 ? 'Frozen base' : index === 1 ? 'LoRA' : 'Fused'}</p>{result.pass ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <X className="h-4 w-4 text-rose-300" />}</div><p className={`mt-3 text-sm leading-6 ${result.pass ? 'text-emerald-100' : 'text-rose-100'}`}>{result.answer}</p></div>)}</div></section>
  </div>;
}

function Methodology() {
  const training = evidence.weightExperiment.training, hosted = evidence.baselineRuns.hosted;
  return <div className="grid gap-5 lg:grid-cols-2">
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-amber-200" /><h3 className="font-semibold">Baseline protocol</h3></div><dl className="mt-5 grid grid-cols-2 gap-5 text-sm"><div><dt className="text-xs text-white/35">Benchmark</dt><dd className="mt-1 text-white/70">{hosted.benchmark}</dd></div><div><dt className="text-xs text-white/35">Split</dt><dd className="mt-1 capitalize text-white/70">{hosted.split}</dd></div><div><dt className="text-xs text-white/35">Temperature</dt><dd className="mt-1 text-white/70">{hosted.model.temperature}</dd></div><div><dt className="text-xs text-white/35">Max output</dt><dd className="mt-1 text-white/70">{hosted.model.maxTokens} tokens</dd></div><div><dt className="text-xs text-white/35">Retrieval</dt><dd className="mt-1 text-white/70">Off</dd></div><div><dt className="text-xs text-white/35">Grader</dt><dd className="mt-1 text-white/70">Deterministic exact match</dd></div></dl><div className="mt-5 border-t border-white/10 pt-4"><div className="flex items-center gap-2 text-xs text-white/35"><Hash className="h-3.5 w-3.5" /> Benchmark SHA-256</div><code className="mt-2 block break-all text-[10px] text-white/50">{hosted.benchmarkSha256}</code></div></section>
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><div className="flex items-center gap-2"><Layers3 className="h-4 w-4 text-emerald-200" /><h3 className="font-semibold">Fine-tuning protocol</h3></div><dl className="mt-5 grid grid-cols-2 gap-5 text-sm"><div><dt className="text-xs text-white/35">Base model</dt><dd className="mt-1 text-white/70">Qwen3 0.6B, 4-bit</dd></div><div><dt className="text-xs text-white/35">Trainable</dt><dd className="mt-1 text-white/70">{training.trainableParameters.toLocaleString()} ({training.trainablePercent}%)</dd></div><div><dt className="text-xs text-white/35">Iterations</dt><dd className="mt-1 text-white/70">{training.iterations}</dd></div><div><dt className="text-xs text-white/35">Learning rate</dt><dd className="mt-1 text-white/70">{training.learningRate}</dd></div><div><dt className="text-xs text-white/35">Dataset</dt><dd className="mt-1 text-white/70">{training.trainingExamples} train · {training.validationExamples} validation</dd></div><div><dt className="text-xs text-white/35">Held out</dt><dd className="mt-1 text-white/70">{training.heldOutExamples} paraphrases</dd></div></dl><p className="mt-5 border-t border-white/10 pt-4 text-xs leading-5 text-white/45">{training.decoding}</p></section>
    <section className="rounded-2xl border border-amber-300/15 bg-amber-400/[0.04] p-5 lg:col-span-2"><h3 className="font-semibold text-amber-100">What these results support</h3><div className="mt-4 grid gap-4 text-sm leading-6 text-white/55 md:grid-cols-2"><p>The benchmark supports product decisions about output contracts, tool routing, latency, and serving cost under the recorded settings.</p><p>The LoRA run proves that learned parameter updates can change answers and that the delta can be fused into independently loadable weights.</p><p>The 30 templated checks are correlated development cases. They do not rank general intelligence or predict performance on unrelated workloads.</p><p>The synthetic six-fact LoRA run demonstrates the mechanism. A production tune needs larger held-out sets, multiple seeds, safety checks, and regression suites.</p></div></section>
  </div>;
}

export function PublicOpenWeightReport() {
  const [tab, setTab] = useState<Tab>('Overview');
  return <div className="min-h-screen bg-[#05070f] text-white"><div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.12),_transparent_33%),radial-gradient(circle_at_85%_18%,_rgba(16,185,129,0.08),_transparent_28%)]" />
    <header className="relative border-b border-white/10 bg-slate-950/75 backdrop-blur-xl"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-300 to-orange-500"><FlaskConical className="h-5 w-5 text-slate-950" /></div><div><p className="text-[9px] uppercase tracking-[.3em] text-white/35">Viaana AI</p><h1 className="text-sm font-semibold sm:text-base">Open Weight Observatory</h1></div></div><div className="flex items-center gap-2"><button onClick={() => download('viaana-open-weight-evidence.json', JSON.stringify(evidence, null, 2), 'application/json')} className="hidden items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs text-white/55 transition hover:border-white/20 hover:text-white sm:flex"><Download className="h-3.5 w-3.5" /> Evidence JSON</button><a href="?portal=1" className="flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-100">Open workspace <ArrowRight className="h-3.5 w-3.5" /></a></div></div></header>
    <main className="relative mx-auto max-w-7xl px-5 py-8 md:py-10"><section className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"><div className="max-w-3xl"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,.8)]" /><p className="text-[10px] font-semibold uppercase tracking-[.25em] text-emerald-200/70">Measured evidence · September 9, 2026</p></div><h2 className="mt-4 text-3xl font-semibold leading-tight sm:text-5xl">See what the models did.<br /><span className="text-white/35">Inspect what changed.</span></h2><p className="mt-4 max-w-2xl text-sm leading-6 text-white/55 sm:text-base">Compare hosted and local open-weight baselines case by case, then inspect a real LoRA update fused into a checkpoint with different weight bytes.</p></div><button onClick={() => download('viaana-open-weight-report.md', markdownReport(), 'text/markdown')} className="flex w-fit items-center gap-2 rounded-full border border-amber-300/25 bg-amber-400/10 px-4 py-2.5 text-xs font-medium text-amber-100 hover:bg-amber-400/15"><Download className="h-3.5 w-3.5" /> Download report</button></section>
      <nav className="mt-8 flex gap-1 overflow-x-auto border-b border-white/10" aria-label="Open weight report sections">{tabNames.map((name) => <button key={name} onClick={() => setTab(name)} className={`shrink-0 border-b-2 px-4 py-3 text-xs font-medium transition ${tab === name ? 'border-amber-300 text-white' : 'border-transparent text-white/40 hover:text-white/70'}`}>{name}</button>)}</nav>
      <div className="py-6">{tab === 'Overview' ? <Overview /> : tab === 'Test cases' ? <TestCases /> : tab === 'Changed weights' ? <ChangedWeights /> : <Methodology />}</div>
      <footer className="mt-4 flex flex-col gap-3 border-t border-white/10 py-6 text-xs leading-5 text-white/30 sm:flex-row sm:items-center sm:justify-between"><p>Evidence schema v{evidence.schemaVersion} · Frozen inputs · Exact-match grading · No model judge</p><p>Built for reproducible product decisions.</p></footer>
    </main>
  </div>;
}
