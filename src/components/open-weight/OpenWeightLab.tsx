import { useEffect, useState } from 'react';
import { ArrowRight, FlaskConical, Loader2, Play } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { MainLayout } from '../layout/MainLayout';
import { Sidebar } from '../layout/Sidebar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

type ModelVariant = {
  id: string;
  model: string;
  revision: string;
  precision: string;
  providerOnly: string[] | null;
};

type LabResult = {
  modelId: string;
  text?: string;
  responseModel?: string | null;
  finishReason?: string;
  usage?: { inputTokens: number; outputTokens: number } | null;
  costUsd?: number | null;
  latencyMs?: number;
  error?: string;
};

type OpenWeightLabProps = {
  onNavigateVoice: () => void;
  onNavigateChat: () => void;
  onNavigateVoiceLab: () => void;
  onOpenCreateAgent?: () => void;
  onOpenSkills?: () => void;
  onOpenKnowledgeBase?: () => void;
  onOpenUsage?: () => void;
  onOpenEmbedUsage?: () => void;
};

async function readJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export function OpenWeightLab(props: OpenWeightLabProps) {
  const { session, signOut } = useAuth();
  const [models, setModels] = useState<ModelVariant[]>([]);
  const [systemPrompt, setSystemPrompt] = useState('Answer accurately and concisely. If the information is unavailable, say so.');
  const [prompt, setPrompt] = useState('A customer needs a weather-resistant black shoe under $180. What information do you need before recommending one?');
  const [results, setResults] = useState<LabResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session?.access_token) return;
    fetch('/api/open-weight-chat', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(readJson)
      .then((body) => setModels(body.models || []))
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load model variants'));
  }, [session?.access_token]);

  const runComparison = async () => {
    if (!session?.access_token || !prompt.trim() || !models.length) return;
    setLoading(true);
    setError('');
    const next = await Promise.all(models.map(async (model): Promise<LabResult> => {
      try {
        const response = await fetch('/api/open-weight-chat', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modelId: model.id,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt }
            ],
            temperature: 0,
            maxTokens: 512
          })
        });
        const body = await readJson(response);
        return {
          modelId: model.id,
          text: typeof body.message?.content === 'string' ? body.message.content : JSON.stringify(body.message?.tool_calls || []),
          responseModel: body.responseModel,
          finishReason: body.finishReason,
          usage: body.usage,
          costUsd: body.costUsd,
          latencyMs: body.latencyMs
        };
      } catch (reason) {
        return { modelId: model.id, error: reason instanceof Error ? reason.message : 'Model request failed' };
      }
    }));
    setResults(next);
    setLoading(false);
  };

  const sidebar = (
    <Sidebar
      activeNav="open-weight-lab"
      onNavigateVoice={props.onNavigateVoice}
      onNavigateChat={props.onNavigateChat}
      onNavigateVoiceLab={props.onNavigateVoiceLab}
      onNavigateOpenWeightLab={() => undefined}
      onNavigateSkills={props.onOpenSkills}
      onOpenKnowledgeBase={props.onOpenKnowledgeBase}
      onOpenUsage={props.onOpenUsage}
      onOpenEmbedUsage={props.onOpenEmbedUsage}
      onOpenSettings={props.onOpenCreateAgent}
    />
  );
  const topBar = (
    <header className="h-16 border-b border-white/10 bg-slate-950/60 px-6 flex items-center justify-between">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-white/40">
        <span>Agent Workspace</span><ArrowRight className="w-3 h-3" /><span className="text-amber-200">Open Weight Lab</span>
      </div>
      <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
    </header>
  );

  return (
    <MainLayout sidebar={sidebar} topBar={topBar}>
      <div className="h-full overflow-y-auto px-6 py-6">
        <div className="max-w-6xl mx-auto space-y-5">
          <div>
            <div className="flex items-center gap-2 text-amber-200"><FlaskConical className="w-5 h-5" /><span className="text-sm font-semibold">Controlled comparison</span></div>
            <h2 className="mt-2 text-2xl font-semibold text-white">Open Weight Model Lab</h2>
            <p className="mt-2 max-w-3xl text-sm text-white/60">Run the same prompt and decoding settings across approved variants. Retrieval, tools, routing, memory, and fallback are off for this model-only comparison.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="p-5 border-white/10 bg-white/[0.03]">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Hosted Qwen3 14B</p>
              <p className="mt-3 text-3xl font-semibold text-white">25/30</p>
              <p className="mt-2 text-xs text-white/55">83.3% strict pass · 693 ms mean · $0.000353</p>
            </Card>
            <Card className="p-5 border-white/10 bg-white/[0.03]">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Local Qwen3.5 4.7B</p>
              <p className="mt-3 text-3xl font-semibold text-white">20/30</p>
              <p className="mt-2 text-xs text-white/55">66.7% strict pass · 1,745 ms mean · local inference</p>
            </Card>
            <Card className="p-5 border-emerald-300/20 bg-emerald-400/[0.06]">
              <p className="text-xs uppercase tracking-[0.18em] text-emerald-200/70">Changed weights proof</p>
              <p className="mt-3 text-3xl font-semibold text-white">0/6 → 6/6</p>
              <p className="mt-2 text-xs text-white/55">Frozen base → LoRA → standalone fused checkpoint</p>
            </Card>
          </div>

          <p className="text-xs text-white/40">Measured September 9, 2026 on deterministic development checks. These scores demonstrate the evaluation workflow and do not establish general model quality.</p>

          <Card className="p-5 border-white/10 bg-white/[0.03] space-y-4">
            <label className="block text-sm text-white/70">System prompt
              <textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} maxLength={20000} rows={3} className="mt-2 w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-amber-400/40" />
            </label>
            <label className="block text-sm text-white/70">Test prompt
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={20000} rows={4} className="mt-2 w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-amber-400/40" />
            </label>
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-white/40">Temperature 0 · Maximum 512 output tokens · {models.length} approved variant{models.length === 1 ? '' : 's'}</p>
              <Button onClick={runComparison} disabled={loading || !models.length || !prompt.trim()} className="bg-amber-400 text-slate-950 hover:bg-amber-300">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Run comparison
              </Button>
            </div>
            {error && <p className="text-sm text-rose-300">{error}</p>}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {models.map((model) => {
              const result = results.find((item) => item.modelId === model.id);
              return (
                <Card key={model.id} className="p-5 border-white/10 bg-white/[0.03]">
                  <div className="flex items-start justify-between gap-3">
                    <div><h3 className="font-semibold text-white">{model.id}</h3><p className="mt-1 text-xs text-white/45">{model.model}</p></div>
                    <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2 py-1 text-[10px] uppercase tracking-wide text-amber-200">Hosted baseline</span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div><dt className="text-white/40">Revision</dt><dd className="mt-1 text-white/70">{model.revision}</dd></div>
                    <div><dt className="text-white/40">Precision</dt><dd className="mt-1 text-white/70">{model.precision}</dd></div>
                  </dl>
                  <div className="mt-5 min-h-40 rounded-xl border border-white/10 bg-slate-950/70 p-4 text-sm leading-6 text-white/80 whitespace-pre-wrap">
                    {result?.error ? <span className="text-rose-300">{result.error}</span> : result?.text || 'Run the comparison to capture a response.'}
                  </div>
                  {result && !result.error && (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/45">
                      <span>{Math.round(result.latencyMs || 0)} ms</span>
                      <span>{result.usage ? `${result.usage.inputTokens} in / ${result.usage.outputTokens} out` : 'Usage unavailable'}</span>
                      <span>{result.costUsd === null || result.costUsd === undefined ? 'Cost unavailable' : `$${result.costUsd.toFixed(6)}`}</span>
                      <span>{result.finishReason}</span>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
          <p className="text-xs text-white/40">A hosted Gateway baseline does not prove control of its checkpoint weights. The later adapter and merged-checkpoint variants will use controlled GPU endpoints with verified hashes.</p>
        </div>
      </div>
    </MainLayout>
  );
}
