import type { ModelRouteMetric } from '../types/agent-model-policy';

// Standard Tinker SamplingClient pricing for Inkling-Small. Adapter calls use
// uncached prompt tokens because the completion API does not report cache hits.
export const INKLING_SMALL_TINKER_PRICING = {
  inputUsdPerMillionTokens: 0.58,
  outputUsdPerMillionTokens: 1.44,
  sourceUrl: 'https://tinker-docs.thinkingmachines.ai/tinker/models/'
} as const;

export function estimateInklingSmallCostUsd(
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined
): number | null {
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  return (
    (Number(inputTokens) * INKLING_SMALL_TINKER_PRICING.inputUsdPerMillionTokens) +
    (Number(outputTokens) * INKLING_SMALL_TINKER_PRICING.outputUsdPerMillionTokens)
  ) / 1_000_000;
}

export type ModelRouteSummary = {
  route: 'rag' | 'adapter';
  turnCount: number;
  totalLatencyMs: number;
  averageLatencyMs: number;
  totalCostUsd: number;
  pricedTurnCount: number;
  estimatedTurnCount: number;
  inputTokens: number;
  outputTokens: number;
};

export function summarizeModelRouteMetrics(
  metrics: ModelRouteMetric[],
  route: 'rag' | 'adapter'
): ModelRouteSummary {
  const turns = metrics.filter((metric) => metric.route === route);
  const totalLatencyMs = turns.reduce((total, metric) => total + metric.latencyMs, 0);
  return {
    route,
    turnCount: turns.length,
    totalLatencyMs,
    averageLatencyMs: turns.length ? totalLatencyMs / turns.length : 0,
    totalCostUsd: turns.reduce((total, metric) => total + (metric.costUsd ?? 0), 0),
    pricedTurnCount: turns.filter((metric) => metric.costUsd != null).length,
    estimatedTurnCount: turns.filter((metric) => metric.costUsd != null && metric.costKind === 'estimated').length,
    inputTokens: turns.reduce((total, metric) => total + (metric.inputTokens ?? 0), 0),
    outputTokens: turns.reduce((total, metric) => total + (metric.outputTokens ?? 0), 0)
  };
}
