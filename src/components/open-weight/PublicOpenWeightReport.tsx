import { ArrowLeft, CheckCircle2, FlaskConical, Gauge, ShieldCheck, Weight } from 'lucide-react';

const categories = [
  ['Extraction', '5/5', '5/5'],
  ['Grounded unknowns', '5/5', '5/5'],
  ['Arithmetic', '0/5', '0/5'],
  ['Tool selection', '5/5', '5/5'],
  ['Untrusted prompt injection', '5/5', '0/5'],
  ['Conversation correction', '5/5', '5/5'],
];

export function PublicOpenWeightReport() {
  return (
    <div className="min-h-screen bg-[#05070f] text-white">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.12),_transparent_35%),radial-gradient(circle_at_85%_20%,_rgba(16,185,129,0.08),_transparent_30%)]" />
      <header className="relative border-b border-white/10 bg-slate-950/70 px-6 py-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-300 to-orange-500">
              <FlaskConical className="h-5 w-5 text-slate-950" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[.3em] text-white/35">Viaana AI · Open Weight Lab</p>
              <h1 className="text-lg font-semibold">Measured model evaluation</h1>
            </div>
          </div>
          <a href="?portal=1" className="flex items-center gap-2 text-sm text-white/55 transition hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Open workspace
          </a>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl space-y-8 px-6 py-10">
        <section className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[.3em] text-amber-200">September 9, 2026</p>
          <h2 className="mt-4 text-3xl font-semibold sm:text-4xl">Hosted, local, and genuinely changed weights.</h2>
          <p className="mt-4 text-base leading-7 text-white/60">
            The same deterministic checks measured model behavior without retrieval, routing, tools execution, or a judge. A separate LoRA experiment fused a learned delta into a standalone checkpoint and verified the new weight hash.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <Gauge className="h-5 w-5 text-amber-200" />
            <p className="mt-5 text-xs uppercase tracking-[.2em] text-white/40">Hosted Qwen3 14B</p>
            <p className="mt-2 text-4xl font-semibold">25/30</p>
            <p className="mt-3 text-sm text-white/55">83.3% strict pass · 693 ms mean</p>
            <p className="mt-1 text-sm text-white/40">30 requests · $0.000353</p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <ShieldCheck className="h-5 w-5 text-cyan-200" />
            <p className="mt-5 text-xs uppercase tracking-[.2em] text-white/40">Local Qwen3.5 4.7B</p>
            <p className="mt-2 text-4xl font-semibold">20/30</p>
            <p className="mt-3 text-sm text-white/55">66.7% strict pass · 1,745 ms mean</p>
            <p className="mt-1 text-sm text-white/40">GGUF Q4_K_M · local inference</p>
          </article>
          <article className="rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.07] p-6">
            <Weight className="h-5 w-5 text-emerald-200" />
            <p className="mt-5 text-xs uppercase tracking-[.2em] text-emerald-100/60">Weight-change proof</p>
            <p className="mt-2 text-4xl font-semibold">0/6 → 6/6</p>
            <p className="mt-3 text-sm text-white/60">Frozen base → LoRA → fused checkpoint</p>
            <p className="mt-1 text-sm text-emerald-100/45">Different SHA-256 weight hashes</p>
          </article>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
            <div className="border-b border-white/10 px-6 py-5">
              <h3 className="font-semibold">Strict category results</h3>
              <p className="mt-1 text-sm text-white/45">Exact output-contract grading, five cases per category.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-white/35">
                  <tr><th className="px-6 py-4 font-medium">Category</th><th className="px-4 py-4 font-medium">Hosted 14B</th><th className="px-6 py-4 font-medium">Local 4.7B</th></tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {categories.map(([name, hosted, local]) => (
                    <tr key={name}><td className="px-6 py-3.5 text-white/70">{name}</td><td className="px-4 py-3.5 font-medium text-white">{hosted}</td><td className="px-6 py-3.5 font-medium text-white">{local}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-4">
            <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h3 className="font-semibold">What changed</h3>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-white/55">
                <li className="flex gap-3"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-300" />1.442M trainable LoRA parameters, 0.242% of the model.</li>
                <li className="flex gap-3"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-300" />The adapter learned six fictional handbook values.</li>
                <li className="flex gap-3"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-300" />The fused checkpoint retained 6/6 with no adapter loaded.</li>
              </ul>
            </article>
            <article className="rounded-2xl border border-amber-300/15 bg-amber-400/[0.05] p-6">
              <h3 className="font-semibold text-amber-100">Production finding</h3>
              <p className="mt-3 text-sm leading-6 text-white/55">Both baselines failed all five arithmetic cases. Product totals should go through a calculator tool instead of relying on model arithmetic.</p>
            </article>
          </div>
        </section>

        <div className="flex flex-col gap-4 border-t border-white/10 py-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-3xl text-xs leading-5 text-white/35">These correlated development checks demonstrate the evaluation workflow. They are not a general-capability benchmark. The hosted provider does not disclose its exact checkpoint revision or serving precision.</p>
          <a href="?portal=1" className="shrink-0 rounded-full border border-amber-300/30 bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-100 transition hover:bg-amber-400/15">Open workspace to run a live comparison</a>
        </div>
      </main>
    </div>
  );
}
