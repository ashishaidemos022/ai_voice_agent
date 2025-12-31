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
const SUPPORTED_REALTIME_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar'
];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase service role credentials are missing');
}

if (!OPENAI_API_KEY) {
  console.warn('[voice-ephemeral-key] OPENAI_API_KEY not configured. Requests will fail.');
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type VoiceEmbedRecord = {
  id: string;
  public_id: string;
  allowed_origins: string[];
  rtc_enabled: boolean;
  tts_voice: string | null;
  is_enabled: boolean;
  logo_url?: string | null;
  brand_name?: string | null;
  accent_color?: string | null;
  background_color?: string | null;
  surface_color?: string | null;
  text_color?: string | null;
  button_color?: string | null;
  button_text_color?: string | null;
  helper_text_color?: string | null;
  corner_radius?: number | null;
  font_family?: string | null;
  wave_color?: string | null;
  bubble_color?: string | null;
  agent_config: {
    id: string;
    user_id: string;
    name: string;
    summary?: string | null;
    instructions?: string | null;
    voice?: string | null;
    model?: string | null;
    chat_model?: string | null;
    temperature?: number | null;
    max_response_output_tokens?: number | null;
    rag_enabled?: boolean | null;
    rag_mode?: 'assist' | 'guardrail' | null;
    rag_default_model?: string | null;
    knowledge_spaces?: {
      space_id: string;
      rag_space: {
        id: string;
        vector_store_id: string | null;
      } | null;
    }[];
  } | null;
};

type CreateSessionPayload = {
  public_id: string;
  client_session_id?: string;
};

type SerializedToolDefinition = {
  name: string;
  description?: string | null;
  parameters?: Record<string, any> | null;
  execution_type: 'mcp' | 'webhook';
  connection_id?: string | null;
  metadata?: Record<string, any> | null;
  source?: 'mcp' | 'n8n';
  owner_user_id?: string | null;
};

type ToolSelectionRow = {
  tool_name: string;
  tool_source: 'mcp' | 'n8n';
  tool_id: string | null;
  connection_id: string | null;
  n8n_integration_id: string | null;
  user_id?: string | null;
  metadata?: Record<string, any> | null;
};

function normalizeIdentifier(value: string | undefined | null): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildN8NToolName(name: string, id: string): string {
  const normalized = normalizeIdentifier(name) || 'n8n';
  const suffix = id.replace(/-/g, '').slice(-8);
  const truncated = normalized.slice(0, 30);
  return `trigger_n8n_${truncated}_${suffix}`;
}

const SELECTION_SENTINEL = '__none__';

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

function sanitizeVoice(raw: string | null | undefined): string {
  if (!raw) return 'alloy';
  const normalized = raw.toLowerCase();
  return SUPPORTED_REALTIME_VOICES.includes(normalized) ? normalized : 'alloy';
}

async function fetchVoiceEmbed(publicId: string): Promise<VoiceEmbedRecord | null> {
  const { data, error } = await adminClient
    .from('va_voice_embeds')
    .select(
      `
        *,
        agent_config:va_agent_configs(
          id,
          user_id,
          name,
          summary,
          instructions,
          voice,
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
              vector_store_id
            )
          )
        )
      `
    )
    .eq('public_id', publicId)
    .eq('is_enabled', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw error;
  }

  return data as VoiceEmbedRecord;
}

async function createEphemeralSession(
  agent: VoiceEmbedRecord,
  origin: string | null,
  tools: SerializedToolDefinition[]
) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set');
  }

  const agentConfig = agent.agent_config;
  if (!agentConfig) {
    throw new Error('Agent configuration missing for embed');
  }

  const model =
    agentConfig.model ||
    agentConfig.chat_model ||
    'gpt-4o-realtime-preview';
  const voice = sanitizeVoice(agent.tts_voice || agentConfig.voice);
  const openAiTools = (tools || []).map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description || undefined,
    parameters: tool.parameters || { type: 'object', properties: {}, additionalProperties: true }
  }));
  const body = {
    model,
    voice,
    instructions: agentConfig.instructions || undefined,
    input_audio_format: 'pcm16',
    output_audio_format: 'pcm16',
    modalities: ['text', 'audio'],
    turn_detection: {
      type: 'server_vad',
      threshold: 0.75,
      prefix_padding_ms: 150,
      silence_duration_ms: 700
    },
    temperature: agentConfig.temperature ?? 0.8,
    max_response_output_tokens: agentConfig.max_response_output_tokens ?? 1024,
    tools: openAiTools
  };

  const response = await fetch(`${OPENAI_BASE_URL}/realtime/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const sessionPayload = await response.json();
  if (!response.ok) {
    const message = sessionPayload?.error?.message || 'Failed to create realtime session';
    throw new Error(message);
  }

  const token = sessionPayload?.client_secret?.value;
  if (!token) {
    throw new Error('Realtime API did not return a client secret');
  }

  return {
    token,
    expires_at: sessionPayload?.client_secret?.expires_at,
    session: sessionPayload
  };
}

async function ensureSupabaseSession(agent: VoiceEmbedRecord, metadata: Record<string, any>) {
  if (!agent.agent_config) {
    throw new Error('Agent configuration missing for embed');
  }
  const insertPayload = {
    agent_id: agent.agent_config.id,
    user_id: agent.agent_config.user_id,
    status: 'active',
    session_metadata: metadata
  };
  const { data, error } = await adminClient
    .from('va_sessions')
    .insert(insertPayload)
    .select('id')
    .single();
  if (error) {
    throw error;
  }
  return data.id as string;
}

function buildWebhookSchema(metadata?: Record<string, any> | null): Record<string, any> {
  const payloadParams = (metadata?.payloadParameters || []) as
    | {
        key: string;
        label?: string;
        description?: string;
        type?: 'string' | 'number' | 'integer' | 'boolean';
        required?: boolean;
        example?: string;
      }[]
    | undefined;

  const customPayload: Record<string, any> = {};
  const requiredKeys: string[] = [];

  if (Array.isArray(payloadParams)) {
    for (const param of payloadParams) {
      if (!param.key) continue;
      customPayload[param.key] = {
        type: param.type || 'string',
        description: param.description || param.label,
        examples: param.example ? [param.example] : undefined
      };
      if (param.required) {
        requiredKeys.push(param.key);
      }
    }
  }

  const payloadSchema: Record<string, any> = {
    type: 'object',
    properties: customPayload,
    additionalProperties: true
  };
  if (requiredKeys.length > 0) {
    payloadSchema.required = requiredKeys;
  }

  return {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Short description of the automation request'
      },
      severity: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'critical'],
        description: 'Importance or urgency'
      },
      payload: payloadSchema,
      metadata: {
        type: 'object',
        description: 'Optional metadata to help routing downstream'
      }
    },
    required: ['payload']
  };
}

function normalizeParameterSchema(schema?: Record<string, any> | null): Record<string, any> {
  if (!schema || typeof schema !== 'object') {
    return {
      type: 'object',
      properties: {},
      additionalProperties: true
    };
  }
  const normalized: Record<string, any> = {
    type: schema.type || 'object',
    properties: schema.properties || {},
    required: schema.required,
    additionalProperties:
      schema.additionalProperties === undefined ? true : schema.additionalProperties
  };
  return normalized;
}

async function loadDefaultEmbedTools(
  agentConfigId: string,
  userId: string
): Promise<SerializedToolDefinition[]> {
  // Prefer all enabled tools for this user/config (mirrors workspace behavior)
  const mcpQuery = adminClient
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
    .eq('connection.is_enabled', true);

  // Only filter by user when we have one; some legacy rows may have null user_id
  if (userId) {
    mcpQuery.eq('connection.user_id', userId);
  }

  const [mcpResp, n8nResp] = await Promise.all([
    mcpQuery,
    adminClient
      .from('va_n8n_integrations')
      .select(
        'id, name, description, enabled, webhook_url, http_method, custom_headers, secret, forward_session_context'
      )
      .eq('config_id', agentConfigId)
      .eq('enabled', true)
  ]);

  const tools: SerializedToolDefinition[] = [];

  if (!mcpResp.error) {
    for (const tool of mcpResp.data || []) {
      if (!tool.connection_id || !tool.connection?.is_enabled) continue;
      tools.push({
        name: tool.tool_name,
        description: tool.description || null,
        parameters: normalizeParameterSchema(tool.parameters_schema),
        execution_type: 'mcp',
        connection_id: tool.connection_id,
        metadata: {},
        source: 'mcp',
        owner_user_id: userId
      });
    }
  } else {
    console.warn('[voice-ephemeral-key] Failed to load default MCP tools', mcpResp.error);
  }

  if (!n8nResp.error) {
    for (const integration of n8nResp.data || []) {
      const toolName = buildN8NToolName(integration.name, integration.id);
      tools.push({
        name: toolName,
        description:
          integration.description ||
          'Trigger connected n8n workflow',
        parameters: buildWebhookSchema({}),
        execution_type: 'webhook',
        metadata: {
          integrationId: integration.id
        },
        source: 'n8n',
        owner_user_id: userId
      });
    }
  } else {
    console.warn('[voice-ephemeral-key] Failed to load default n8n tools', n8nResp.error);
  }

  console.log('[voice-ephemeral-key] default tools resolved', {
    agentConfigId,
    userId,
    mcpCount: tools.filter(t => t.execution_type === 'mcp').length,
    n8nCount: tools.filter(t => t.execution_type === 'webhook').length
  });

  return tools;
}

async function loadEmbedTools(
  agentConfigId: string,
  userId: string
): Promise<SerializedToolDefinition[]> {
  // For embeds, we resolve tools from the agent config itself (not the visiting end-user):
  // - MCP tools are only exposed if explicitly selected in va_agent_config_tools
  // - n8n automations are tied to the config_id; by default we expose all enabled integrations
  //   unless the preset explicitly selects specific n8n tools (or clears selection via sentinel).
  const { data: allEnabledN8nResp, error: allEnabledN8nError } = await adminClient
    .from('va_n8n_integrations')
    .select('id, name, description, enabled')
    .eq('config_id', agentConfigId)
    .eq('enabled', true);

  if (allEnabledN8nError) {
    console.warn('[voice-ephemeral-key] Failed to load enabled n8n integrations', allEnabledN8nError);
  }

  const { data: selections, error } = await adminClient
    .from('va_agent_config_tools')
    .select('tool_name, tool_source, tool_id, connection_id, n8n_integration_id, metadata, user_id')
    .eq('config_id', agentConfigId);

  if (error) {
    console.warn('[voice-ephemeral-key] Failed to load tool selections', error);
    return [];
  }

  if (!selections?.length) {
    const n8nTools: SerializedToolDefinition[] = (allEnabledN8nResp || []).map((integration: any) => {
      const toolName = buildN8NToolName(integration.name, integration.id);
      return {
        name: toolName,
        description: integration.description || 'Trigger connected n8n workflow',
        parameters: buildWebhookSchema({}),
        execution_type: 'webhook',
        metadata: {
          integrationId: integration.id
        },
        source: 'n8n',
        owner_user_id: userId
      };
    });

    console.log('[voice-ephemeral-key] no tool selections for config; returning enabled n8n only', {
      agentConfigId,
      userId,
      n8nCount: n8nTools.length
    });

    return n8nTools;
  }

  // Mirror workspace behavior: if some rows are owned by this user_id, prefer them.
  const owned =
    userId && selections.some((row: any) => row.user_id === userId)
      ? selections.filter((row: any) => row.user_id === userId)
      : selections;

  const nonSentinel = owned.filter((row: any) => row.tool_name !== SELECTION_SENTINEL);
  const hasSentinel = owned.some((row: any) => row.tool_name === SELECTION_SENTINEL);

  if (nonSentinel.length === 0) {
    // If the user cleared selection, we still allow config-scoped n8n integrations (if any)
    // because embeds have no "signed-in user" context and n8n automations are explicitly tied
    // to the agent config itself.
    const n8nTools: SerializedToolDefinition[] = (allEnabledN8nResp || []).map((integration: any) => {
      const toolName = buildN8NToolName(integration.name, integration.id);
      return {
        name: toolName,
        description: integration.description || 'Trigger connected n8n workflow',
        parameters: buildWebhookSchema({}),
        execution_type: 'webhook',
        metadata: {
          integrationId: integration.id
        },
        source: 'n8n',
        owner_user_id: userId
      };
    });

    console.log('[voice-ephemeral-key] tool selection cleared; returning enabled n8n only', {
      agentConfigId,
      userId,
      sentinel: hasSentinel,
      n8nCount: n8nTools.length
    });
    return n8nTools;
  }

  const mcpSelectionRows = nonSentinel.filter((row: any) => row.tool_source === 'mcp');
  const n8nSelectionRows = nonSentinel.filter((row: any) => row.tool_source === 'n8n');

  const toolIds = mcpSelectionRows
    .map((row) => row.tool_id)
    .filter((id): id is string => Boolean(id));
  const toolNames = mcpSelectionRows
    .map((row) => row.tool_name)
    .filter((name): name is string => Boolean(name));
  const integrationIds = n8nSelectionRows
    .map((row) => row.n8n_integration_id)
    .filter((id): id is string => Boolean(id));

  const [mcpToolsResp, mcpToolsByNameResp, n8nResp] = await Promise.all([
    toolIds.length
      ? adminClient
          .from('va_mcp_tools')
          .select(
            `
            id,
            tool_name,
            description,
            parameters_schema,
            connection_id,
            is_enabled,
            connection:va_mcp_connections ( id, user_id, is_enabled )
          `
          )
          .in('id', toolIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    toolNames.length
      ? adminClient
          .from('va_mcp_tools')
          .select(
            `
            id,
            tool_name,
            description,
            parameters_schema,
            connection_id,
            is_enabled,
            connection:va_mcp_connections ( id, user_id, is_enabled )
          `
          )
          .in('tool_name', Array.from(new Set(toolNames)))
      : Promise.resolve({ data: [] as any[], error: null }),
    integrationIds.length
      ? adminClient
          .from('va_n8n_integrations')
          .select(
            'id, name, description, enabled, webhook_url, http_method, custom_headers, secret, forward_session_context'
          )
          .in('id', integrationIds)
      : Promise.resolve({ data: [] as any[], error: null })
  ]);

  if (mcpToolsResp.error) {
    console.warn('[voice-ephemeral-key] Failed to load MCP tool definitions', mcpToolsResp.error);
  }
  if (mcpToolsByNameResp.error) {
    console.warn('[voice-ephemeral-key] Failed to load MCP tool definitions by name', mcpToolsByNameResp.error);
  }
  if (n8nResp.error) {
    console.warn('[voice-ephemeral-key] Failed to load n8n integrations', n8nResp.error);
  }

  const combinedMcpTools = [...(mcpToolsResp.data || []), ...(mcpToolsByNameResp.data || [])];
  const mcpMap = new Map(combinedMcpTools.map((tool: any) => [tool.id, tool]));
  const mcpByName = new Map<string, any[]>();
  for (const tool of combinedMcpTools) {
    if (!tool.tool_name) continue;
    const existing = mcpByName.get(tool.tool_name) || [];
    existing.push(tool);
    mcpByName.set(tool.tool_name, existing);
  }
  const n8nMap = new Map((n8nResp.data || []).map((integration: any) => [integration.id, integration]));
  const allEnabledN8nByToolName = new Map(
    (allEnabledN8nResp || []).map((integration: any) => [buildN8NToolName(integration.name, integration.id), integration])
  );

  const serialized: SerializedToolDefinition[] = [];
  const seenNames = new Set<string>();

  let selectedMcpCount = 0;
  let selectedN8nCount = 0;

  for (const row of nonSentinel as ToolSelectionRow[]) {
    if (row.tool_source === 'mcp') {
      let toolRow = row.tool_id ? mcpMap.get(row.tool_id) : undefined;
      if (!toolRow && row.tool_name) {
        const candidates = mcpByName.get(row.tool_name) || [];
        toolRow = row.connection_id
          ? candidates.find((candidate) => candidate.connection_id === row.connection_id)
          : candidates[0];
      }
      const connectionEnabled =
        toolRow?.connection?.is_enabled !== false &&
        (!userId || !toolRow?.connection?.user_id || toolRow.connection.user_id === userId);
      if (!toolRow || toolRow.is_enabled === false || !connectionEnabled) continue;
      if (seenNames.has(row.tool_name)) continue;
      serialized.push({
        name: row.tool_name,
        description: toolRow.description || null,
        parameters: normalizeParameterSchema(toolRow.parameters_schema),
        execution_type: 'mcp',
        connection_id: row.connection_id || toolRow.connection_id,
        metadata: row.metadata || {},
        source: 'mcp',
        owner_user_id: userId
      });
      seenNames.add(row.tool_name);
      selectedMcpCount += 1;
    } else if (row.tool_source === 'n8n' && row.n8n_integration_id) {
      const integration = n8nMap.get(row.n8n_integration_id);
      if (!integration || !integration.enabled) continue;
      const toolName = row.tool_name || buildN8NToolName(integration.name, integration.id);
      if (seenNames.has(toolName)) continue;
      serialized.push({
        name: toolName,
        description: integration.description || 'Trigger connected n8n workflow',
        parameters: buildWebhookSchema(row.metadata || {}),
        execution_type: 'webhook',
        metadata: {
          integrationId: integration.id,
          ...(row.metadata || {})
        },
        source: 'n8n',
        owner_user_id: userId
      });
      seenNames.add(toolName);
      selectedN8nCount += 1;
    } else if (row.tool_source === 'n8n' && row.tool_name) {
      // Back-compat: if the row didn't store n8n_integration_id, try to match by tool_name
      const integration = allEnabledN8nByToolName.get(row.tool_name);
      if (!integration) continue;
      const toolName = row.tool_name;
      if (seenNames.has(toolName)) continue;
      serialized.push({
        name: toolName,
        description: integration.description || 'Trigger connected n8n workflow',
        parameters: buildWebhookSchema(row.metadata || {}),
        execution_type: 'webhook',
        metadata: {
          integrationId: integration.id,
          ...(row.metadata || {})
        },
        source: 'n8n',
        owner_user_id: userId
      });
      seenNames.add(toolName);
      selectedN8nCount += 1;
    }
  }

  // If the preset didn't explicitly choose n8n tools, expose all enabled integrations for this config.
  if (n8nSelectionRows.length === 0) {
    for (const integration of allEnabledN8nResp || []) {
      const toolName = buildN8NToolName(integration.name, integration.id);
      if (seenNames.has(toolName)) continue;
      serialized.push({
        name: toolName,
        description: integration.description || 'Trigger connected n8n workflow',
        parameters: buildWebhookSchema({}),
        execution_type: 'webhook',
        metadata: {
          integrationId: integration.id
        },
        source: 'n8n',
        owner_user_id: userId
      });
      seenNames.add(toolName);
      selectedN8nCount += 1;
    }
  }

  console.log('[voice-ephemeral-key] selected tools resolved', {
    agentConfigId,
    userId,
    rows: selections.length,
    ownedRows: owned.length,
    nonSentinelRows: nonSentinel.length,
    selectedMcpCount,
    selectedN8nCount,
    totalTools: serialized.length
  });

  return serialized;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const originHeader = req.headers.get('origin') || req.headers.get('referer');

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const publicId = url.searchParams.get('public_id');
      if (!publicId) {
        return new Response(JSON.stringify({ error: 'public_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const embed = await fetchVoiceEmbed(publicId);
      if (!embed) {
        return new Response(JSON.stringify({ error: 'Voice embed not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (!isOriginAllowed(originHeader, embed.allowed_origins || [])) {
        return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const agentConfig = embed.agent_config;
      return new Response(
        JSON.stringify({
          public_id: embed.public_id,
          agent: {
            id: agentConfig?.id || null,
            name: agentConfig?.name || 'Voice Agent',
            summary: agentConfig?.summary || null,
            voice: sanitizeVoice(embed.tts_voice || agentConfig?.voice || null),
            rag_enabled: agentConfig?.rag_enabled ?? false,
            rag_mode: agentConfig?.rag_mode || 'assist',
            rag_default_model: agentConfig?.rag_default_model || null,
            knowledge_spaces: (agentConfig?.knowledge_spaces || []).map((binding: any) => ({
              space_id: binding.space_id,
              vector_store_id: binding.rag_space?.vector_store_id || null
            }))
          },
          settings: {
            rtc_enabled: embed.rtc_enabled,
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
              widget_width: embed.widget_width ?? null,
              widget_height: embed.widget_height ?? null,
              button_image_url: embed.button_image_url ?? null
            }
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = (await req.json()) as CreateSessionPayload;
    if (!body?.public_id) {
      return new Response(JSON.stringify({ error: 'public_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const embed = await fetchVoiceEmbed(body.public_id);
    if (!embed) {
      return new Response(JSON.stringify({ error: 'Voice embed not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

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

    const tools = await loadEmbedTools(agentConfig.id, agentConfig.user_id);
    const session = await createEphemeralSession(embed, originHeader, tools);
    const metadata = {
      source: 'voice-embed',
      voice_embed_id: embed.id,
      voice_embed_public_id: embed.public_id,
      client_session_id: body.client_session_id || null,
      transport: embed.rtc_enabled ? 'webrtc' : 'websocket',
      embed_origin: originHeader || null
    };
    const supabaseSessionId = await ensureSupabaseSession(embed, metadata);

    return new Response(
      JSON.stringify({
        token: session.token,
        expires_at: session.expires_at,
        session_id: supabaseSessionId,
        agent: {
          id: agentConfig.id,
          name: agentConfig.name,
          summary: agentConfig.summary,
          voice: sanitizeVoice(embed.tts_voice || agentConfig.voice),
          model: agentConfig.model || agentConfig.chat_model || 'gpt-4o-realtime-preview',
          instructions: agentConfig.instructions || '',
          rag_enabled: agentConfig.rag_enabled ?? false,
          rag_mode: agentConfig.rag_mode || 'assist',
          rag_default_model: agentConfig.rag_default_model || null,
          knowledge_spaces: (agentConfig.knowledge_spaces || []).map((binding: any) => ({
            space_id: binding.space_id,
            vector_store_id: binding.rag_space?.vector_store_id || null
          }))
        },
        settings: {
          rtc_enabled: embed.rtc_enabled,
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
            widget_width: embed.widget_width ?? null,
            widget_height: embed.widget_height ?? null,
            button_image_url: embed.button_image_url ?? null
          }
        },
        tools
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[voice-ephemeral-key] error', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
