import type { ChatRoutingModel, RouteSignals } from '../../shared/model-routing.ts';

export type EvalSplit = 'calibration' | 'test';
export type EvalTool = {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type DeterministicRequirements = {
  requiredPatterns?: string[];
  forbiddenPatterns?: string[];
  maxWords?: number;
  expectedTool?: {
    name: string;
    arguments: Record<string, unknown>;
  };
};

export type RoutingEvalCase = {
  id: string;
  workflowId: string;
  split: EvalSplit;
  title: string;
  instructions: string;
  prompt: string;
  tools?: EvalTool[];
  routeSignals: RouteSignals;
  requirements: DeterministicRequirements;
  judgeRubric: string;
  weight?: number;
};

export type ToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export type EvalUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

export type CandidateResult = {
  caseId: string;
  workflowId: string;
  model: ChatRoutingModel;
  output: string;
  toolCalls: ToolCall[];
  usage: EvalUsage;
  costUsd: number;
  latencyMs: number;
  deterministicScore: number;
  judgeScore: number | null;
  qualityScore: number;
  status: 'ok' | 'error';
  error?: string;
  source: 'live' | 'synthetic';
};

export type AutoSelection = {
  caseId: string;
  model: ChatRoutingModel;
  signals: RouteSignals;
  routerCostUsd: number;
  routerLatencyMs: number;
  source: 'live-classifier' | 'fixture-signals';
};

export type StrategySummary = {
  id: 'fixed-frontier' | 'best-single' | 'auto' | 'oracle-cost' | 'oracle-performance' | `fixed:${string}`;
  label: string;
  quality: number;
  costUsd: number;
  latencyMs: number;
  selectedModels: Record<string, number>;
};

export type ParetoPoint = StrategySummary & { paretoOptimal: boolean };

export type EvalSummary = {
  qualityTolerance: number;
  fixedFrontier: StrategySummary;
  bestSingle: StrategySummary;
  auto: StrategySummary;
  oracleCost: StrategySummary;
  oraclePerformance: StrategySummary;
  fixedModels: StrategySummary[];
  pareto: ParetoPoint[];
  autoMatchesFrontierQuality: boolean;
  costSaveVsFrontierPct: number | null;
  perfGainVsBestSingle: number;
  oracleCostGapUsd: number;
  savingsCapturedPct: number | null;
};

export type EvalArtifact = {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  source: 'live' | 'synthetic';
  benchmarkVersion: string;
  policyVersion: string;
  pricingEffectiveDate: string;
  command: string;
  cases: RoutingEvalCase[];
  results: CandidateResult[];
  autoSelections: AutoSelection[];
  summary: EvalSummary;
};
