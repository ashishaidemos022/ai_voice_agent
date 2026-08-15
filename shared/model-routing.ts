import { getOpenAIModelPricing, OPENAI_MODELS } from './openai-models.ts';

export const CHAT_ROUTING_MODELS = [
  OPENAI_MODELS.chat.nano,
  OPENAI_MODELS.chat.economy,
  OPENAI_MODELS.chat.mini,
  OPENAI_MODELS.chat.default,
  OPENAI_MODELS.chat.frontier
] as const;

export type ChatRoutingModel = typeof CHAT_ROUTING_MODELS[number];
export type ChatRoutingStrategy = 'auto' | 'fixed';
export type ChatTaskType =
  | 'classification'
  | 'transformation'
  | 'grounded_answer'
  | 'tool_use'
  | 'analysis'
  | 'high_stakes';
export type ChatReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export type RouteSignals = {
  taskType: ChatTaskType;
  complexity: number;
  confidence: number;
  requiresTools: boolean;
  consequential: boolean;
};

export const ROUTING_CLASSIFIER_INSTRUCTIONS = [
  'Classify the task for model routing. Judge the requested work, not its subject alone.',
  'Use high_stakes only when an incorrect answer could materially affect health, safety, legal rights, finances, security, compliance, or irreversible data.',
  'Sensitive-looking identifiers or subject matter do not by themselves make a bounded extraction, lookup, or summary high_stakes.',
  'Use transformation for bounded rewriting, formatting, extraction, translation, or classification.',
  'Use tool_use when completing the request depends on an available external tool.',
  'Use analysis when the answer itself requires multi-step comparison, calculation, diagnosis, trade-off evaluation, or planning.',
  'Calibrate complexity to cognitive work: 0.0-0.3 bounded tasks, 0.3-0.55 grounded answers or one-tool calls, 0.55-0.85 multi-step analysis, and above 0.85 only for genuinely difficult reasoning.',
  'Return only the required JSON object.'
].join('\n');

export const ROUTE_SIGNALS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    task_type: { type: 'string', enum: ['classification', 'transformation', 'grounded_answer', 'tool_use', 'analysis', 'high_stakes'] },
    complexity: { type: 'number', minimum: 0, maximum: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    requires_tools: { type: 'boolean' },
    consequential: { type: 'boolean' }
  },
  required: ['task_type', 'complexity', 'confidence', 'requires_tools', 'consequential']
} as const;

export type ChatRouteDecision = RouteSignals & {
  turnId: string;
  strategy: ChatRoutingStrategy;
  model: ChatRoutingModel;
  reasoningEffort: ChatReasoningEffort;
  reasonCode: string;
  reason: string;
  policyVersion: 'chat-router-v1';
  routerModel?: string;
  routerLatencyMs?: number;
  routerCostUsd?: number;
  answerLatencyMs?: number;
  answerCostUsd?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
};

export function isChatRoutingModel(value: unknown): value is ChatRoutingModel {
  return typeof value === 'string' && CHAT_ROUTING_MODELS.includes(value as ChatRoutingModel);
}

export function estimateTextCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0
): number {
  const pricing = getOpenAIModelPricing(model);
  if (!pricing) return 0;
  const cached = Math.min(Math.max(cachedInputTokens, 0), Math.max(inputTokens, 0));
  const uncached = Math.max(0, inputTokens - cached);
  return (uncached / 1_000_000) * pricing.textInputPer1M
    + (cached / 1_000_000) * (pricing.cachedTextInputPer1M ?? pricing.textInputPer1M)
    + (Math.max(outputTokens, 0) / 1_000_000) * pricing.textOutputPer1M;
}

export function resolveRouteFromSignals(
  signals: RouteSignals,
  turnId: string
): ChatRouteDecision {
  const base = {
    ...signals,
    turnId,
    strategy: 'auto' as const,
    policyVersion: 'chat-router-v1' as const
  };

  if (signals.consequential || signals.taskType === 'high_stakes') {
    return {
      ...base,
      model: OPENAI_MODELS.chat.frontier,
      reasoningEffort: 'high',
      reasonCode: 'consequential_deep_reasoning',
      reason: 'Consequential or deeply complex reasoning benefits from the capability-first model.'
    };
  }
  if (signals.taskType === 'analysis') {
    if (signals.complexity >= 0.88) {
      return {
        ...base,
        model: OPENAI_MODELS.chat.frontier,
        reasoningEffort: 'high',
        reasonCode: 'deep_multi_step_analysis',
        reason: 'This analysis is complex enough to benefit from the capability-first model.'
      };
    }
    return {
      ...base,
      model: OPENAI_MODELS.chat.default,
      reasoningEffort: 'medium',
      reasonCode: 'multi_step_analysis',
      reason: 'Multi-step analysis needs a balanced reasoning model.'
    };
  }
  if (signals.taskType === 'tool_use' || signals.requiresTools) {
    return {
      ...base,
      model: OPENAI_MODELS.chat.mini,
      reasoningEffort: 'low',
      reasonCode: 'lightweight_tool_orchestration',
      reason: 'Structured tool orchestration fits the efficient mini model.'
    };
  }
  if (signals.taskType === 'classification' || signals.taskType === 'transformation') {
    if (signals.confidence < 0.8) {
      return {
        ...base,
        model: OPENAI_MODELS.chat.economy,
        reasoningEffort: 'none',
        reasonCode: 'uncertain_bounded_task',
        reason: 'The task appears bounded, but low routing confidence favors the conversational economy model.'
      };
    }
    return {
      ...base,
      model: OPENAI_MODELS.chat.nano,
      reasoningEffort: 'none',
      reasonCode: 'bounded_transformation',
      reason: 'The request is bounded extraction, classification, or transformation work.'
    };
  }
  return {
    ...base,
    model: OPENAI_MODELS.chat.economy,
    reasoningEffort: signals.complexity >= 0.4 ? 'low' : 'none',
    reasonCode: 'grounded_conversation',
    reason: 'A cost-efficient conversational model can satisfy this grounded request.'
  };
}

export function createFixedRoute(model: ChatRoutingModel, turnId: string): ChatRouteDecision {
  return {
    turnId,
    strategy: 'fixed',
    taskType: 'analysis',
    complexity: 1,
    confidence: 1,
    requiresTools: false,
    consequential: false,
    model,
    reasoningEffort: model === OPENAI_MODELS.chat.frontier ? 'high' : 'low',
    reasonCode: 'fixed_model_selected',
    reason: 'Auto routing is disabled, so every turn uses the selected fixed model.',
    policyVersion: 'chat-router-v1'
  };
}

export function heuristicRouteSignals(text: string, hasTools: boolean): RouteSignals {
  const normalized = text.toLowerCase();
  const consequential = /\b(legal|medical|financial|compliance|safety|data loss|security|contract|dispute)\b/.test(normalized);
  const transformation = /\b(rewrite|rephrase|translate|format|extract|classify|categorize|rank|shorten|convert|two[- ]line|json)\b/.test(normalized);
  const analysis = /\b(analy[sz]e|compare|trade-?off|evaluate|investigate|root cause|recommend|strategy|risk|reconcile|plan)\b/.test(normalized);
  const toolUse = hasTools && /\b(check|look up|find|fetch|book|schedule|send|create|update|delete|account|subscription|transaction|appointment)\b/.test(normalized);
  const complexity = Math.min(1, 0.18 + (text.length / 900) + (analysis ? 0.42 : 0) + (consequential ? 0.35 : 0) + (toolUse ? 0.18 : 0));
  return {
    taskType: consequential ? 'high_stakes' : analysis ? 'analysis' : toolUse ? 'tool_use' : transformation ? 'transformation' : 'grounded_answer',
    complexity,
    confidence: 0.62,
    requiresTools: toolUse,
    consequential
  };
}

export function reconcileRouteSignals(text: string, signals: RouteSignals): RouteSignals {
  const normalized = text.toLowerCase();
  const boundedTask = signals.taskType === 'classification' || signals.taskType === 'transformation';
  const conversationalOpening = /\b(can|could|would|will) you help\b|\bhelp me\b/.test(normalized);
  const explicitBoundedRequest = /\b(classify|categorize|extract|rewrite|rephrase|translate|format|convert|label|return (?:only )?json)\b/.test(normalized);
  if (boundedTask && conversationalOpening && !explicitBoundedRequest) {
    return {
      ...signals,
      taskType: 'grounded_answer',
      complexity: Math.min(signals.complexity, 0.35),
      requiresTools: false
    };
  }
  return signals;
}
