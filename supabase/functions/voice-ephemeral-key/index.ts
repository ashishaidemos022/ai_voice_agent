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
  metadata?: Record<string, any> | null;
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
          max_response_output_tokens
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

async function createEphemeralSession(agent: VoiceEmbedRecord, origin: string | null) {
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
  const voice = agent.tts_voice || agentConfig.voice || 'alloy';
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
    max_response_output_tokens: agentConfig.max_response_output_tokens ?? 1024
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
  const [mcpResp, n8nResp] = await Promise.all([
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
        'id, name, description, enabled, metadata, webhook_url, http_method, custom_headers, secret, forward_session_context'
      )
      .eq('config_id', agentConfigId)
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
      if (!integration.enabled) continue;
      tools.push({
        name: integration.name || `n8n_${integration.id}`,
        description:
          integration.description ||
          'Trigger connected n8n workflow',
        parameters: buildWebhookSchema(integration.metadata || {}),
        execution_type: 'webhook',
        metadata: {
          integrationId: integration.id,
          ...(integration.metadata || {})
        },
        source: 'n8n',
        owner_user_id: userId
      });
    }
  } else {
    console.warn('[voice-ephemeral-key] Failed to load default n8n tools', n8nResp.error);
  }

  return tools;
}

async function loadEmbedTools(
  agentConfigId: string,
  userId: string
): Promise<SerializedToolDefinition[]> {
  const { data: selections, error } = await adminClient
    .from('va_agent_config_tools')
    .select('tool_name, tool_source, tool_id, connection_id, n8n_integration_id, metadata')
    .eq('config_id', agentConfigId);

  if (error) {
    console.warn('[voice-ephemeral-key] Failed to load tool selections', error);
    return [];
  }

  if (!selections?.length) {
    return loadDefaultEmbedTools(agentConfigId, userId);
  }

  const toolIds = selections
    .map((row) => row.tool_id)
    .filter((id): id is string => Boolean(id));
  const integrationIds = selections
    .map((row) => row.n8n_integration_id)
    .filter((id): id is string => Boolean(id));

  const [mcpToolsResp, n8nResp] = await Promise.all([
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
            'id, name, description, enabled, metadata, webhook_url, http_method, custom_headers, secret, forward_session_context'
          )
          .in('id', integrationIds)
      : Promise.resolve({ data: [] as any[], error: null })
  ]);

  if (mcpToolsResp.error) {
    console.warn('[voice-ephemeral-key] Failed to load MCP tool definitions', mcpToolsResp.error);
  }
  if (n8nResp.error) {
    console.warn('[voice-ephemeral-key] Failed to load n8n integrations', n8nResp.error);
  }

  const mcpMap = new Map((mcpToolsResp.data || []).map((tool: any) => [tool.id, tool]));
  const n8nMap = new Map((n8nResp.data || []).map((integration: any) => [integration.id, integration]));

  const serialized: SerializedToolDefinition[] = [];

  for (const row of selections as ToolSelectionRow[]) {
    if (row.tool_source === 'mcp' && row.tool_id && row.connection_id) {
      const toolRow = mcpMap.get(row.tool_id);
      if (!toolRow) continue;
      serialized.push({
        name: row.tool_name,
        description: toolRow.description || null,
        parameters: normalizeParameterSchema(toolRow.parameters_schema),
        execution_type: 'mcp',
        connection_id: row.connection_id,
        metadata: row.metadata || {},
        source: 'mcp',
        owner_user_id: userId
      });
    } else if (row.tool_source === 'n8n' && row.n8n_integration_id) {
      const integration = n8nMap.get(row.n8n_integration_id);
      if (!integration || !integration.enabled) continue;
      serialized.push({
        name: row.tool_name,
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
    }
  }

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
            voice: embed.tts_voice || agentConfig?.voice || 'alloy'
          },
          settings: {
            rtc_enabled: embed.rtc_enabled,
            allowed_origins: embed.allowed_origins || []
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

    const session = await createEphemeralSession(embed, originHeader);
    const metadata = {
      source: 'voice-embed',
      voice_embed_id: embed.id,
      voice_embed_public_id: embed.public_id,
      client_session_id: body.client_session_id || null,
      transport: embed.rtc_enabled ? 'webrtc' : 'websocket',
      embed_origin: originHeader || null
    };
    const supabaseSessionId = await ensureSupabaseSession(embed, metadata);

    const tools = await loadEmbedTools(agentConfig.id, agentConfig.user_id);

    return new Response(
      JSON.stringify({
        token: session.token,
        expires_at: session.expires_at,
        session_id: supabaseSessionId,
        agent: {
          id: agentConfig.id,
          name: agentConfig.name,
          summary: agentConfig.summary,
          voice: embed.tts_voice || agentConfig.voice || 'alloy',
          model: agentConfig.model || agentConfig.chat_model || 'gpt-4o-realtime-preview',
          instructions: agentConfig.instructions || ''
        },
        settings: {
          rtc_enabled: embed.rtc_enabled
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
