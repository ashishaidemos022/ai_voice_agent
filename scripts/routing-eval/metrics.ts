import { CHAT_ROUTING_MODELS } from '../../shared/model-routing.ts';
import { OPENAI_MODELS } from '../../shared/openai-models.ts';
import type {
  AutoSelection,
  CandidateResult,
  EvalSummary,
  ParetoPoint,
  RoutingEvalCase,
  StrategySummary
} from './types.ts';

const QUALITY_EPSILON = 1e-9;

function counts(models: string[]): Record<string, number> {
  return models.reduce<Record<string, number>>((acc, model) => {
    acc[model] = (acc[model] ?? 0) + 1;
    return acc;
  }, {});
}

function summarize(
  id: StrategySummary['id'],
  label: string,
  cases: RoutingEvalCase[],
  selected: CandidateResult[],
  extraCostUsd = 0,
  extraLatencyMs = 0
): StrategySummary {
  const weights = new Map(cases.map((item) => [item.id, item.weight ?? 1]));
  const totalWeight = selected.reduce((sum, result) => sum + (weights.get(result.caseId) ?? 1), 0) || 1;
  return {
    id,
    label,
    quality: selected.reduce((sum, result) => sum + result.qualityScore * (weights.get(result.caseId) ?? 1), 0) / totalWeight,
    costUsd: selected.reduce((sum, result) => sum + result.costUsd, extraCostUsd),
    latencyMs: selected.reduce((sum, result) => sum + result.latencyMs, extraLatencyMs),
    selectedModels: counts(selected.map((result) => result.model))
  };
}

function resultFor(results: CandidateResult[], caseId: string, model: string): CandidateResult {
  const result = results.find((item) => item.caseId === caseId && item.model === model);
  if (!result) throw new Error(`Missing result for ${caseId} on ${model}`);
  return result;
}

function paretoPoints(strategies: StrategySummary[]): ParetoPoint[] {
  return strategies.map((strategy) => ({
    ...strategy,
    paretoOptimal: !strategies.some((other) => other.id !== strategy.id
      && other.costUsd <= strategy.costUsd
      && other.quality + QUALITY_EPSILON >= strategy.quality
      && (other.costUsd < strategy.costUsd || other.quality > strategy.quality + QUALITY_EPSILON))
  }));
}

export function calculateEvalSummary(
  cases: RoutingEvalCase[],
  results: CandidateResult[],
  autoSelections: AutoSelection[],
  qualityTolerance = 0.03
): EvalSummary {
  const successful = results.filter((result) => result.status === 'ok');
  for (const item of cases) {
    for (const model of CHAT_ROUTING_MODELS) resultFor(successful, item.id, model);
  }

  const fixedModels = CHAT_ROUTING_MODELS.map((model) => summarize(
    `fixed:${model}`,
    `Fixed ${model}`,
    cases,
    cases.map((item) => resultFor(successful, item.id, model))
  ));
  const fixedFrontierBase = fixedModels.find((item) => item.id === `fixed:${OPENAI_MODELS.chat.frontier}`);
  if (!fixedFrontierBase) throw new Error('Frontier baseline is missing');
  const fixedFrontier: StrategySummary = { ...fixedFrontierBase, id: 'fixed-frontier', label: `Fixed ${OPENAI_MODELS.chat.frontier}` };

  const bestSingleBase = [...fixedModels].sort((a, b) => b.quality - a.quality || a.costUsd - b.costUsd)[0];
  const bestSingle: StrategySummary = { ...bestSingleBase, id: 'best-single', label: `Best single (${bestSingleBase.label.replace('Fixed ', '')})` };

  const autoResults = cases.map((item) => {
    const selection = autoSelections.find((candidate) => candidate.caseId === item.id);
    if (!selection) throw new Error(`Missing auto selection for ${item.id}`);
    return resultFor(successful, item.id, selection.model);
  });
  const auto = summarize(
    'auto', 'Current auto policy', cases, autoResults,
    autoSelections.reduce((sum, item) => sum + item.routerCostUsd, 0),
    autoSelections.reduce((sum, item) => sum + item.routerLatencyMs, 0)
  );

  const oracleCostResults = cases.map((item) => {
    const frontier = resultFor(successful, item.id, OPENAI_MODELS.chat.frontier);
    const threshold = Math.max(0, frontier.qualityScore - qualityTolerance);
    const candidates = CHAT_ROUTING_MODELS.map((model) => resultFor(successful, item.id, model));
    return candidates.filter((candidate) => candidate.qualityScore + QUALITY_EPSILON >= threshold)
      .sort((a, b) => a.costUsd - b.costUsd || b.qualityScore - a.qualityScore)[0]
      ?? candidates.sort((a, b) => b.qualityScore - a.qualityScore || a.costUsd - b.costUsd)[0];
  });
  const oracleCost = summarize('oracle-cost', 'Matched-quality cost oracle', cases, oracleCostResults);

  const oraclePerformanceResults = cases.map((item) => CHAT_ROUTING_MODELS
    .map((model) => resultFor(successful, item.id, model))
    .sort((a, b) => b.qualityScore - a.qualityScore || a.costUsd - b.costUsd)[0]);
  const oraclePerformance = summarize('oracle-performance', 'Performance oracle', cases, oraclePerformanceResults);

  const autoMatchesFrontierQuality = auto.quality + qualityTolerance >= fixedFrontier.quality;
  const availableSavings = fixedFrontier.costUsd - oracleCost.costUsd;
  return {
    qualityTolerance,
    fixedFrontier,
    bestSingle,
    auto,
    oracleCost,
    oraclePerformance,
    fixedModels,
    pareto: paretoPoints([...fixedModels, auto]),
    autoMatchesFrontierQuality,
    costSaveVsFrontierPct: autoMatchesFrontierQuality && fixedFrontier.costUsd > 0
      ? (fixedFrontier.costUsd - auto.costUsd) / fixedFrontier.costUsd * 100
      : null,
    perfGainVsBestSingle: auto.quality - bestSingle.quality,
    oracleCostGapUsd: auto.costUsd - oracleCost.costUsd,
    savingsCapturedPct: autoMatchesFrontierQuality && availableSavings > 0
      ? (fixedFrontier.costUsd - auto.costUsd) / availableSavings * 100
      : null
  };
}
