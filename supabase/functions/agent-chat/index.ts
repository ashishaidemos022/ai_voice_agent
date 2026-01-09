import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_BASE_URL = Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
const MCP_API_BASE_URL = Deno.env.get('MCP_API_BASE_URL') || 'https://voiceaiagent.vercel.app';
const MAX_TOOL_ITERATIONS = Number(Deno.env.get('AGENT_CHAT_MAX_TOOL_ITERATIONS') || 4);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase service role environment variables are not configured');
}

if (!OPENAI_API_KEY) {
  console.warn('[agent-chat] OPENAI_API_KEY is not configured. Requests will fail.');
}

type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type ChatMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
};

type UsageTotals = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

type ModelPricing = {
  inputPer1K: number;
  outputPer1K: number;
};

const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-realtime': { inputPer1K: 0.005, outputPer1K: 0.015 },
  'gpt-4o-realtime-preview-2024-12-17': { inputPer1K: 0.005, outputPer1K: 0.015 },
  'gpt-4.1-mini': { inputPer1K: 0.00015, outputPer1K: 0.0006 }
};

function mergeUsage(base: UsageTotals, next?: Partial<UsageTotals> | null): UsageTotals {
  if (!next) return base;
  return {
    prompt_tokens: base.prompt_tokens + (next.prompt_tokens || 0),
    completion_tokens: base.completion_tokens + (next.completion_tokens || 0),
    total_tokens: base.total_tokens + (next.total_tokens || 0)
  };
}

function estimateUsageCost(model: string, usage: UsageTotals) {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (usage.prompt_tokens / 1000) * pricing.inputPer1K + (usage.completion_tokens / 1000) * pricing.outputPer1K;
}

type AgentChatPayload = {
  public_id: string;
  messages: ChatMessage[];
  session_id?: string;
  client_session_id?: string;
};

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type LoadedTool = {
  name: string;
  source: 'mcp' | 'n8n';
  definition: {
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters: Record<string, any>;
    };
  };
  connectionId?: string | null;
  integration?: {
    id: string;
    webhook_url: string;
    http_method: 'POST' | 'PUT' | 'PATCH';
    custom_headers: Record<string, string>;
    secret?: string | null;
    forward_session_context: boolean;
    enabled: boolean;
  } | null;
  metadata?: Record<string, any>;
};

function normalizeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
  } catch {
    return value;
  }
}

function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  if (!origin) return false;

  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  return allowed.some((stored) => {
    if (stored === '*') return true;

    const normalizedStored = normalizeOrigin(stored);
    if (!normalizedStored) return false;

    if (normalizedStored === normalized) return true;

    try {
      const incomingHost = new URL(normalized).hostname;
      const storedHost = new URL(normalizedStored).hostname;
      return incomingHost === storedHost;
    } catch {
      return normalizedStored === normalized;
    }
  });
}

function buildSystemPrompt(instructions?: string | null) {
  return instructions?.trim() || 'You are a helpful AI assistant. Respond concisely and helpfully.';
}

function summarizeTools(tools: LoadedTool[]) {
  const mcpCount = tools.filter((tool) => tool.source === 'mcp').length;
  const n8nCount = tools.filter((tool) => tool.source === 'n8n').length;
  return {
    total: tools.length,
    mcp: mcpCount,
    n8n: n8nCount,
    names: tools.slice(0, 15).map((tool) => tool.name)
  };
}

async function buildEmbedResponse(embed: any, includeToolSummary: boolean) {
  const response: Record<string, any> = {
    public_id: embed.public_id,
    source: embed.embed_type || 'chat',
    agent: {
      id: embed.agent_config?.id || null,
      name: embed.agent_config?.name || 'AI Agent',
      summary: embed.agent_config?.summary || null,
      rag_enabled: embed.agent_config?.rag_enabled ?? false,
      rag_mode: embed.agent_config?.rag_mode || 'assist',
      rag_default_model: embed.agent_config?.rag_default_model || null,
      knowledge_spaces: (embed.agent_config?.knowledge_spaces || []).map((binding: any) => ({
        space_id: binding.space_id,
        vector_store_id: binding.rag_space?.vector_store_id || null
      }))
    },
    settings: {
      allowed_origins: embed.allowed_origins || [],
      appearance: {
        logo_url: embed.logo_url ?? null,
        brand_name: embed.brand_name ?? null,
        accent_color: embed.accent_color ?? null,
        background_color: embed.background_color ?? null,
        surface_color: embed.surface_color ?? null,
        text_color: embed.text_color ?? null,
        button_color: embed.button_color ?? null,
        button_text_color: embed.button_text_color ?? null,
        helper_text_color: embed.helper_text_color ?? null,
        corner_radius: embed.corner_radius ?? null,
        font_family: embed.font_family ?? null,
        wave_color: embed.wave_color ?? null,
        bubble_color: embed.bubble_color ?? null,
        logo_background_color: embed.logo_background_color ?? null,
        widget_width: embed.widget_width ?? null,
        widget_height: embed.widget_height ?? null,
        button_image_url: embed.button_image_url ?? null
      }
    }
  };

  if (includeToolSummary && embed.agent_config?.id && embed.agent_config?.user_id) {
    const tools = await loadAgentTools(embed.agent_config.id, embed.agent_config.user_id);
    response.tools = summarizeTools(tools);
  }

  return response;
}

function normalizeToolCallArgs(toolName: string, args: any) {
  if (toolName !== 'execute_sql') {
    return args;
  }

  if (typeof args === 'string') {
    return { query: args };
  }

  if (!args || typeof args !== 'object') {
    return { query: '' };
  }

  const normalizedQuery = args.query || args.statement || args.sql || '';
  const sanitized: Record<string, any> = { ...args };
  delete sanitized.sql;
  delete sanitized.statement;
  delete sanitized.query;

  return {
    ...sanitized,
    query: typeof normalizedQuery === 'string' ? normalizedQuery : String(normalizedQuery)
  };
}

function buildN8NSchema(metadata?: Record<string, any>) {
  const payloadParameters = Array.isArray(metadata?.payloadParameters)
    ? metadata?.payloadParameters
    : [];

  if (!payloadParameters.length) {
    return {
      type: 'object',
      additionalProperties: true
    };
  }

  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const param of payloadParameters) {
    if (!param?.key) continue;
    properties[param.key] = {
      type: param.type || 'string',
      description: param.description || undefined
    };
    if (param.required) {
      required.push(param.key);
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length ? required : undefined,
    additionalProperties: true
  };
}

function buildFunctionTool(
  name: string,
  description: string | undefined,
  parameters: Record<string, any>
) {
  const normalizedParams =
    parameters && typeof parameters === 'object'
      ? {
          type: parameters.type || 'object',
          properties: parameters.properties || {},
          required: parameters.required,
          additionalProperties:
            parameters.additionalProperties === undefined ? true : parameters.additionalProperties
        }
      : {
          type: 'object',
          properties: {},
          additionalProperties: true
        };

  return {
    type: 'function' as const,
    function: {
      name,
      description,
      parameters: normalizedParams
    }
  };
}

async function loadAgentTools(agentConfigId: string, userId: string): Promise<LoadedTool[]> {
  const { data: selections, error } = await adminClient
    .from('va_agent_config_tools')
    .select('tool_name, tool_source, tool_id, connection_id, n8n_integration_id, metadata')
    .eq('config_id', agentConfigId);

  if (error) {
    console.warn('[agent-chat] Failed to load tool selections', error);
    return [];
  }
  if (!selections?.length) {
    return loadDefaultTools(agentConfigId, userId);
  }

  const toolIds = selections
    .map((row) => row.tool_id)
    .filter((id): id is string => Boolean(id));
  const connectionIds = Array.from(
    new Set(
      selections
        .map((row) => row.connection_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const integrationIds = Array.from(
    new Set(
      selections
        .map((row) => row.n8n_integration_id)
        .filter((id): id is string => Boolean(id))
    )
  );

  const [mcpToolsResponse, n8nResponse] = await Promise.all([
    toolIds.length
      ? adminClient
          .from('va_mcp_tools')
          .select('id, tool_name, description, parameters_schema, connection_id')
          .in('id', toolIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    integrationIds.length
      ? adminClient
          .from('va_n8n_integrations')
          .select(
            'id, webhook_url, http_method, custom_headers, secret, forward_session_context, enabled'
          )
          .in('id', integrationIds)
      : Promise.resolve({ data: [] as any[], error: null })
  ]);

  if (mcpToolsResponse.error) {
    console.warn('[agent-chat] Failed to load MCP tool definitions', mcpToolsResponse.error);
  }
  if (n8nResponse.error) {
    console.warn('[agent-chat] Failed to load n8n integrations', n8nResponse.error);
  }

  const mcpToolsById = new Map(
    (mcpToolsResponse.data || []).map((tool: any) => [tool.id, tool])
  );
  const n8nById = new Map(
    (n8nResponse.data || []).map((integration: any) => [integration.id, integration])
  );

  const tools: LoadedTool[] = [];

  for (const row of selections) {
    if (row.tool_source === 'mcp' && row.tool_id && row.connection_id) {
      const toolRow = mcpToolsById.get(row.tool_id);
      if (!toolRow) continue;
      const definition = buildFunctionTool(
        row.tool_name,
        toolRow.description || undefined,
        toolRow.parameters_schema || { type: 'object', additionalProperties: true }
      );
      tools.push({
        name: row.tool_name,
        source: 'mcp',
        definition,
        connectionId: row.connection_id,
        metadata: row.metadata || {}
      });
    } else if (row.tool_source === 'n8n' && row.n8n_integration_id) {
      const integration = n8nById.get(row.n8n_integration_id);
      if (!integration || !integration.enabled) continue;
      tools.push({
        name: row.tool_name,
        source: 'n8n',
        definition: buildFunctionTool(
          row.tool_name,
          'Trigger connected n8n workflow',
          buildN8NSchema(row.metadata || {})
        ),
        integration,
        metadata: row.metadata || {}
      });
    }
  }

  return tools;
}

async function loadDefaultTools(agentConfigId: string, userId: string): Promise<LoadedTool[]> {
  const [mcpToolsResp, n8nResp] = await Promise.all([
    adminClient
      .from('va_mcp_tools')
      .select(
        `
        id,
        tool_name,
        description,
        parameters_schema,
        connection_id,
        is_enabled,
        connection:va_mcp_connections!inner ( id, user_id, is_enabled )
      `
      )
      .eq('is_enabled', true)
      .eq('connection.user_id', userId)
      .eq('connection.is_enabled', true),
    adminClient
      .from('va_n8n_integrations')
      .select(
        'id, webhook_url, http_method, custom_headers, secret, forward_session_context, enabled'
      )
      .eq('config_id', agentConfigId)
  ]);

  if (mcpToolsResp.error) {
    console.warn('[agent-chat] Failed to load default MCP tools', mcpToolsResp.error);
  }
  if (n8nResp.error) {
    console.warn('[agent-chat] Failed to load default n8n integrations', n8nResp.error);
  }

  const tools: LoadedTool[] = [];

  (mcpToolsResp.data || []).forEach((tool: any) => {
    if (!tool.connection_id || !tool.connection?.is_enabled) return;
    tools.push({
      name: tool.tool_name,
      source: 'mcp',
      definition: buildFunctionTool(
        tool.tool_name,
        tool.description || undefined,
        tool.parameters_schema || { type: 'object', additionalProperties: true }
      ),
      connectionId: tool.connection_id,
      metadata: {}
    });
  });

  (n8nResp.data || []).forEach((integration: any) => {
    if (!integration.enabled) return;
    tools.push({
      name: integration.name || `n8n_${integration.id}`,
      source: 'n8n',
      definition: buildFunctionTool(
        integration.name || `n8n_${integration.id}`,
        'Trigger connected n8n workflow',
        { type: 'object', additionalProperties: true }
      ),
      integration,
      metadata: {}
    });
  });

  return tools;
}

async function signPayload(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const payloadData = encoder.encode(body);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, payloadData);
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function executeN8NIntegration(params: {
  integration: Required<LoadedTool>['integration'];
  payload: Record<string, any>;
  sessionId: string;
  agentId: string;
  userId: string;
}) {
  const integration = params.integration;
  if (!integration) {
    throw new Error('n8n integration missing');
  }

  const envelope: Record<string, any> = {
    payload: params.payload,
    summary: `Agent ${params.agentId} tool call`,
    severity: 'low',
    metadata: {
      agent_config_id: params.agentId,
      session_id: params.sessionId,
      triggered_at: new Date().toISOString()
    }
  };

  if (integration.forward_session_context) {
    envelope.session = {
      session_id: params.sessionId,
      agent_config_id: params.agentId,
      user_id: params.userId
    };
  }

  const body = JSON.stringify(envelope);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...integration.custom_headers
  };

  if (integration.secret) {
    headers['x-va-signature'] = `sha256=${await signPayload(integration.secret, body)}`;
  }

  const response = await fetch(integration.webhook_url, {
    method: integration.http_method || 'POST',
    headers,
    body
  });

  const text = await response.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // leave as string
  }

  if (!response.ok) {
    throw new Error(
      typeof parsed === 'string' ? parsed : parsed?.error || 'n8n webhook request failed'
    );
  }

  return parsed;
}

async function executeMcpTool(params: {
  connectionId: string;
  toolName: string;
  args: Record<string, any>;
  userId: string;
}) {
  const response = await fetch(`${MCP_API_BASE_URL.replace(/\/$/, '')}/api/mcp/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connection_id: params.connectionId,
      tool_name: params.toolName,
      parameters: params.args,
      user_id: params.userId
    })
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.success === false) {
    throw new Error(json?.error || 'MCP tool execution failed');
  }
  return json?.data ?? json?.result ?? json;
}

async function recordToolExecution(params: {
  sessionId: string;
  userId: string;
  toolName: string;
  input: Record<string, any>;
  output: any;
  status: 'success' | 'error';
  errorMessage?: string;
  executionType: 'mcp' | 'webhook';
}) {
  const { error } = await adminClient.from('va_tool_executions').insert({
    session_id: params.sessionId,
    user_id: params.userId,
    tool_name: params.toolName,
    input_params: params.input,
    output_result: params.output,
    status: params.status,
    error_message: params.errorMessage,
    execution_type: params.executionType,
    executed_at: new Date().toISOString()
  });
  if (error) {
    console.warn('[agent-chat] Failed to log tool execution', error);
  }
}

async function handleToolCalls(params: {
  toolCalls: OpenAIToolCall[];
  tools: LoadedTool[];
  sessionId: string;
  agentId: string;
  userId: string;
}) {
  const toolMap = new Map(params.tools.map((tool) => [tool.name, tool]));
  const toolMessages: ChatMessage[] = [];

  for (const call of params.toolCalls) {
    const toolMeta = toolMap.get(call.function.name);
    let parsedArgs: Record<string, any> = {};
    if (call.function.arguments) {
      try {
        parsedArgs = JSON.parse(call.function.arguments);
      } catch (err) {
        console.warn('[agent-chat] Failed to parse tool args', err);
      }
    }

    if (!toolMeta) {
      const errorPayload = { error: `Unknown tool: ${call.function.name}` };
      toolMessages.push({
        role: 'tool',
        name: call.function.name,
        tool_call_id: call.id,
        content: JSON.stringify(errorPayload)
      });
      await recordToolExecution({
        sessionId: params.sessionId,
        userId: params.userId,
        toolName: call.function.name,
        input: parsedArgs,
        output: errorPayload,
        status: 'error',
        errorMessage: 'Unknown tool',
        executionType: 'webhook'
      });
      continue;
    }

    let output: any = {};
    let status: 'success' | 'error' = 'success';
    let errorMessage: string | undefined;

    try {
      parsedArgs = normalizeToolCallArgs(call.function.name, parsedArgs);

      if (toolMeta.source === 'n8n' && toolMeta.integration) {
        output = await executeN8NIntegration({
          integration: toolMeta.integration,
          payload: parsedArgs.payload ?? parsedArgs,
          sessionId: params.sessionId,
          agentId: params.agentId,
          userId: params.userId
        });
      } else if (toolMeta.source === 'mcp' && toolMeta.connectionId) {
        output = await executeMcpTool({
          connectionId: toolMeta.connectionId,
          toolName: call.function.name,
          args: parsedArgs,
          userId: params.userId
        });
      } else {
        throw new Error('Tool metadata missing required connection info');
      }
    } catch (err: any) {
      status = 'error';
      errorMessage = err?.message || 'Tool execution failed';
      output = { error: errorMessage };
      console.error('[agent-chat] Tool execution failed', err);
    }

    await recordToolExecution({
      sessionId: params.sessionId,
      userId: params.userId,
      toolName: call.function.name,
      input: parsedArgs,
      output,
      status,
      errorMessage,
      executionType: toolMeta.source === 'mcp' ? 'mcp' : 'webhook'
    });

    toolMessages.push({
      role: 'tool',
      name: call.function.name,
      tool_call_id: call.id,
      content: typeof output === 'string' ? output : JSON.stringify(output ?? {})
    });
  }

  return toolMessages;
}

async function runAgenticAssistant(params: {
  model: string;
  temperature: number;
  chatMessages: ChatMessage[];
  maxTokens?: number;
  tools: LoadedTool[];
  sessionId: string;
  agentId: string;
  userId: string;
}) {
  const safeMaxIterations = Number.isFinite(MAX_TOOL_ITERATIONS) && MAX_TOOL_ITERATIONS > 0 ? MAX_TOOL_ITERATIONS : 4;
  let iteration = 0;
  let usageTotals: UsageTotals = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0
  };

  const recordAssistantMessage = (message: ChatMessage) => {
    params.chatMessages.push({
      role: 'assistant',
      content: message.content || '',
      tool_calls: message.tool_calls
    });
  };

  let result = await callOpenAI(
    params.model,
    params.temperature,
    params.chatMessages,
    params.maxTokens,
    params.tools
  );

  recordAssistantMessage(result.message);
  usageTotals = mergeUsage(usageTotals, result.usage as Partial<UsageTotals>);

  while (result.message.tool_calls?.length && iteration < safeMaxIterations) {
    iteration += 1;
    const toolMessages = await handleToolCalls({
      toolCalls: result.message.tool_calls,
      tools: params.tools,
      sessionId: params.sessionId,
      agentId: params.agentId,
      userId: params.userId
    });

    params.chatMessages.push(...toolMessages);

    result = await callOpenAI(
      params.model,
      params.temperature,
      params.chatMessages,
      params.maxTokens,
      params.tools
    );

    recordAssistantMessage(result.message);
    usageTotals = mergeUsage(usageTotals, result.usage as Partial<UsageTotals>);
  }

  if (result.message.tool_calls?.length) {
    throw new Error('Tool execution limit reached without completion');
  }

  return {
    message: result.message,
    usage: usageTotals
  };
}

async function fetchEmbed(publicId: string) {
  const baseSelect = `
    *,
    agent_config:va_agent_configs(
      id,
      user_id,
      name,
      summary,
      instructions,
      model,
      chat_model,
      temperature,
      max_response_output_tokens,
      rag_enabled,
      rag_mode,
      rag_default_model,
      knowledge_spaces:va_rag_agent_spaces (
        space_id,
        rag_space:va_rag_spaces (
          id,
          name,
          description,
          vector_store_id
        )
      )
    )
  `;

  const { data, error } = await adminClient
    .from('va_agent_embeds')
    .select(baseSelect)
    .eq('public_id', publicId)
    .eq('is_enabled', true)
    .single();

  if (data) {
    return { ...data, embed_type: 'chat' as const };
  }
  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  const { data: voiceData, error: voiceError } = await adminClient
    .from('va_voice_embeds')
    .select(baseSelect)
    .eq('public_id', publicId)
    .eq('is_enabled', true)
    .single();

  if (voiceData) {
    return { ...voiceData, embed_type: 'voice' as const };
  }
  if (voiceError && voiceError.code !== 'PGRST116') {
    throw voiceError;
  }
  return null;
}

async function ensureSession(params: {
  agentId: string;
  userId: string;
  embedId: string;
  publicId: string;
  sessionId?: string;
  clientSessionId?: string;
  embedType?: 'chat' | 'voice';
}) {
  if (params.sessionId) {
    const { data } = await adminClient
      .from('va_sessions')
      .select('id')
      .eq('id', params.sessionId)
      .eq('agent_id', params.agentId)
      .maybeSingle();

    if (data?.id) {
      return data.id;
    }
  }

  const metadata = {
    source: params.embedType === 'voice' ? 'voice-embed' : 'embed',
    embed_id: params.embedId,
    embed_public_id: params.publicId,
    client_session_id: params.clientSessionId || null
  };

  const { data, error } = await adminClient
    .from('va_sessions')
    .insert({
      agent_id: params.agentId,
      user_id: params.userId,
      status: 'active',
      session_metadata: metadata
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

async function logMessage(params: {
  sessionId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
}) {
  const { error } = await adminClient.from('va_messages').insert({
    session_id: params.sessionId,
    user_id: params.userId,
    role: params.role,
    content: params.content,
    timestamp: new Date().toISOString()
  });

  if (error) {
    console.warn('[agent-chat] Failed to log message', error);
  }
}

async function callOpenAI(
  model: string,
  temperature: number,
  messages: ChatMessage[],
  maxTokens?: number,
  tools?: LoadedTool[]
) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const cleanedMessages = messages.slice(-30).map((msg) => ({
    role: msg.role,
    content: msg.content,
    name: msg.name,
    tool_call_id: msg.tool_call_id,
    tool_calls: msg.tool_calls
  }));

  const toolDefs = tools?.length
    ? tools.map((tool) => tool.definition)
    : undefined;

  const payload = {
    model,
    temperature,
    max_tokens: Math.min(Math.max(maxTokens || 900, 1), 2000),
    messages: cleanedMessages,
    tools: toolDefs
  };

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json?.error?.message || 'Failed to fetch completion');
  }

  const message = json?.choices?.[0]?.message;
  if (!message) {
    throw new Error('Assistant returned empty response');
  }

  return {
    message: {
      role: message.role as ChatMessage['role'],
      content: (message.content || '').trim?.() || '',
      tool_calls: message.tool_calls || []
    },
    usage: json.usage
  };
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // Metadata fetch (for widget initialization)
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const publicId = url.searchParams.get('public_id');

      if (!publicId) {
        return new Response(JSON.stringify({ error: 'public_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const embed = await fetchEmbed(publicId);
      if (!embed) {
        return new Response(JSON.stringify({ error: 'Embed not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const includeTools = ['1', 'true', 'yes'].includes(
        (url.searchParams.get('include_tools') || '').toLowerCase()
      );
      const payload = await buildEmbedResponse(embed, includeTools);

      return new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = (await req.json()) as AgentChatPayload;

    if (!body?.public_id) {
      return new Response(JSON.stringify({ error: 'public_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const embed = await fetchEmbed(body.public_id);
    if (!embed) {
      return new Response(JSON.stringify({ error: 'Embed not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const originHeader = req.headers.get('origin') || req.headers.get('referer');
    if (!isOriginAllowed(originHeader, embed.allowed_origins || [])) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const agentConfig = embed.agent_config;
    if (!agentConfig) {
      return new Response(JSON.stringify({ error: 'Agent configuration missing' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const model = agentConfig.chat_model || agentConfig.model || 'gpt-4o-mini';
    const temperature = agentConfig.temperature ?? 0.7;

    const sessionId = await ensureSession({
      agentId: agentConfig.id,
      userId: agentConfig.user_id,
      embedId: embed.id,
      publicId: embed.public_id,
      sessionId: body.session_id,
      clientSessionId: body.client_session_id,
      embedType: embed.embed_type
    });

    const systemPrompt = buildSystemPrompt(agentConfig.instructions);
    const chatMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...body.messages
    ];
    const tools = await loadAgentTools(agentConfig.id, agentConfig.user_id);

    const assistantResult = await runAgenticAssistant({
      model,
      temperature,
      chatMessages,
      maxTokens: agentConfig.max_response_output_tokens || 900,
      tools,
      sessionId,
      agentId: agentConfig.id,
      userId: agentConfig.user_id
    });

    const assistantMessage = assistantResult.message;
    const finalContent = assistantMessage.content;

    if (!finalContent) {
      throw new Error('Assistant returned empty response');
    }

    const lastUser = [...body.messages].reverse().find((msg) => msg.role === 'user');

    if (lastUser?.content) {
      await logMessage({
        sessionId,
        userId: agentConfig.user_id,
        role: 'user',
        content: lastUser.content
      });
    }

    await logMessage({
      sessionId,
      userId: agentConfig.user_id,
      role: 'assistant',
      content: finalContent
    });

    const totalNewMessages = lastUser ? 2 : 1;

    const { data: existingSession } = await adminClient
      .from('va_sessions')
      .select('message_count')
      .eq('id', sessionId)
      .maybeSingle();

    const nextCount = (existingSession?.message_count || 0) + totalNewMessages;

    await adminClient
      .from('va_sessions')
      .update({
        message_count: nextCount,
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId);

    if (assistantResult.usage) {
      const usage = assistantResult.usage;
      const totalTokens = usage.total_tokens || usage.prompt_tokens + usage.completion_tokens;
      const costUsd = estimateUsageCost(model, {
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: totalTokens || 0
      });
      await adminClient.from('va_usage_events').insert({
        user_id: agentConfig.user_id,
        source: embed.embed_type === 'voice' ? 'embed_voice' : 'embed_chat',
        model,
        input_tokens: usage.prompt_tokens || 0,
        output_tokens: usage.completion_tokens || 0,
        total_tokens: totalTokens || 0,
        cost_usd: costUsd,
        metadata: {
          session_id: sessionId,
          embed_id: embed.id,
          embed_public_id: embed.public_id,
          agent_preset_id: agentConfig.id,
          embed_type: embed.embed_type
        }
      });
    }

    return new Response(
      JSON.stringify({
        assistant: { content: finalContent },
        session_id: sessionId
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[agent-chat] error', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
