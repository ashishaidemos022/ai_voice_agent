import type { EvalArtifact, StrategySummary } from './types.ts';

function money(value: number): string {
  return `$${value.toFixed(6)}`;
}

function percent(value: number | null): string {
  return value === null ? 'N/A (quality gate failed)' : `${value.toFixed(1)}%`;
}

function row(strategy: StrategySummary): string {
  const mix = Object.entries(strategy.selectedModels).map(([model, count]) => `${model} × ${count}`).join(', ');
  return `| ${strategy.label} | ${(strategy.quality * 100).toFixed(1)}% | ${money(strategy.costUsd)} | ${strategy.latencyMs.toFixed(0)} | ${mix} |`;
}

export function renderMarkdownReport(artifact: EvalArtifact): string {
  const { summary } = artifact;
  const pareto = summary.pareto.filter((item) => item.paretoOptimal).map((item) => item.label).join(', ');
  return `# Routing evaluation: ${artifact.runId}

Generated: ${artifact.createdAt}  
Source: **${artifact.source}**  
Benchmark: **${artifact.benchmarkVersion}**  
Policy: **${artifact.policyVersion}**  
Cases: **${artifact.cases.length}** across **${new Set(artifact.cases.map((item) => item.workflowId)).size} workflows**

> ${artifact.source === 'synthetic' ? 'This is a deterministic synthetic smoke test for the harness. Do not use its values as a product claim. Run the live benchmark for evidence.' : 'This run used live model responses. Review failed checks and raw outputs before using the result as a product claim.'}

## Outcome

- Auto matched Fixed Sol quality: **${summary.autoMatchesFrontierQuality ? 'yes' : 'no'}** (tolerance ${(summary.qualityTolerance * 100).toFixed(1)} points)
- CostSave vs Fixed Sol at matched quality: **${percent(summary.costSaveVsFrontierPct)}**
- Quality gain vs best single model: **${(summary.perfGainVsBestSingle * 100).toFixed(1)} points**
- Gap to matched-quality oracle: **${money(summary.oracleCostGapUsd)}**
- Available savings captured: **${percent(summary.savingsCapturedPct)}**
- Pareto-optimal evaluated strategies: **${pareto || 'none'}**

## Baselines

| Strategy | Quality | Cost | Total latency (ms) | Model mix |
|---|---:|---:|---:|---|
${[summary.fixedFrontier, summary.bestSingle, summary.auto, summary.oracleCost, summary.oraclePerformance].map(row).join('\n')}

## Fixed-model matrix

| Strategy | Quality | Cost | Total latency (ms) | Model mix |
|---|---:|---:|---:|---|
${summary.fixedModels.map(row).join('\n')}

## Auto decisions

| Case | Model | Task | Complexity | Router cost | Source |
|---|---|---|---:|---:|---|
${artifact.autoSelections.map((item) => `| ${item.caseId} | ${item.model} | ${item.signals.taskType} | ${item.signals.complexity.toFixed(2)} | ${money(item.routerCostUsd)} | ${item.source} |`).join('\n')}

## Interpretation guardrails

- CostSave is reported only when Auto is within the declared quality tolerance of Fixed Sol.
- The matched-quality oracle chooses the cheapest model per case that stays within tolerance of Sol on that same case.
- The performance oracle is an upper bound that chooses the highest-scoring model after seeing every result.
- Workflow IDs remain wholly within calibration or test splits; never split turns from one workflow across both.
- Inspect the JSON artifact for prompts, raw outputs, tool calls, token counts, scoring components, and failures.
`;
}
