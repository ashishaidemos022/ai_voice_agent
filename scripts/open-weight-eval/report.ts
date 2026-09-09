import type { ModelConfig } from './provider.ts';

type Result = {
  modelId?: unknown;
  category?: unknown;
  status?: unknown;
  pass?: unknown;
  latencyMs?: unknown;
  usage?: unknown;
  costUsd?: unknown;
};

type ReportArtifact = {
  mode: 'plan' | 'live';
  models: ModelConfig[];
  results: Result[];
  limitations: string[];
};

function summary(results: Result[]) {
  const completed = results.filter((result) => result.status === 'ok');
  const costs = completed.map((result) => result.costUsd).filter((cost): cost is number => typeof cost === 'number');
  const usage = completed.map((result) => result.usage).filter((value): value is { inputTokens: number; outputTokens: number } => (
    value !== null && typeof value === 'object'
    && typeof (value as { inputTokens?: unknown }).inputTokens === 'number'
    && typeof (value as { outputTokens?: unknown }).outputTokens === 'number'
  ));
  return {
    attempted: results.length,
    passed: results.filter((result) => result.pass === true).length,
    errors: results.filter((result) => result.status === 'error').length,
    meanLatencyMs: completed.length
      ? completed.reduce((total, result) => total + (typeof result.latencyMs === 'number' ? result.latencyMs : 0), 0) / completed.length
      : null,
    inputTokens: usage.reduce((total, value) => total + value.inputTokens, 0),
    outputTokens: usage.reduce((total, value) => total + value.outputTokens, 0),
    costUsd: costs.length === completed.length && completed.length ? costs.reduce((total, value) => total + value, 0) : null
  };
}

function percent(passed: number, attempted: number) {
  return attempted ? `${(passed / attempted * 100).toFixed(1)}%` : 'N/A';
}

export function renderOpenWeightReport(artifact: ReportArtifact): string {
  const modelRows = artifact.models.map((model) => {
    const value = summary(artifact.results.filter((result) => result.modelId === model.id));
    return `| ${model.id.replace(/\|/g, '\\|')} | ${value.attempted} | ${value.passed} | ${percent(value.passed, value.attempted)} | ${value.errors} | ${value.meanLatencyMs === null ? 'N/A' : Math.round(value.meanLatencyMs)} | ${value.costUsd === null ? 'Unknown' : `$${value.costUsd.toFixed(6)}`} |`;
  });
  const categories = [...new Set(artifact.results.map((result) => result.category).filter((value): value is string => typeof value === 'string'))];
  const categoryRows = artifact.models.flatMap((model) => categories.map((category) => {
    const value = summary(artifact.results.filter((result) => result.modelId === model.id && result.category === category));
    return `| ${model.id.replace(/\|/g, '\\|')} | ${category.replace(/\|/g, '\\|')} | ${value.passed}/${value.attempted} | ${percent(value.passed, value.attempted)} | ${value.meanLatencyMs === null ? 'N/A' : Math.round(value.meanLatencyMs)} |`;
  }));
  const total = summary(artifact.results);
  return [
    '# Open-weight development smoke run', '',
    artifact.mode === 'plan' ? 'PLAN ONLY — no model requests made and no scores measured.' : 'LIVE DEVELOPMENT SMOKE — these templated checks do not establish general model quality.', '',
    '| Model | Attempted | Passed | Strict pass rate | Errors | Mean latency (ms) | Measured cost |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |', ...modelRows, '',
    ...(categoryRows.length ? ['## Category results', '', '| Model | Category | Passed | Strict pass rate | Mean latency (ms) |', '| --- | --- | ---: | ---: | ---: |', ...categoryRows, ''] : []),
    `Tokens reported: ${total.inputTokens} input / ${total.outputTokens} output.`, '',
    ...artifact.limitations.map((value) => `- ${value}`), '',
    'See results.json for frozen inputs, operator-declared model metadata, and individual outputs.', ''
  ].join('\n');
}
