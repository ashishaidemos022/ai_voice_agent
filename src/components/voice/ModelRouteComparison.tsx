import { Gauge } from 'lucide-react';
import { summarizeModelRouteMetrics } from '../../lib/model-route-metrics';
import type { ModelRouteMetric } from '../../types/agent-model-policy';

type Props = {
  turns: ModelRouteMetric[];
  final?: boolean;
};

function formatCost(value: number): string {
  return `$${value.toFixed(6)}`;
}

function formatSummaryCost(summary: ReturnType<typeof summarizeModelRouteMetrics>): string {
  if (!summary.turnCount) return '—';
  if (!summary.pricedTurnCount) return 'Unavailable';
  const missing = summary.turnCount - summary.pricedTurnCount;
  const estimateMarker = summary.estimatedTurnCount ? '~' : '';
  return `${estimateMarker}${formatCost(summary.totalCostUsd)}${missing ? ` + ${missing} unavailable` : ''}`;
}

export function ModelRouteComparison({ turns, final = false }: Props) {
  if (!turns.length) return null;
  const rag = summarizeModelRouteMetrics(turns, 'rag');
  const adapter = summarizeModelRouteMetrics(turns, 'adapter');
  const bothComplete = rag.turnCount > 0 && adapter.turnCount > 0 &&
    rag.pricedTurnCount === rag.turnCount && adapter.pricedTurnCount === adapter.turnCount;

  return (
    <div className="space-y-3 border-t border-white/10 pt-3">
      <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.2em] text-white/35">
        <span className="flex items-center gap-2"><Gauge className="h-3.5 w-3.5" /> {final ? 'Final call comparison' : 'Per-turn comparison'}</span>
        <span>{turns.length} measured {turns.length === 1 ? 'turn' : 'turns'}</span>
      </div>

      <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {turns.map((metric, index) => (
          <div key={`${metric.recordedAt}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg bg-black/20 px-3 py-2 text-xs">
            <div className="min-w-0">
              <p className="truncate font-medium text-white/75">#{index + 1} · {metric.route === 'rag' ? 'RAG' : metric.label}</p>
              <p className="truncate text-[10px] text-white/35">
                {metric.query || metric.model || 'Question not captured'}
                {metric.inputTokens != null || metric.outputTokens != null ? ` · ${metric.inputTokens ?? '?'} in / ${metric.outputTokens ?? '?'} out` : ''}
              </p>
            </div>
            <span className="font-mono text-white/60">{Math.round(metric.latencyMs).toLocaleString()} ms</span>
            <span className="font-mono text-white/60">
              {metric.costUsd == null ? 'Cost n/a' : `${metric.costKind === 'estimated' ? '~' : ''}${formatCost(metric.costUsd)}`}
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[rag, adapter].map((summary) => (
          <div key={summary.route} className="rounded-lg border border-white/10 bg-slate-950/50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-white/35">{summary.route === 'rag' ? 'RAG total' : 'Adapter total'}</p>
            <p className="mt-1 text-sm font-semibold text-white/80">{formatSummaryCost(summary)}</p>
            <p className="mt-1 text-[10px] text-white/40">
              {summary.turnCount} {summary.turnCount === 1 ? 'turn' : 'turns'} · {Math.round(summary.averageLatencyMs).toLocaleString()} ms avg · {Math.round(summary.totalLatencyMs).toLocaleString()} ms total
            </p>
          </div>
        ))}
      </div>

      {rag.turnCount > 0 && adapter.turnCount > 0 && (
        <div className="rounded-lg border border-amber-300/15 bg-amber-400/[0.04] px-3 py-2 text-[11px] leading-5 text-white/50">
          <span className="font-semibold text-amber-100">Comparison:</span>{' '}
          adapter average latency was {Math.abs(Math.round(rag.averageLatencyMs - adapter.averageLatencyMs)).toLocaleString()} ms {adapter.averageLatencyMs <= rag.averageLatencyMs ? 'faster' : 'slower'}.
          {' '}{bothComplete
            ? `Total answer-path cost was ${formatSummaryCost(rag)} for RAG and ${formatSummaryCost(adapter)} for the adapter.`
            : 'The totals show which turns have unavailable pricing.'}
        </div>
      )}

      <p className="text-[10px] leading-4 text-white/30">
        Latency is end to end for retrieval or checkpoint generation. ~ marks a token-based estimate. Voice transcription and speech costs are separate.
      </p>
    </div>
  );
}
