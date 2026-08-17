import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { normalizeChatModel, OPENAI_MODELS } from '../../../shared/openai-models.ts';
import {
  createFixedRoute,
  estimateTextCost,
  heuristicRouteSignals,
  isChatRoutingModel,
  ROUTE_SIGNALS_JSON_SCHEMA,
  ROUTING_CLASSIFIER_INSTRUCTIONS,
  reconcileRouteSignals,
  resolveRouteFromSignals,
  type ChatRouteDecision,
  type ChatRoutingModel,
  type ChatTaskType,
  type RouteSignals
} from '../../../shared/model-routing.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_BASE_URL = Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase service role credentials are missing');
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type Usage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

async function hashIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function usageFromResponse(json: unknown): Usage {
  const usage = asRecord(asRecord(json).usage);
  const inputDetails = asRecord(usage.input_tokens_details);
  const inputTokens = Number(usage.input_tokens) || 0;
  const outputTokens = Number(usage.output_tokens) || 0;
  return {
    inputTokens,
    cachedInputTokens: Number(inputDetails.cached_tokens) || 0,
    outputTokens,
    totalTokens: Number(usage.total_tokens) || inputTokens + outputTokens
  };
}

function latestUserText(input: unknown[]): string {
  const item = asRecord([...input].reverse().find((entry) => asRecord(entry).role === 'user'));
  if (typeof item.content === 'string') return item.content;
  if (!Array.isArray(item.content)) return '';
  return item.content
    .map(asRecord)
    .filter((part) => part.type === 'input_text' || part.type === 'text')
    .map((part) => typeof part.text === 'string' ? part.text : '')
    .join('\n');
}

function outputText(json: unknown): string {
  const root = asRecord(json);
  if (typeof root.output_text === 'string') return root.output_text;
  return (Array.isArray(root.output) ? root.output : [])
    .map(asRecord)
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map(asRecord)
    .filter((content) => content.type === 'output_text')
    .map((content) => typeof content.text === 'string' ? content.text : '')
    .join('');
}

function normalizeSignals(rawValue: unknown, fallback: RouteSignals): RouteSignals {
  const raw = asRecord(rawValue);
  const taskTypes: ChatTaskType[] = ['classification', 'transformation', 'grounded_answer', 'tool_use', 'analysis', 'high_stakes'];
  return {
    taskType: taskTypes.includes(raw?.task_type) ? raw.task_type : fallback.taskType,
    complexity: Math.min(1, Math.max(0, Number(raw?.complexity) || fallback.complexity)),
    confidence: Math.min(1, Math.max(0, Number(raw?.confidence) || fallback.confidence)),
    requiresTools: typeof raw?.requires_tools === 'boolean' ? raw.requires_tools : fallback.requiresTools,
    consequential: typeof raw?.consequential === 'boolean' ? raw.consequential : fallback.consequential
  };
}

async function classifyTurn(params: {
  text: string;
  taskContext: string;
  tools: unknown[];
  safetyIdentifier: string;
}): Promise<{ signals: RouteSignals; latencyMs: number; costUsd: number; usage: Usage; model: string }> {
  const model = OPENAI_MODELS.chat.nano;
  const fallback = heuristicRouteSignals(params.text, params.tools.length > 0);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        instructions: ROUTING_CLASSIFIER_INSTRUCTIONS,
        input: [{
          role: 'user',
          content: `Agent task context:\n${params.taskContext.slice(0, 2400) || 'General assistant'}\n\nAvailable tools: ${params.tools.map((tool) => asRecord(tool).name).filter((name): name is string => typeof name === 'string').join(', ') || 'none'}\n\nCurrent user task:\n${params.text}`
        }],
        reasoning: { effort: 'none' },
        text: {
          format: {
            type: 'json_schema',
            name: 'route_signals',
            strict: true,
            schema: ROUTE_SIGNALS_JSON_SCHEMA
          }
        },
        max_output_tokens: 180,
        safety_identifier: params.safetyIdentifier,
        store: false
      })
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json?.error?.message || 'Router request failed');
    const usage = usageFromResponse(json);
    return {
      signals: reconcileRouteSignals(params.text, normalizeSignals(JSON.parse(outputText(json)), fallback)),
      latencyMs: Date.now() - startedAt,
      costUsd: estimateTextCost(model, usage.inputTokens, usage.outputTokens, usage.cachedInputTokens),
      usage,
      model
    };
  } catch (error) {
    console.warn('[responses-chat] Model router failed; using deterministic policy', error);
    return {
      signals: fallback,
      latencyMs: Date.now() - startedAt,
      costUsd: 0,
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
      model
    };
  }
}

function stickyRoute(rawValue: unknown, turnId: string): ChatRouteDecision | null {
  const value = asRecord(rawValue);
  if (!value || value.turnId !== turnId || !isChatRoutingModel(value.model)) return null;
  const signals = normalizeSignals({
    task_type: value.taskType,
    complexity: Number(value.complexity) || 0,
    confidence: Number(value.confidence) || 0,
    requires_tools: Boolean(value.requiresTools),
    consequential: Boolean(value.consequential)
  }, heuristicRouteSignals('', false));
  const route = resolveRouteFromSignals(signals, turnId);
  const efforts = ['none', 'low', 'medium', 'high'];
  return {
    ...route,
    model: value.model,
    reasoningEffort: efforts.includes(String(value.reasoningEffort))
      ? value.reasoningEffort as ChatRouteDecision['reasoningEffort']
      : route.reasoningEffort,
    reasonCode: typeof value.reasonCode === 'string' ? value.reasonCode : route.reasonCode,
    reason: typeof value.reason === 'string' ? value.reason : route.reason,
    routerModel: typeof value.routerModel === 'string' ? value.routerModel : undefined,
    routerLatencyMs: Number(value.routerLatencyMs) || 0,
    routerCostUsd: Number(value.routerCostUsd) || 0
  };
}

async function persistUsage(params: {
  userId: string;
  sessionId: string | null;
  agentId: string;
  route: ChatRouteDecision;
  answerUsage: Usage;
  answerCostUsd: number;
  answerLatencyMs: number;
  routerUsage?: Usage;
}) {
  const metadata = {
    chat_session_id: params.sessionId,
    agent_preset_id: params.agentId,
    turn_id: params.route.turnId,
    routing_strategy: params.route.strategy,
    selected_model: params.route.model,
    task_type: params.route.taskType,
    reasoning_effort: params.route.reasoningEffort,
    policy_version: params.route.policyVersion
  };
  if (params.routerUsage && (params.routerUsage.totalTokens > 0 || (params.route.routerCostUsd || 0) > 0)) {
    await adminClient.from('va_usage_events').insert({
      user_id: params.userId,
      source: 'chat',
      model: params.route.routerModel || OPENAI_MODELS.chat.nano,
      input_tokens: params.routerUsage.inputTokens,
      output_tokens: params.routerUsage.outputTokens,
      total_tokens: params.routerUsage.totalTokens,
      cost_usd: params.route.routerCostUsd || 0,
      metadata: { ...metadata, usage_kind: 'router' }
    });
  }
  await adminClient.from('va_usage_events').insert({
    user_id: params.userId,
    source: 'chat',
    model: params.route.model,
    input_tokens: params.answerUsage.inputTokens,
    output_tokens: params.answerUsage.outputTokens,
    total_tokens: params.answerUsage.totalTokens,
    cost_usd: params.answerCostUsd,
    metadata: {
      ...metadata,
      usage_kind: 'answer',
      cached_input_tokens: params.answerUsage.cachedInputTokens,
      answer_latency_ms: params.answerLatencyMs
    }
  });

  const { data: existing } = await adminClient
    .from('va_model_routing_events')
    .select('answer_latency_ms,answer_cost_usd,input_tokens,cached_input_tokens,output_tokens,response_count')
    .eq('turn_id', params.route.turnId)
    .maybeSingle();
  await adminClient.from('va_model_routing_events').upsert({
    user_id: params.userId,
    session_id: params.sessionId,
    agent_config_id: params.agentId,
    turn_id: params.route.turnId,
    strategy: params.route.strategy,
    selected_model: params.route.model,
    task_type: params.route.taskType,
    reasoning_effort: params.route.reasoningEffort,
    reason_code: params.route.reasonCode,
    reason: params.route.reason,
    confidence: params.route.confidence,
    complexity: params.route.complexity,
    requires_tools: params.route.requiresTools,
    consequential: params.route.consequential,
    policy_version: params.route.policyVersion,
    router_model: params.route.routerModel || null,
    router_latency_ms: params.route.routerLatencyMs || 0,
    router_cost_usd: params.route.routerCostUsd || 0,
    answer_latency_ms: Number(existing?.answer_latency_ms || 0) + params.answerLatencyMs,
    answer_cost_usd: Number(existing?.answer_cost_usd || 0) + params.answerCostUsd,
    input_tokens: Number(existing?.input_tokens || 0) + params.answerUsage.inputTokens,
    cached_input_tokens: Number(existing?.cached_input_tokens || 0) + params.answerUsage.cachedInputTokens,
    output_tokens: Number(existing?.output_tokens || 0) + params.answerUsage.outputTokens,
    response_count: Number(existing?.response_count || 0) + 1,
    updated_at: new Date().toISOString()
  }, { onConflict: 'turn_id' });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return new Response('Authentication required', { status: 401, headers: corsHeaders });
    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData.user) return new Response('Invalid session', { status: 401, headers: corsHeaders });
    const { data: vaUser } = await adminClient.from('va_users').select('id').eq('auth_user_id', authData.user.id).maybeSingle();
    if (!vaUser) return new Response('User profile not found', { status: 403, headers: corsHeaders });

    const body = await req.json();
    if (!body?.agent_id || !Array.isArray(body?.input)) {
      return new Response('agent_id and input are required', { status: 400, headers: corsHeaders });
    }
    const { data: agent, error: agentError } = await adminClient
      .from('va_agent_configs')
      .select('id,user_id,instructions,chat_model,model,max_response_output_tokens,a2ui_enabled')
      .eq('id', body.agent_id)
      .eq('user_id', vaUser.id)
      .maybeSingle();
    if (agentError) throw agentError;
    if (!agent) return new Response('Agent configuration not found', { status: 404, headers: corsHeaders });

    const turnId = typeof body.turn_id === 'string' ? body.turn_id : crypto.randomUUID();
    const sessionId = typeof body.session_id === 'string' ? body.session_id : null;
    const strategy = body.routing_strategy === 'auto' ? 'auto' : 'fixed';
    const configuredModel = normalizeChatModel(agent.chat_model || agent.model || OPENAI_MODELS.chat.default);
    const fixedModel: ChatRoutingModel = isChatRoutingModel(body.fixed_model)
      ? body.fixed_model
      : isChatRoutingModel(configuredModel) ? configuredModel : OPENAI_MODELS.chat.default;
    const safetyIdentifier = await hashIdentifier(vaUser.id);
    let routerUsage: Usage | undefined;
    let route = stickyRoute(body.route_decision, turnId);
    if (!route) {
      if (strategy === 'auto') {
        const classified = await classifyTurn({
          text: latestUserText(body.input),
          taskContext: typeof agent.instructions === 'string' ? agent.instructions : '',
          tools: Array.isArray(body.tools) ? body.tools : [],
          safetyIdentifier
        });
        route = {
          ...resolveRouteFromSignals(classified.signals, turnId),
          routerModel: classified.model,
          routerLatencyMs: classified.latencyMs,
          routerCostUsd: classified.costUsd
        };
        routerUsage = classified.usage;
      } else {
        route = createFixedRoute(fixedModel, turnId);
      }
    }

    const instructions = [
      agent.instructions,
      'Always reply in English unless the user explicitly asks for another language.',
      'Format normal responses with GitHub-flavored Markdown. Use Markdown tables for comparisons. When tool or catalog data contains image, image_url, featured_image, or images fields, show the first valid absolute image asset with ![descriptive product name](DIRECT_IMAGE_URL). Use only a direct image URL returned by the tool; never invent one. A storefront, product, or collection webpage URL is a link, not an image, and must remain in a separate Shop or Link field.',
      agent.a2ui_enabled
        ? 'When interactive UI is useful, you may return {"a2ui":{"version":"0.8","ui":<tree>},"fallback_text":"..."}. Supported components are Card, Text, Button, Input, Select, Form, Map, Calendar, Image, and Table.'
        : null,
      body.instructions_suffix
    ].filter(Boolean).join('\n\n');
    const payload: Record<string, unknown> = {
      model: route.model,
      instructions,
      input: body.input,
      tools: Array.isArray(body.tools) && body.tools.length ? body.tools : undefined,
      max_output_tokens: Math.min(Math.max(agent.max_response_output_tokens || 1024, 1), 8000),
      reasoning: { effort: route.reasoningEffort },
      text: { verbosity: 'low' },
      safety_identifier: safetyIdentifier,
      store: false
    };
    const answerStartedAt = Date.now();
    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(payload)
    });
    const json = await response.json();
    if (!response.ok) {
      return new Response(JSON.stringify(json), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const answerLatencyMs = Date.now() - answerStartedAt;
    const answerUsage = usageFromResponse(json);
    const answerCostUsd = estimateTextCost(route.model, answerUsage.inputTokens, answerUsage.outputTokens, answerUsage.cachedInputTokens);
    route = {
      ...route,
      answerLatencyMs,
      answerCostUsd,
      inputTokens: answerUsage.inputTokens,
      cachedInputTokens: answerUsage.cachedInputTokens,
      outputTokens: answerUsage.outputTokens
    };
    await persistUsage({
      userId: vaUser.id,
      sessionId,
      agentId: agent.id,
      route,
      answerUsage,
      answerCostUsd,
      answerLatencyMs,
      routerUsage
    });

    return new Response(JSON.stringify({ ...json, _routing: route }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[responses-chat]', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Responses request failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
