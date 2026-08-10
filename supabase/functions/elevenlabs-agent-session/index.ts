import { createClient } from 'npm:@supabase/supabase-js@2.112.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ELEVENLABS_BASE_URL = Deno.env.get('ELEVENLABS_BASE_URL') || 'https://api.elevenlabs.io';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase service role credentials are missing');
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

type RequestPayload = {
  action?: 'list_agents' | 'list_voices' | 'signed_url' | 'sync_agent';
  provider_key_id?: string;
  config_id?: string;
  agent_id?: string;
  agent_public_id?: string;
  session_id?: string;
  origin?: string;
};

type LocalToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

type ProviderError = Error & { status?: number };

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
  } catch {
    return null;
  }
}

function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  if (!allowed.length) return true;
  if (!origin) return false;
  return allowed.some((stored) => stored === '*' || normalizeOrigin(stored) === origin);
}

async function authenticatedVaUser(req: Request): Promise<string> {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Unauthorized');
  const { data: { user }, error } = await adminClient.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized');
  const { data: profile, error: profileError } = await adminClient
    .from('va_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();
  if (profileError || !profile?.id) throw new Error('User profile not found');
  return profile.id;
}

async function resolveProviderKey(keyId: string, ownerId?: string): Promise<string> {
  const { data, error } = await adminClient
    .from('va_provider_keys')
    .select('encrypted_key, provider, user_id')
    .eq('id', keyId)
    .single();
  if (error || !data || data.provider !== 'elevenlabs') {
    throw new Error('Unable to resolve ElevenLabs provider key');
  }
  if (ownerId && data.user_id !== ownerId) throw new Error('Forbidden');
  try {
    const value = atob(data.encrypted_key || '').trim();
    if (!value) throw new Error('empty key');
    return value;
  } catch {
    throw new Error('Stored ElevenLabs API key is invalid');
  }
}

function elevenLabsUrl(path: string): URL {
  const base = new URL(ELEVENLABS_BASE_URL);
  base.pathname = path;
  base.search = '';
  base.hash = '';
  return base;
}

async function providerJson(
  apiKey: string,
  path: string,
  init: RequestInit = {}
): Promise<any> {
  const response = await fetch(elevenLabsUrl(path), {
    ...init,
    headers: {
      'xi-api-key': apiKey,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.detail?.message || payload?.detail || payload?.error || response.statusText;
    const error = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)) as ProviderError;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function sanitizeSchemaProperty(schema: any): Record<string, unknown> {
  const description = typeof schema?.description === 'string' ? schema.description : '';
  if (schema?.type === 'object' || schema?.properties) {
    const properties = Object.fromEntries(
      Object.entries(schema?.properties || {}).map(([name, value]) => [name, sanitizeSchemaProperty(value)])
    );
    return {
      type: 'object',
      ...(description ? { description } : {}),
      properties,
      required: Array.isArray(schema?.required)
        ? schema.required.filter((name: unknown) => typeof name === 'string' && name in properties)
        : []
    };
  }
  if (schema?.type === 'array') {
    return {
      type: 'array',
      ...(description ? { description } : {}),
      items: sanitizeSchemaProperty(schema?.items || { type: 'string', description: 'Array item' })
    };
  }
  const supportedType = ['boolean', 'string', 'integer', 'number'].includes(schema?.type)
    ? schema.type
    : 'string';
  return {
    type: supportedType,
    description: description || 'Tool parameter',
    ...(supportedType === 'string' && Array.isArray(schema?.enum)
      ? { enum: schema.enum.filter((value: unknown) => typeof value === 'string') }
      : {})
  };
}

function n8nParameters(metadata: Record<string, any> | null | undefined): Record<string, unknown> {
  const definitions = Array.isArray(metadata?.payloadParameters) ? metadata.payloadParameters : [];
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const parameter of definitions) {
    if (!parameter?.key) continue;
    properties[parameter.key] = sanitizeSchemaProperty({
      type: parameter.type || 'string',
      description: parameter.description || parameter.label || `Value for ${parameter.key}`
    });
    if (parameter.required) required.push(parameter.key);
  }
  return { type: 'object', properties, required };
}

async function loadLocalTools(configId: string, userId: string): Promise<LocalToolDefinition[]> {
  const { data: selections, error } = await adminClient
    .from('va_agent_config_tools')
    .select('tool_name,tool_source,tool_id,n8n_integration_id,metadata,user_id')
    .eq('config_id', configId);
  if (error) throw new Error(`Unable to load selected tools: ${error.message}`);

  const owned = (selections || []).filter((selection: any) => !selection.user_id || selection.user_id === userId);
  const selected = owned.filter((selection: any) => selection.tool_name !== '__none__');
  if (!selected.length) return [];

  const mcpIds = selected.map((selection: any) => selection.tool_id).filter(Boolean);
  const integrationIds = selected.map((selection: any) => selection.n8n_integration_id).filter(Boolean);
  const [{ data: mcpRows, error: mcpError }, { data: n8nRows, error: n8nError }] = await Promise.all([
    mcpIds.length
      ? adminClient.from('va_mcp_tools').select('id,tool_name,description,parameters_schema').in('id', mcpIds)
      : Promise.resolve({ data: [], error: null }),
    integrationIds.length
      ? adminClient.from('va_n8n_integrations').select('id,name,description,user_id').in('id', integrationIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (mcpError) throw new Error(`Unable to load MCP tool schemas: ${mcpError.message}`);
  if (n8nError) throw new Error(`Unable to load automation schemas: ${n8nError.message}`);

  const mcpById = new Map((mcpRows || []).map((row: any) => [row.id, row]));
  const n8nById = new Map((n8nRows || []).map((row: any) => [row.id, row]));

  return selected.map((selection: any) => {
    const mcp = selection.tool_id ? mcpById.get(selection.tool_id) : null;
    const n8n = selection.n8n_integration_id ? n8nById.get(selection.n8n_integration_id) : null;
    const metadata = selection.metadata || {};
    const parameters = mcp?.parameters_schema
      || (selection.tool_source === 'n8n' ? n8nParameters(metadata) : metadata.parameters || metadata.parameters_schema)
      || {
        type: 'object',
        properties: selection.tool_name === 'web_search'
          ? { query: { type: 'string', description: 'Search query' } }
          : {},
        required: selection.tool_name === 'web_search' ? ['query'] : []
      };
    return {
      name: selection.tool_name,
      description: mcp?.description || n8n?.description || metadata.description || `Execute ${selection.tool_name}`,
      parameters: sanitizeSchemaProperty(parameters)
    };
  });
}

function stableValue(value: any): any {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function syncProviderTool(
  apiKey: string,
  definition: LocalToolDefinition,
  previous?: { id?: string }
): Promise<string> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(definition.name)) {
    throw new Error(`Tool name ${definition.name} is not supported by ElevenLabs; use 1-64 letters, numbers, underscores, or hyphens`);
  }
  const body = JSON.stringify({
    tool_config: {
      type: 'client',
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      expects_response: true,
      response_timeout_secs: 120,
      interruption_mode: 'allow',
      pre_tool_speech: 'auto'
    }
  });
  if (previous?.id) {
    try {
      const updated = await providerJson(apiKey, `/v1/convai/tools/${previous.id}`, { method: 'PATCH', body });
      return updated.id || previous.id;
    } catch (error) {
      if ((error as ProviderError).status !== 404) throw error;
    }
  }
  const created = await providerJson(apiKey, '/v1/convai/tools', { method: 'POST', body });
  if (!created?.id) throw new Error(`ElevenLabs did not return an ID for tool ${definition.name}`);
  return created.id;
}

function normalizedTtsModel(value: unknown): string {
  if (value === 'eleven_v3') return 'eleven_v3_conversational';
  return typeof value === 'string' && value ? value : 'eleven_flash_v2_5';
}

async function syncAppManagedAgent(configId: string, vaUserId: string) {
  const { data: config, error } = await adminClient
    .from('va_agent_configs')
    .select('id,user_id,name,instructions,temperature,max_response_output_tokens,voice_provider,voice_provider_key_id,voice_provider_config,voice_id,voice_sample_rate_hz,turn_detection_config')
    .eq('id', configId)
    .single();
  if (error || !config) throw new Error('Agent config not found');
  if (config.user_id !== vaUserId) throw new Error('Forbidden');
  if (config.voice_provider !== 'elevenlabs_agent') throw new Error('Direct ElevenLabs Agent is not enabled for this preset');
  if (!config.voice_provider_key_id) throw new Error('ElevenLabs provider key is missing');

  const providerConfig = config.voice_provider_config || {};
  if (providerConfig.configuration_authority !== 'app_managed') {
    throw new Error('Switch the preset to app-managed configuration before publishing');
  }
  const apiKey = await resolveProviderKey(config.voice_provider_key_id, vaUserId);
  const localTools = await loadLocalTools(configId, vaUserId);
  const previousToolMap = providerConfig.app_managed?.tool_map || {};
  const toolMap: Record<string, { id: string; hash: string }> = {};
  const toolIds: string[] = [];
  for (const definition of localTools) {
    const definitionHash = await sha256(definition);
    const id = await syncProviderTool(apiKey, definition, previousToolMap[definition.name]);
    toolMap[definition.name] = { id, hash: definitionHash };
    toolIds.push(id);
  }

  let remoteAgent: any = null;
  let remoteAgentId = `${providerConfig.agent_id || ''}`.trim();
  if (remoteAgentId) {
    try {
      remoteAgent = await providerJson(apiKey, `/v1/convai/agents/${remoteAgentId}`);
    } catch (providerError) {
      if ((providerError as ProviderError).status !== 404) throw providerError;
      remoteAgentId = '';
    }
  }

  const currentConversation = remoteAgent?.conversation_config || {};
  const currentAgent = currentConversation.agent || {};
  const currentPrompt = currentAgent.prompt || {};
  const currentTts = currentConversation.tts || {};
  const currentTurn = currentConversation.turn || {};
  const currentRuntime = currentConversation.conversation || {};
  const voiceSettings = providerConfig.voice_settings || {};
  const desiredProfile = {
    name: config.name,
    instructions: config.instructions,
    first_message: providerConfig.first_message || '',
    language: providerConfig.language || currentAgent.language || 'en',
    llm: providerConfig.llm || currentPrompt.llm || 'gpt-5.4-mini',
    temperature: config.temperature,
    max_tokens: config.max_response_output_tokens,
    voice_id: config.voice_id || currentTts.voice_id,
    tts_model_id: normalizedTtsModel(providerConfig.model_id || currentTts.model_id),
    output_format: providerConfig.output_format || currentTts.agent_output_audio_format || 'pcm_24000',
    turn_eagerness: providerConfig.turn_eagerness || currentTurn.turn_eagerness || 'normal',
    speculative_turn: providerConfig.speculative_turn ?? currentTurn.speculative_turn ?? false,
    tools: localTools
  };
  if (!desiredProfile.voice_id) throw new Error('Select an ElevenLabs voice before publishing');
  const syncHash = await sha256(desiredProfile);
  const nextPrompt = { ...currentPrompt };
  // Older Agents can still return deprecated inline tools. ElevenLabs rejects
  // updates that contain both that field and the current tool_ids field.
  delete nextPrompt.tools;

  const conversationConfig = {
    agent: {
      ...currentAgent,
      first_message: desiredProfile.first_message,
      language: desiredProfile.language,
      prompt: {
        ...nextPrompt,
        prompt: desiredProfile.instructions,
        llm: desiredProfile.llm,
        temperature: desiredProfile.temperature,
        max_tokens: desiredProfile.max_tokens,
        tool_ids: toolIds
      }
    },
    tts: {
      ...currentTts,
      voice_id: desiredProfile.voice_id,
      model_id: desiredProfile.tts_model_id,
      agent_output_audio_format: desiredProfile.output_format,
      ...(voiceSettings.stability !== undefined ? { stability: voiceSettings.stability } : {}),
      ...(voiceSettings.similarity_boost !== undefined ? { similarity_boost: voiceSettings.similarity_boost } : {}),
      ...(voiceSettings.speed !== undefined ? { speed: voiceSettings.speed } : {})
    },
    turn: {
      ...currentTurn,
      turn_eagerness: desiredProfile.turn_eagerness,
      speculative_turn: desiredProfile.speculative_turn
    },
    conversation: {
      ...currentRuntime,
      client_events: Array.from(new Set([
        ...(Array.isArray(currentRuntime.client_events) ? currentRuntime.client_events : []),
        'audio',
        'interruption',
        'user_transcript',
        'agent_response'
      ]))
    }
  };

  let created = false;
  if (remoteAgentId) {
    remoteAgent = await providerJson(apiKey, `/v1/convai/agents/${remoteAgentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: config.name, conversation_config: conversationConfig })
    });
  } else {
    const createdAgent = await providerJson(apiKey, '/v1/convai/agents/create', {
      method: 'POST',
      body: JSON.stringify({
        name: config.name,
        tags: ['viaana', 'app-managed'],
        conversation_config: conversationConfig
      })
    });
    remoteAgentId = createdAgent?.agent_id || '';
    if (!remoteAgentId) throw new Error('ElevenLabs did not return an Agent ID');
    remoteAgent = await providerJson(apiKey, `/v1/convai/agents/${remoteAgentId}`);
    created = true;
  }

  const syncedAt = new Date().toISOString();
  const nextProviderConfig = {
    ...providerConfig,
    agent_id: remoteAgentId,
    configuration_authority: 'app_managed',
    sync_local_instructions: false,
    app_managed: {
      ...(providerConfig.app_managed || {}),
      status: 'synced',
      synced_at: syncedAt,
      sync_hash: syncHash,
      remote_version_id: remoteAgent?.version_id || null,
      tool_count: toolIds.length,
      tool_map: toolMap
    }
  };
  const { error: updateError } = await adminClient
    .from('va_agent_configs')
    .update({ voice_provider_config: nextProviderConfig, updated_at: syncedAt })
    .eq('id', configId)
    .eq('user_id', vaUserId);
  if (updateError) throw new Error(`Unable to save provider sync state: ${updateError.message}`);

  return {
    agent_id: remoteAgentId,
    created,
    synced_at: syncedAt,
    sync_hash: syncHash,
    tool_count: toolIds.length,
    remote_version_id: remoteAgent?.version_id || null,
    voice_provider_config: nextProviderConfig
  };
}

async function listAgents(apiKey: string) {
  const url = elevenLabsUrl('/v1/convai/agents');
  url.searchParams.set('page_size', '100');
  const response = await fetch(url, { headers: { 'xi-api-key': apiKey } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.detail?.message || payload?.detail || `ElevenLabs returned ${response.status}`);
  }
  return Array.isArray(payload?.agents) ? payload.agents : [];
}

async function listVoices(apiKey: string) {
  const voices: any[] = [];
  let nextPageToken: string | null = null;
  let page = 0;
  do {
    const url = elevenLabsUrl('/v2/voices');
    url.searchParams.set('page_size', '100');
    url.searchParams.set('sort', 'name');
    url.searchParams.set('sort_direction', 'asc');
    url.searchParams.set('include_total_count', 'false');
    if (nextPageToken) url.searchParams.set('next_page_token', nextPageToken);
    const response = await fetch(url, { headers: { 'xi-api-key': apiKey } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.detail?.message || payload?.detail || `ElevenLabs returned ${response.status}`);
    }
    voices.push(...(Array.isArray(payload?.voices) ? payload.voices : []));
    nextPageToken = payload?.has_more && typeof payload?.next_page_token === 'string'
      ? payload.next_page_token
      : null;
    page += 1;
  } while (nextPageToken && page < 5);

  return voices.map((voice) => ({
    voice_id: voice.voice_id,
    name: voice.name || 'Unnamed voice',
    category: voice.category || null,
    description: voice.description || null,
    preview_url: voice.preview_url || null,
    labels: voice.labels || {},
    verified_languages: Array.isArray(voice.verified_languages) ? voice.verified_languages : []
  }));
}

async function signedUrl(apiKey: string, remoteAgentId: string) {
  const url = elevenLabsUrl('/v1/convai/conversation/get-signed-url');
  url.searchParams.set('agent_id', remoteAgentId);
  url.searchParams.set('include_conversation_id', 'true');
  const response = await fetch(url, { headers: { 'xi-api-key': apiKey } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.signed_url) {
    throw new Error(payload?.detail?.message || payload?.detail || `ElevenLabs returned ${response.status}`);
  }
  return payload;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const request = (await req.json()) as RequestPayload;
    if (request.action === 'list_agents') {
      const vaUserId = await authenticatedVaUser(req);
      if (!request.provider_key_id) return jsonResponse({ error: 'provider_key_id is required' }, 400);
      const apiKey = await resolveProviderKey(request.provider_key_id, vaUserId);
      return jsonResponse({ agents: await listAgents(apiKey) });
    }

    if (request.action === 'list_voices') {
      const vaUserId = await authenticatedVaUser(req);
      if (!request.provider_key_id) return jsonResponse({ error: 'provider_key_id is required' }, 400);
      const apiKey = await resolveProviderKey(request.provider_key_id, vaUserId);
      return jsonResponse({ voices: await listVoices(apiKey) });
    }

    if (request.action === 'sync_agent') {
      const vaUserId = await authenticatedVaUser(req);
      if (!request.config_id) return jsonResponse({ error: 'config_id is required' }, 400);
      return jsonResponse(await syncAppManagedAgent(request.config_id, vaUserId));
    }

    if (request.action !== 'signed_url') return jsonResponse({ error: 'Unsupported action' }, 400);
    if (!request.session_id) return jsonResponse({ error: 'session_id is required' }, 400);

    let config: any;
    if (request.agent_public_id) {
      const origin = normalizeOrigin(request.origin || req.headers.get('origin'));
      const { data: embed, error } = await adminClient
        .from('va_voice_embeds')
        .select(`allowed_origins, agent_config:va_agent_configs(id,user_id,voice_provider,voice_provider_key_id,voice_provider_config)`)
        .eq('public_id', request.agent_public_id)
        .eq('is_enabled', true)
        .single();
      if (error || !embed?.agent_config) return jsonResponse({ error: 'Voice embed not found' }, 404);
      if (!isOriginAllowed(origin, embed.allowed_origins || [])) return jsonResponse({ error: 'Origin not allowed' }, 403);
      config = embed.agent_config;
    } else if (request.agent_id) {
      const vaUserId = await authenticatedVaUser(req);
      const { data, error } = await adminClient
        .from('va_agent_configs')
        .select('id,user_id,voice_provider,voice_provider_key_id,voice_provider_config')
        .eq('id', request.agent_id)
        .single();
      if (error || !data) return jsonResponse({ error: 'Agent config not found' }, 404);
      if (data.user_id && data.user_id !== vaUserId) return jsonResponse({ error: 'Forbidden' }, 403);
      config = data;
    } else {
      return jsonResponse({ error: 'agent_id or agent_public_id is required' }, 400);
    }

    if (config.voice_provider !== 'elevenlabs_agent') {
      return jsonResponse({ error: 'Direct ElevenLabs Agent is not enabled for this preset' }, 400);
    }
    const remoteAgentId = `${config.voice_provider_config?.agent_id || ''}`.trim();
    if (!remoteAgentId || !config.voice_provider_key_id) {
      return jsonResponse({ error: 'ElevenLabs Agent ID or provider key is missing' }, 400);
    }
    const apiKey = await resolveProviderKey(config.voice_provider_key_id, config.user_id || undefined);
    return jsonResponse(await signedUrl(apiKey, remoteAgentId));
  } catch (error) {
    console.error('[elevenlabs-agent-session]', error);
    const message = error instanceof Error ? error.message : 'ElevenLabs Agent session failed';
    const status = /unauthorized|forbidden|origin|provider key/i.test(message) ? 401 : 500;
    return jsonResponse({ error: message }, status);
  }
});
