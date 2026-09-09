import { createClient } from '@supabase/supabase-js';

const DEFAULT_MODELS = [{
  id: 'qwen3-14b-vercel-baseline',
  model: 'alibaba/qwen-3-14b',
  revision: 'provider-undisclosed',
  precision: 'provider-undisclosed',
  inputCostPerToken: 0.00000012,
  outputCostPerToken: 0.00000024,
  providerOnly: ['deepinfra'],
  transport: 'gateway',
  supportsTools: true
}];

export const config = { maxDuration: 300 };

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function parseBearer(value) {
  if (typeof value !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(value);
  return match?.[1] || null;
}

export function getGatewayToken(req, env = process.env) {
  if (typeof env.AI_GATEWAY_API_KEY === 'string' && env.AI_GATEWAY_API_KEY) return env.AI_GATEWAY_API_KEY;
  if (typeof env.VERCEL_OIDC_TOKEN === 'string' && env.VERCEL_OIDC_TOKEN) return env.VERCEL_OIDC_TOKEN;
  const header = req?.headers?.['x-vercel-oidc-token'];
  return typeof header === 'string' && header ? header : null;
}

export function getAllowedModels(raw = process.env.OPEN_WEIGHT_MODELS_JSON) {
  if (!raw) return DEFAULT_MODELS;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('OPEN_WEIGHT_MODELS_JSON is not valid JSON');
  }
  if (!Array.isArray(value) || !value.length) throw new Error('OPEN_WEIGHT_MODELS_JSON must be a nonempty array');
  const ids = new Set();
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid model registry entry');
    for (const key of ['id', 'model', 'revision', 'precision']) {
      if (typeof entry[key] !== 'string' || !entry[key].trim()) throw new Error(`Missing model ${key}`);
    }
    if (ids.has(entry.id)) throw new Error(`Duplicate model id: ${entry.id}`);
    ids.add(entry.id);
    const providerOnly = entry.providerOnly ?? null;
    if (providerOnly !== null && (!Array.isArray(providerOnly) || !providerOnly.length || providerOnly.some((name) => typeof name !== 'string' || !name.trim()))) {
      throw new Error('Invalid providerOnly');
    }
    for (const key of ['inputCostPerToken', 'outputCostPerToken']) {
      if (entry[key] !== undefined && (!Number.isFinite(entry[key]) || entry[key] < 0)) throw new Error(`Invalid ${key}`);
    }
    const transport = entry.transport ?? 'gateway';
    if (!['gateway', 'openai-compatible'].includes(transport)) throw new Error('Invalid model transport');
    if (entry.supportsTools !== undefined && typeof entry.supportsTools !== 'boolean') throw new Error('Invalid supportsTools');
    let endpoint = null;
    let runtimeModel = null;
    if (transport === 'openai-compatible') {
      if (typeof entry.endpoint !== 'string' || typeof entry.runtimeModel !== 'string' || !entry.runtimeModel.trim()) {
        throw new Error('OpenAI-compatible models require endpoint and runtimeModel');
      }
      let url;
      try { url = new URL(entry.endpoint); } catch { throw new Error('Invalid model endpoint'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash
        || !(url.hostname.endsWith('.hf.space') || url.hostname.endsWith('.endpoints.huggingface.cloud'))) {
        throw new Error('Model endpoint is not an approved Hugging Face host');
      }
      endpoint = url.origin;
      runtimeModel = entry.runtimeModel.trim();
    }
    return {
      id: entry.id,
      model: entry.model,
      revision: entry.revision,
      precision: entry.precision,
      inputCostPerToken: entry.inputCostPerToken ?? null,
      outputCostPerToken: entry.outputCostPerToken ?? null,
      providerOnly,
      transport,
      endpoint,
      runtimeModel,
      supportsTools: entry.supportsTools ?? transport === 'gateway'
    };
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateLabRequest(body, models) {
  if (!isPlainObject(body)) throw new Error('Request body must be an object');
  const allowedKeys = new Set(['modelId', 'messages', 'tools', 'maxTokens', 'temperature']);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) throw new Error('Unknown request field');
  const model = models.find((entry) => entry.id === body.modelId);
  if (!model) throw new Error('Unknown modelId');
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 50) throw new Error('messages must contain 1–50 items');
  const messages = body.messages.map((message) => {
    if (!isPlainObject(message) || !['system', 'user', 'assistant', 'tool'].includes(message.role)) throw new Error('Invalid message');
    if (typeof message.content !== 'string' || message.content.length > 20000) throw new Error('Invalid message content');
    return { role: message.role, content: message.content };
  });
  const tools = body.tools ?? [];
  if (!Array.isArray(tools) || tools.length > 20) throw new Error('tools must contain at most 20 items');
  for (const tool of tools) {
    if (!isPlainObject(tool) || tool.type !== 'function' || !isPlainObject(tool.function)
      || typeof tool.function.name !== 'string' || !tool.function.name
      || typeof tool.function.description !== 'string' || !isPlainObject(tool.function.parameters)) {
      throw new Error('Invalid tool definition');
    }
  }
  if (tools.length && !model.supportsTools) throw new Error('Selected model does not support tools');
  const maxTokens = body.maxTokens ?? 512;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 2048) throw new Error('maxTokens must be 1–2048');
  const temperature = body.temperature ?? 0;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error('temperature must be 0–2');
  return { model, messages, tools, maxTokens, temperature };
}

export function getUpstreamRequest(request, req, env = process.env) {
  if (request.model.transport === 'openai-compatible') {
    if (!env.HUGGING_FACE_TOKEN || !env.OPEN_WEIGHT_RUNTIME_KEY) {
      throw new Error('Open-weight runtime authentication is unavailable');
    }
    return {
      url: `${request.model.endpoint}/v1/chat/completions`,
      headers: {
        Authorization: `Bearer ${env.HUGGING_FACE_TOKEN}`,
        'Content-Type': 'application/json',
        'x-runtime-key': env.OPEN_WEIGHT_RUNTIME_KEY
      },
      body: {
        model: request.model.runtimeModel,
        messages: request.messages,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        stream: false
      }
    };
  }
  const gatewayKey = getGatewayToken(req, env);
  if (!gatewayKey) throw new Error('AI Gateway authentication is unavailable');
  return {
    url: 'https://ai-gateway.vercel.sh/v1/chat/completions',
    headers: { Authorization: `Bearer ${gatewayKey}`, 'Content-Type': 'application/json' },
    body: {
      model: request.model.model,
      messages: request.messages,
      tools: request.tools.length ? request.tools : undefined,
      tool_choice: request.tools.length ? 'auto' : undefined,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: false,
      reasoning: { effort: 'none', enabled: false },
      chat_template_kwargs: { enable_thinking: false },
      providerOptions: request.model.providerOnly ? { gateway: { only: request.model.providerOnly } } : undefined
    }
  };
}

async function authenticate(req) {
  const token = parseBearer(req.headers.authorization);
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!token || !supabaseUrl || !supabaseAnonKey) return null;
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data, error } = await client.auth.getUser(token);
  return error ? null : data.user;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (!['GET', 'POST'].includes(req.method)) {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }
  const user = await authenticate(req);
  if (!user) {
    json(res, 401, { error: 'Authentication required' });
    return;
  }
  let models;
  try {
    models = getAllowedModels();
  } catch (error) {
    console.error('[open-weight-chat] invalid registry', error instanceof Error ? error.message : error);
    json(res, 500, { error: 'Model registry is invalid' });
    return;
  }
  if (req.method === 'GET') {
    json(res, 200, { models });
    return;
  }
  let request;
  try {
    request = validateLabRequest(req.body, models);
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : 'Invalid request' });
    return;
  }
  let upstreamRequestConfig;
  try {
    upstreamRequestConfig = getUpstreamRequest(request, req);
  } catch (error) {
    json(res, 503, { error: error instanceof Error ? error.message : 'Model authentication is unavailable' });
    return;
  }
  const startedAt = performance.now();
  let upstream;
  try {
    upstream = await fetch(upstreamRequestConfig.url, {
      method: 'POST',
      headers: upstreamRequestConfig.headers,
      signal: AbortSignal.timeout(240000),
      redirect: 'error',
      body: JSON.stringify(upstreamRequestConfig.body)
    });
  } catch (error) {
    console.error('[open-weight-chat] Gateway request failed', error instanceof Error ? error.name : error);
    json(res, 502, { error: 'Model request failed' });
    return;
  }
  if (!upstream.ok) {
    console.error('[open-weight-chat] Gateway returned', upstream.status);
    if (upstream.status === 429) {
      const retryAfter = upstream.headers.get('retry-after');
      if (retryAfter) res.setHeader('Retry-After', retryAfter);
      json(res, 429, { error: 'Model provider is rate limited; retry shortly' });
      return;
    }
    json(res, 502, { error: `Model provider returned HTTP ${upstream.status}` });
    return;
  }
  let payload;
  try {
    payload = await upstream.json();
  } catch {
    json(res, 502, { error: 'Model provider returned invalid JSON' });
    return;
  }
  const choice = payload.choices?.[0];
  if (!choice?.message || typeof choice.finish_reason !== 'string') {
    json(res, 502, { error: 'Model provider returned an unsupported response' });
    return;
  }
  const inputTokens = Number.isInteger(payload.usage?.prompt_tokens) ? payload.usage.prompt_tokens : null;
  const outputTokens = Number.isInteger(payload.usage?.completion_tokens) ? payload.usage.completion_tokens : null;
  const hasCost = inputTokens !== null && outputTokens !== null
    && request.model.inputCostPerToken !== null && request.model.outputCostPerToken !== null;
  json(res, 200, {
    variant: {
      id: request.model.id,
      requestedModel: request.model.model,
      revision: request.model.revision,
      precision: request.model.precision,
      providerOnly: request.model.providerOnly,
      transport: request.model.transport
    },
    responseModel: typeof payload.model === 'string' ? payload.model : null,
    message: choice.message,
    finishReason: choice.finish_reason,
    usage: inputTokens === null || outputTokens === null ? null : { inputTokens, outputTokens },
    costUsd: hasCost
      ? inputTokens * request.model.inputCostPerToken + outputTokens * request.model.outputCostPerToken
      : null,
    latencyMs: performance.now() - startedAt
  });
}
