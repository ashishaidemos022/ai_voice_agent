import {
  CHAT_ROUTING_MODELS,
  estimateTextCost,
  heuristicRouteSignals,
  ROUTE_SIGNALS_JSON_SCHEMA,
  ROUTING_CLASSIFIER_INSTRUCTIONS,
  resolveRouteFromSignals,
  type ChatRoutingModel,
  type ChatTaskType,
  type RouteSignals
} from '../../shared/model-routing.ts';
import { OPENAI_MODELS } from '../../shared/openai-models.ts';
import { combineQualityScores, scoreDeterministic } from './scoring.ts';
import type { AutoSelection, CandidateResult, RoutingEvalCase, ToolCall } from './types.ts';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function outputText(json: unknown): string {
  const root = asRecord(json);
  if (typeof root.output_text === 'string') return root.output_text;
  return (Array.isArray(root.output) ? root.output : []).map(asRecord)
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map(asRecord)
    .filter((item) => item.type === 'output_text')
    .map((item) => typeof item.text === 'string' ? item.text : '')
    .join('');
}

function toolCalls(json: unknown): ToolCall[] {
  const output = asRecord(json).output;
  return (Array.isArray(output) ? output : []).map(asRecord)
    .filter((item) => item.type === 'function_call' && typeof item.name === 'string')
    .map((item) => {
      try {
        return { name: item.name as string, arguments: JSON.parse(typeof item.arguments === 'string' ? item.arguments : '{}') as JsonRecord };
      } catch {
        return { name: item.name as string, arguments: {} };
      }
    });
}

function usage(json: unknown) {
  const value = asRecord(asRecord(json).usage);
  const details = asRecord(value.input_tokens_details);
  return {
    inputTokens: Number(value.input_tokens) || 0,
    cachedInputTokens: Number(details.cached_tokens) || 0,
    outputTokens: Number(value.output_tokens) || 0
  };
}

async function requestResponses(apiKey: string, payload: JsonRecord): Promise<{ json: unknown; latencyMs: number }> {
  const startedAt = Date.now();
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, store: false })
      });
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 300));
        continue;
      }
      break;
    }
    const body = await response.text();
    let json: unknown;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {
      lastError = new Error(`OpenAI returned invalid JSON (status ${response.status}, ${body.length} bytes)`);
      if (attempt < 3) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 300));
        continue;
      }
      break;
    }
    if (!response.ok) {
      const message = String(asRecord(asRecord(json).error).message || `OpenAI request failed (${response.status})`);
      const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
      if (!retryable) throw new Error(message);
      lastError = new Error(message);
    } else if (json === null) {
      lastError = new Error(`OpenAI returned an empty response body (status ${response.status})`);
    } else {
      return { json, latencyMs: Date.now() - startedAt };
    }
    if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 300));
  }
  throw new Error(`OpenAI request failed after 3 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function reasoningEffort(model: ChatRoutingModel): 'none' | 'low' | 'medium' | 'high' {
  if (model === OPENAI_MODELS.chat.frontier) return 'high';
  if (model === OPENAI_MODELS.chat.default) return 'medium';
  if (model === OPENAI_MODELS.chat.mini) return 'low';
  return 'none';
}

async function judgeResult(apiKey: string, item: RoutingEvalCase, output: string, calls: ToolCall[]): Promise<number> {
  let lastError: unknown;
  for (const maxOutputTokens of [500, 1000]) {
    try {
      const { json } = await requestResponses(apiKey, {
        model: process.env.ROUTING_EVAL_JUDGE_MODEL || OPENAI_MODELS.chat.frontier,
        instructions: 'Grade the candidate against the rubric. Ignore style preferences not in the rubric. Return only the required JSON.',
        input: [{ role: 'user', content: `Prompt:\n${item.prompt}\n\nRubric:\n${item.judgeRubric}\n\nCandidate text:\n${output || '(none)'}\n\nCandidate tool calls:\n${JSON.stringify(calls)}` }],
        reasoning: { effort: 'low' },
        text: { format: { type: 'json_schema', name: 'routing_eval_grade', strict: true, schema: {
          type: 'object', additionalProperties: false,
          properties: { score: { type: 'number', minimum: 0, maximum: 1 } }, required: ['score']
        } } },
        max_output_tokens: maxOutputTokens
      });
      const text = outputText(json).trim();
      if (!text) {
        const root = asRecord(json);
        throw new Error(`Judge returned no JSON (status: ${String(root.status || 'unknown')}, details: ${JSON.stringify(root.incomplete_details || null)})`);
      }
      const parsed = JSON.parse(text) as { score?: number };
      if (!Number.isFinite(parsed.score)) throw new Error(`Judge returned an invalid score: ${text}`);
      return Math.min(1, Math.max(0, Number(parsed.score)));
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Judge failed after 2 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function runCandidate(
  apiKey: string,
  item: RoutingEvalCase,
  model: ChatRoutingModel,
  useJudge: boolean
): Promise<CandidateResult> {
  let responseText = '';
  let calls: ToolCall[] = [];
  let responseUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  let latencyMs = 0;
  let deterministicScore = 0;
  try {
    const response = await requestResponses(apiKey, {
      model,
      instructions: item.instructions,
      input: [{ role: 'user', content: item.prompt }],
      tools: item.tools?.length ? item.tools : undefined,
      tool_choice: item.tools?.length ? 'auto' : undefined,
      reasoning: { effort: reasoningEffort(model) },
      text: { verbosity: 'low' },
      max_output_tokens: 800
    });
    latencyMs = response.latencyMs;
    responseText = outputText(response.json);
    calls = toolCalls(response.json);
    deterministicScore = scoreDeterministic(item.requirements, responseText, calls);
    responseUsage = usage(response.json);
    const judgeScore = useJudge ? await judgeResult(apiKey, item, responseText, calls) : null;
    return {
      caseId: item.id, workflowId: item.workflowId, model, output: responseText, toolCalls: calls,
      usage: responseUsage,
      costUsd: estimateTextCost(model, responseUsage.inputTokens, responseUsage.outputTokens, responseUsage.cachedInputTokens),
      latencyMs, deterministicScore, judgeScore,
      qualityScore: combineQualityScores(deterministicScore, judgeScore, Boolean(item.requirements.expectedTool)),
      status: 'ok', source: 'live'
    };
  } catch (error) {
    return {
      caseId: item.id, workflowId: item.workflowId, model, output: responseText, toolCalls: calls,
      usage: responseUsage,
      costUsd: estimateTextCost(model, responseUsage.inputTokens, responseUsage.outputTokens, responseUsage.cachedInputTokens),
      latencyMs, deterministicScore, judgeScore: null, qualityScore: 0, status: 'error',
      error: error instanceof Error ? error.message : String(error), source: 'live'
    };
  }
}

function normalizedSignals(value: unknown, fallback: RouteSignals): RouteSignals {
  const raw = asRecord(value);
  const taskTypes: ChatTaskType[] = ['classification', 'transformation', 'grounded_answer', 'tool_use', 'analysis', 'high_stakes'];
  return {
    taskType: taskTypes.includes(raw.task_type as ChatTaskType) ? raw.task_type as ChatTaskType : fallback.taskType,
    complexity: Math.min(1, Math.max(0, Number(raw.complexity) || fallback.complexity)),
    confidence: Math.min(1, Math.max(0, Number(raw.confidence) || fallback.confidence)),
    requiresTools: typeof raw.requires_tools === 'boolean' ? raw.requires_tools : fallback.requiresTools,
    consequential: typeof raw.consequential === 'boolean' ? raw.consequential : fallback.consequential
  };
}

export async function classifyForAuto(apiKey: string, item: RoutingEvalCase): Promise<AutoSelection> {
  const model = OPENAI_MODELS.chat.nano;
  const fallback = heuristicRouteSignals(item.prompt, Boolean(item.tools?.length));
  const { json, latencyMs } = await requestResponses(apiKey, {
    model,
    instructions: ROUTING_CLASSIFIER_INSTRUCTIONS,
    input: [{ role: 'user', content: `Agent task context:\n${item.instructions.slice(0, 2400)}\n\nAvailable tools: ${item.tools?.map((tool) => tool.name).join(', ') || 'none'}\n\nCurrent user task:\n${item.prompt}` }],
    reasoning: { effort: 'none' },
    text: { format: { type: 'json_schema', name: 'route_signals', strict: true, schema: ROUTE_SIGNALS_JSON_SCHEMA } },
    max_output_tokens: 180
  });
  const responseUsage = usage(json);
  const signals = normalizedSignals(JSON.parse(outputText(json)), fallback);
  return {
    caseId: item.id,
    model: resolveRouteFromSignals(signals, item.id).model,
    signals,
    routerCostUsd: estimateTextCost(model, responseUsage.inputTokens, responseUsage.outputTokens, responseUsage.cachedInputTokens),
    routerLatencyMs: latencyMs,
    source: 'live-classifier'
  };
}

export async function runLiveMatrix(
  cases: RoutingEvalCase[],
  onProgress: (message: string) => void,
  useJudge = true,
  onCheckpoint?: (state: { results: CandidateResult[]; autoSelections: AutoSelection[] }) => Promise<void>
): Promise<{ results: CandidateResult[]; autoSelections: AutoSelection[] }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for a live benchmark');
  const results: CandidateResult[] = [];
  const autoSelections: AutoSelection[] = [];
  for (const item of cases) {
    onProgress(`Routing ${item.id}`);
    autoSelections.push(await classifyForAuto(apiKey, item));
    await onCheckpoint?.({ results: [...results], autoSelections: [...autoSelections] });
    for (const model of CHAT_ROUTING_MODELS) {
      onProgress(`Running ${item.id} on ${model}`);
      results.push(await runCandidate(apiKey, item, model, useJudge));
      await onCheckpoint?.({ results: [...results], autoSelections: [...autoSelections] });
    }
  }
  const errors = results.filter((result) => result.status === 'error');
  if (errors.length) throw new Error(`${errors.length} candidate calls failed; first error: ${errors[0].error}`);
  return { results, autoSelections };
}
