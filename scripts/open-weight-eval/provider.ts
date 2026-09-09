export type ModelConfig = {
  id: string;
  model: string;
  baseUrl: string;
  apiKeyEnv?: string | string[];
  revision: string;
  precision: string;
  adapter?: string;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  providerOnly?: string[];
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  maxRetries?: number;
  // Server-specific controls, e.g. Qwen non-thinking mode. Never credentials.
  chatTemplateKwargs?: Record<string, unknown>;
};
export type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};
export type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
};
export type Completion = {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  finishReason: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  latencyMs: number;
  responseModel: string | null;
  costUsd: number | null;
  attempts: number;
};

export function validateConfig(value: unknown): ModelConfig[] {
  if (!Array.isArray(value) || !value.length) throw new Error('Config must be a nonempty model array');
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new Error('Invalid model entry');
    for (const key of ['id', 'model', 'baseUrl', 'revision', 'precision']) {
      if (typeof item[key] !== 'string' || !item[key].trim()) throw new Error(`Missing ${key}`);
    }
    const allowed = new Set(['id', 'model', 'baseUrl', 'revision', 'precision', 'apiKeyEnv', 'adapter', 'timeoutMs', 'maxTokens', 'temperature', 'chatTemplateKwargs', 'providerOnly', 'inputCostPerToken', 'outputCostPerToken', 'reasoningEffort', 'maxRetries']);
    if (Object.keys(item).some(key => !allowed.has(key))) throw new Error('Unknown model config field; credentials must use apiKeyEnv');
    const url = new URL(item.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('baseUrl must be HTTP(S) without embedded credentials, query, or fragment');
    }
    if (ids.has(item.id)) throw new Error(`Duplicate model id: ${item.id}`);
    ids.add(item.id);
    for (const key of ['timeoutMs', 'maxTokens']) {
      if (item[key] !== undefined && (!Number.isInteger(item[key]) || item[key] <= 0)) throw new Error(`Invalid ${key}`);
    }
    if (item.maxRetries !== undefined && (!Number.isInteger(item.maxRetries) || item.maxRetries < 0 || item.maxRetries > 5)) throw new Error('Invalid maxRetries');
    if (item.temperature !== undefined && (!Number.isFinite(item.temperature) || item.temperature < 0 || item.temperature > 2)) throw new Error('Invalid temperature');
    if (item.apiKeyEnv !== undefined) {
      const names = Array.isArray(item.apiKeyEnv) ? item.apiKeyEnv : [item.apiKeyEnv];
      if (!names.length || names.some((name: unknown) => typeof name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(name))) throw new Error('Invalid apiKeyEnv');
    }
    if (item.adapter !== undefined && (typeof item.adapter !== 'string' || !item.adapter.trim())) throw new Error('Invalid adapter');
    if (item.providerOnly !== undefined && (!Array.isArray(item.providerOnly) || !item.providerOnly.length || item.providerOnly.some((provider: unknown) => typeof provider !== 'string' || !provider.trim()))) throw new Error('Invalid providerOnly');
    for (const key of ['inputCostPerToken', 'outputCostPerToken']) {
      if (item[key] !== undefined && (!Number.isFinite(item[key]) || item[key] < 0)) throw new Error(`Invalid ${key}`);
    }
    if (item.reasoningEffort !== undefined && !['none', 'low', 'medium', 'high'].includes(item.reasoningEffort)) throw new Error('Invalid reasoningEffort');
    if (item.chatTemplateKwargs !== undefined && (!item.chatTemplateKwargs || typeof item.chatTemplateKwargs !== 'object' || Array.isArray(item.chatTemplateKwargs))) throw new Error('Invalid chatTemplateKwargs');
  }
  return value as ModelConfig[];
}

export function requestBody(config: ModelConfig, messages: Message[], tools: Tool[] = []) {
  return {
    model: config.model,
    messages,
    stream: false,
    temperature: config.temperature ?? 0,
    max_tokens: config.maxTokens ?? 512,
    ...(config.chatTemplateKwargs ? { chat_template_kwargs: config.chatTemplateKwargs } : {}),
    ...(config.providerOnly ? { providerOptions: { gateway: { only: config.providerOnly } } } : {}),
    ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort, ...(config.reasoningEffort === 'none' ? { enabled: false } : {}) } } : {}),
    ...(tools.length ? { tools: tools.map(tool => ({ type: 'function', function: tool })), tool_choice: 'auto' } : {}),
  };
}

function headers(config: ModelConfig, requireKey: boolean): Record<string, string> {
  const names = config.apiKeyEnv === undefined ? [] : Array.isArray(config.apiKeyEnv) ? config.apiKeyEnv : [config.apiKeyEnv];
  const key = names.map(name => process.env[name]).find(Boolean);
  if (requireKey && names.length && !key) throw new Error(`Missing one of these environment variables: ${names.join(', ')}`);
  return { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(1_000, date - Date.now());
}

export async function listModels(config: ModelConfig): Promise<string[]> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/models`, {
    headers: headers(config, false), signal: AbortSignal.timeout(config.timeoutMs ?? 60_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Model discovery returned HTTP ${response.status}`);
  const json = await response.json();
  if (!Array.isArray(json.data)) throw new Error('Invalid model discovery response');
  return json.data.map((entry: { id?: unknown }) => entry.id).filter((id: unknown): id is string => typeof id === 'string');
}

export async function complete(config: ModelConfig, messages: Message[], tools: Tool[] = []): Promise<Completion> {
  const started = performance.now();
  const maximumAttempts = (config.maxRetries ?? 0) + 1;
  let response: Response | undefined;
  let attempts = 0;
  for (; attempts < maximumAttempts; attempts++) {
    response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: headers(config, true), body: JSON.stringify(requestBody(config, messages, tools)),
      signal: AbortSignal.timeout(config.timeoutMs ?? 60_000), redirect: 'error',
    });
    if (response.ok || ![408, 429, 500, 502, 503, 504].includes(response.status) || attempts + 1 === maximumAttempts) break;
    await response.body?.cancel();
    const delayMs = Math.min(retryAfterMs(response.headers.get('retry-after')) ?? 1_000 * 2 ** attempts, 10_000);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  if (!response) throw new Error('Completion request was not attempted');
  // Do not persist upstream error bodies, which can echo credentials or infrastructure details.
  if (!response.ok) throw new Error(`Completion returned HTTP ${response.status}`);
  const json = await response.json();
  const choice = json.choices?.[0];
  if (!choice?.message || typeof choice.finish_reason !== 'string') throw new Error('Invalid completion response');
  const message = choice.message;
  if (message.content !== null && message.content !== undefined && typeof message.content !== 'string') throw new Error('Unsupported message content');
  if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) throw new Error('Invalid tool calls');
  const toolCalls = (message.tool_calls ?? []).map((call: { id?: string; type?: string; function?: { name?: string; arguments?: string } }) => {
    if (!call.id || call.type !== 'function' || !call.function?.name || typeof call.function.arguments !== 'string') throw new Error('Invalid tool call');
    const args = JSON.parse(call.function.arguments);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object');
    return { id: call.id, name: call.function.name, arguments: args as Record<string, unknown> };
  });
  const validUsage = Number.isInteger(json.usage?.prompt_tokens) && json.usage.prompt_tokens >= 0
    && Number.isInteger(json.usage?.completion_tokens) && json.usage.completion_tokens >= 0;
  const usage = validUsage ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens } : null;
  const hasPricing = config.inputCostPerToken !== undefined && config.outputCostPerToken !== undefined;
  return {
    text: message.content ?? '', toolCalls, finishReason: choice.finish_reason,
    usage,
    latencyMs: performance.now() - started,
    responseModel: typeof json.model === 'string' ? json.model : null,
    costUsd: usage && hasPricing
      ? usage.inputTokens * config.inputCostPerToken! + usage.outputTokens * config.outputCostPerToken!
      : null,
    attempts: attempts + 1,
  };
}
