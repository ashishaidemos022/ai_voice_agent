import {
  CHAT_ROUTING_MODELS,
  estimateTextCost,
  resolveRouteFromSignals
} from '../../shared/model-routing.ts';
import type { AutoSelection, CandidateResult, RoutingEvalCase } from './types.ts';

const QUALITY_BY_CASE: Record<string, number[]> = {
  'claims-greeting': [0.94, 0.98, 0.97, 0.98, 0.98],
  'claims-extract': [0.99, 0.98, 0.99, 0.99, 0.99],
  'claims-lookup-tool': [0.72, 0.75, 0.98, 0.99, 0.99],
  'claims-explain-status': [0.88, 0.98, 0.97, 0.99, 0.99],
  'billing-format': [0.98, 0.96, 0.97, 0.98, 0.98],
  'billing-analysis': [0.62, 0.72, 0.88, 0.98, 0.99],
  'security-high-stakes': [0.48, 0.64, 0.82, 0.93, 0.99],
  'policy-comparison': [0.55, 0.68, 0.86, 0.98, 0.99]
};

export function createSyntheticResults(cases: RoutingEvalCase[]): CandidateResult[] {
  return cases.flatMap((item) => {
    const qualities = QUALITY_BY_CASE[item.id];
    if (!qualities) throw new Error(`Synthetic quality profile missing for ${item.id}`);
    return CHAT_ROUTING_MODELS.map((model, modelIndex) => {
      const inputTokens = 150 + item.prompt.length;
      const outputTokens = 34 + modelIndex * 4 + Math.round(item.routeSignals.complexity * 55);
      const quality = qualities[modelIndex];
      return {
        caseId: item.id,
        workflowId: item.workflowId,
        model,
        output: '[synthetic benchmark fixture]',
        toolCalls: [],
        usage: { inputTokens, cachedInputTokens: 0, outputTokens },
        costUsd: estimateTextCost(model, inputTokens, outputTokens),
        latencyMs: 240 + modelIndex * 170 + Math.round(item.routeSignals.complexity * 250),
        deterministicScore: quality,
        judgeScore: quality,
        qualityScore: quality,
        status: 'ok' as const,
        source: 'synthetic' as const
      };
    });
  });
}

export function createFixtureAutoSelections(cases: RoutingEvalCase[]): AutoSelection[] {
  return cases.map((item) => ({
    caseId: item.id,
    model: resolveRouteFromSignals(item.routeSignals, item.id).model,
    signals: item.routeSignals,
    routerCostUsd: estimateTextCost(CHAT_ROUTING_MODELS[0], 210 + item.prompt.length, 55),
    routerLatencyMs: 190,
    source: 'fixture-signals'
  }));
}
