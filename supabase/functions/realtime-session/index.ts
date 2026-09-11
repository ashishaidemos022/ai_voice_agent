import { liveVoiceSession } from '../../../shared/live-voice.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { gptLiveSession } from '../../../shared/gpt-live.ts';
import { isGPTLiveModel, OPENAI_MODELS, normalizeRealtimeModel } from '../../../shared/openai-models.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_BASE_URL = Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
const XAI_BASE_URL = Deno.env.get('XAI_BASE_URL') || 'https://api.x.ai/v1';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase service role credentials are missing');
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const supportedVoices = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar']);
const SELECTION_SENTINEL = '__none__';

type LiveFunctionTool = {
  type: 'function';
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
};

function sanitizeVoice(value?: string | null): string {
  const voice = (value || 'marin').toLowerCase();
  return supportedVoices.has(voice) ? voice : 'marin';
}

function normalizeToolSchema(schema?: Record<string, unknown> | null): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {}, additionalProperties: true };
  }
  return {
    type: schema.type || 'object',
    properties: schema.properties || {},
    ...(Array.isArray(schema.required) ? { required: schema.required } : {}),
    additionalProperties: schema.additionalProperties ?? true
  };
}

function webSearchTool(): LiveFunctionTool {
  return {
    type: 'function',
    name: 'web_search',
    description: 'Search the web for grounded answers from specific websites.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        allowed_domains: { type: 'array', items: { type: 'string' } },
        max_results: { type: 'integer' },
        time_range: { type: 'string', enum: ['any', 'day', 'week', 'month', 'year'] },
        snippets_only: { type: 'boolean' }
      },
      required: ['query'],
      additionalProperties: false
    }
  };
}

async function loadLiveFunctionTools(configId: string, userId: string): Promise<LiveFunctionTool[]> {
  const { data: selectionRows, error: selectionError } = await adminClient
    .from('va_agent_config_tools')
    .select('tool_name,tool_source,tool_id,connection_id,n8n_integration_id,metadata,user_id')
    .eq('config_id', configId);
  if (selectionError) {
    console.warn('[realtime-session] Failed to load GPT-Live tool selections', selectionError);
    return [];
  }

  const selections = (selectionRows || []).some((row: any) => row.user_id === userId)
    ? (selectionRows || []).filter((row: any) => row.user_id === userId)
    : (selectionRows || []);
  const selected = selections.filter((row: any) => row.tool_name !== SELECTION_SENTINEL);
  if (!selected.length) return [];

  const mcpIds = selected.filter((row: any) => row.tool_source === 'mcp' && row.tool_id).map((row: any) => row.tool_id);
  const mcpNames = selected.filter((row: any) => row.tool_source === 'mcp' && row.tool_name).map((row: any) => row.tool_name);
  const n8nIds = selected.filter((row: any) => row.tool_source === 'n8n' && row.n8n_integration_id).map((row: any) => row.n8n_integration_id);

  const [mcpById, mcpByName, n8n] = await Promise.all([
    mcpIds.length
      ? adminClient.from('va_mcp_tools').select('id,tool_name,description,parameters_schema,connection_id,is_enabled,connection:va_mcp_connections(id,user_id,is_enabled)').in('id', mcpIds)
      : Promise.resolve({ data: [], error: null }),
    mcpNames.length
      ? adminClient.from('va_mcp_tools').select('id,tool_name,description,parameters_schema,connection_id,is_enabled,connection:va_mcp_connections(id,user_id,is_enabled)').in('tool_name', Array.from(new Set(mcpNames)))
      : Promise.resolve({ data: [], error: null }),
    n8nIds.length
      ? adminClient.from('va_n8n_integrations').select('id,name,description,enabled').eq('config_id', configId).in('id', n8nIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (mcpById.error || mcpByName.error || n8n.error) {
    console.warn('[realtime-session] Some GPT-Live tool definitions could not be loaded', {
      mcpById: mcpById.error,
      mcpByName: mcpByName.error,
      n8n: n8n.error
    });
  }

  const mcpRows = [...(mcpById.data || []), ...(mcpByName.data || [])];
  const n8nRows = n8n.data || [];
  const tools: LiveFunctionTool[] = [];
  const seen = new Set<string>();
  for (const selection of selected) {
    if (selection.tool_source === 'client' && selection.tool_name === 'web_search') {
      if (!seen.has('web_search')) tools.push(webSearchTool());
      seen.add('web_search');
      continue;
    }
    if (selection.tool_source === 'mcp') {
      const row = mcpRows.find((candidate: any) =>
        (selection.tool_id && candidate.id === selection.tool_id) ||
        (candidate.tool_name === selection.tool_name && (!selection.connection_id || candidate.connection_id === selection.connection_id))
      );
      const connection = Array.isArray(row?.connection) ? row.connection[0] : row?.connection;
      if (!row || row.is_enabled === false || connection?.is_enabled === false || (connection?.user_id && connection.user_id !== userId)) continue;
      if (seen.has(row.tool_name)) continue;
      tools.push({
        type: 'function',
        name: row.tool_name,
        description: row.description || undefined,
        parameters: normalizeToolSchema(row.parameters_schema)
      });
      seen.add(row.tool_name);
      continue;
    }
    if (selection.tool_source === 'n8n') {
      const row = n8nRows.find((candidate: any) => candidate.id === selection.n8n_integration_id);
      if (!row || row.enabled === false || seen.has(selection.tool_name)) continue;
      tools.push({
        type: 'function',
        name: selection.tool_name,
        description: row.description || 'Trigger connected n8n workflow',
        parameters: normalizeToolSchema(selection.metadata?.parameters_schema || {
          type: 'object',
          properties: { payload: { type: 'object', description: 'Workflow payload' } },
          required: ['payload']
        })
      });
      seen.add(selection.tool_name);
    }
  }
  return tools;
}

async function hashSafetyIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }
    const contentType = req.headers.get('content-type') || '';
    const isWebRTCRequest = contentType.includes('application/sdp');
    const isJsonRequest = contentType.includes('application/json');
    if (!isWebRTCRequest && !isJsonRequest) {
      return new Response('Expected an application/sdp or application/json POST request', {
        status: 415,
        headers: corsHeaders
      });
    }
    const jsonBody = isJsonRequest ? await req.json().catch(() => ({})) : {};
    const isLiveWebRTCRequest = jsonBody?.transport === 'webrtc' && typeof jsonBody?.sdp === 'string';
    const isClientSecretRequest = isJsonRequest && !isLiveWebRTCRequest;

    const authorization = req.headers.get('authorization');
    const accessToken = authorization?.replace(/^Bearer\s+/i, '');
    if (!accessToken) {
      return new Response('Authentication required', { status: 401, headers: corsHeaders });
    }

    const { data: authData, error: authError } = await adminClient.auth.getUser(accessToken);
    if (authError || !authData.user) {
      return new Response('Invalid or expired session', { status: 401, headers: corsHeaders });
    }

    const { data: vaUser, error: vaUserError } = await adminClient
      .from('va_users')
      .select('id')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();
    if (vaUserError) throw vaUserError;
    if (!vaUser) {
      return new Response('User profile not found', { status: 403, headers: corsHeaders });
    }

    const agentId = new URL(req.url).searchParams.get('agent_id');
    if (!agentId) {
      return new Response('agent_id is required', { status: 400, headers: corsHeaders });
    }

    const { data: storedAgent, error: agentError } = await adminClient
      .from('va_agent_configs')
      .select('id,user_id,model,chat_model,voice,instructions,voice_persona_prompt,voice_provider_config,max_response_output_tokens,turn_detection_enabled,turn_detection_config,voice_provider,voice_provider_key_id,rag_enabled,rag_mode,rag_default_model,knowledge_spaces:va_rag_agent_spaces(space_id)')
      .eq('id', agentId)
      .eq('user_id', vaUser.id)
      .maybeSingle();
    if (agentError) throw agentError;
    if (!storedAgent) {
      return new Response('Agent configuration not found', { status: 404, headers: corsHeaders });
    }
    const routedSessionId = new URL(req.url).searchParams.get('routed_session_id');
    if (routedSessionId) {
      if (new URL(req.url).searchParams.has('benchmark_run_id')) {
        return new Response('Routed voice requires a workspace WebRTC call', { status: 400, headers: corsHeaders });
      }
      const { data: routedSession } = await adminClient.from('va_chat_sessions')
        .select('id,status,metadata').eq('id', routedSessionId).eq('user_id', vaUser.id).eq('agent_preset_id', agentId).maybeSingle();
      if (!routedSession || routedSession.status !== 'active' || routedSession.metadata?.channel !== 'routed_voice') {
        return new Response('Active owned routed voice session required', { status: 403, headers: corsHeaders });
      }
    }
    if (routedSessionId && !['openai_realtime', 'xai_realtime', 'elevenlabs_tts'].includes(storedAgent.voice_provider || 'openai_realtime')) {
      return new Response('This provider manages its own conversation. Use native voice.', { status: 409, headers: corsHeaders });
    }
    let agent = storedAgent;
    const voiceProvider = storedAgent.voice_provider || 'openai_realtime';
    let usesGPTLive = voiceProvider === 'openai_realtime' && isGPTLiveModel(storedAgent.model);

    if (routedSessionId && usesGPTLive) {
      return new Response('GPT-Live routed voice will be enabled with client delegation in a later integration phase. Use Native voice for this preset.', {
        status: 409,
        headers: corsHeaders
      });
    }

    if (voiceProvider === 'xai_realtime' && (!routedSessionId || isClientSecretRequest)) {
      if (!isClientSecretRequest) {
        return new Response('xAI Realtime currently uses the WebSocket transport', {
          status: 400,
          headers: corsHeaders
        });
      }
      if (!storedAgent.voice_provider_key_id) {
        return new Response('xAI provider key is missing', { status: 400, headers: corsHeaders });
      }
      const { data: keyRow, error: keyError } = await adminClient
        .from('va_provider_keys')
        .select('provider,encrypted_key,user_id')
        .eq('id', storedAgent.voice_provider_key_id)
        .eq('user_id', vaUser.id)
        .maybeSingle();
      if (keyError) throw keyError;
      if (!keyRow || keyRow.provider !== 'xai') {
        return new Response('A valid xAI provider key is required', { status: 400, headers: corsHeaders });
      }
      let xaiApiKey = '';
      try {
        xaiApiKey = atob(keyRow.encrypted_key);
      } catch {
        throw new Error('Stored xAI provider key could not be decoded');
      }
      const xaiResponse = await fetch(`${XAI_BASE_URL}/realtime/client_secrets`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${xaiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ expires_after: { seconds: 300 } })
      });
      const responseBody = await xaiResponse.text();
      if (!xaiResponse.ok) {
        return new Response(responseBody, {
          status: xaiResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      const payload = JSON.parse(responseBody);
      if (!payload?.value) throw new Error('xAI did not return a client secret');
      return new Response(JSON.stringify({
        token: payload.value,
        expires_at: payload.expires_at ?? null,
        provider: 'xai'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');

    const benchmarkRunId = new URL(req.url).searchParams.get('benchmark_run_id');
    if (benchmarkRunId) {
      const { data: benchmarkRun, error: benchmarkRunError } = await adminClient
        .from('voice_benchmark_runs')
        .select('id,experiment_id,config_snapshot')
        .eq('id', benchmarkRunId)
        .maybeSingle();
      if (benchmarkRunError || !benchmarkRun) {
        return new Response('Benchmark run not found', { status: 404, headers: corsHeaders });
      }
      const { data: benchmarkExperiment } = await adminClient
        .from('voice_benchmark_experiments')
        .select('user_id')
        .eq('id', benchmarkRun.experiment_id)
        .eq('user_id', vaUser.id)
        .maybeSingle();
      if (!benchmarkExperiment) {
        return new Response('Benchmark run is not owned by this user', { status: 403, headers: corsHeaders });
      }
      const snapshot = benchmarkRun.config_snapshot || {};
      agent = {
        ...agent,
        model: snapshot.model || agent.model,
        voice: snapshot.voice || agent.voice,
        instructions: snapshot.instructions || agent.instructions,
        max_response_output_tokens: snapshot.max_response_output_tokens || agent.max_response_output_tokens,
        turn_detection_enabled: snapshot.turn_detection_enabled ?? agent.turn_detection_enabled,
        turn_detection_config: snapshot.turn_detection_config || agent.turn_detection_config
      };
      usesGPTLive = voiceProvider === 'openai_realtime' && isGPTLiveModel(agent.model);
    }

    const turnDetection = agent.turn_detection_enabled === false
      ? null
      : agent.turn_detection_config || {
          type: 'server_vad',
          threshold: 0.75,
          prefix_padding_ms: 300,
          silence_duration_ms: 700
        };
    const liveTools = usesGPTLive ? await loadLiveFunctionTools(agentId, vaUser.id) : [];
    const knowledgeSpaceIds = (agent.knowledge_spaces || [])
      .map((binding: any) => binding.space_id)
      .filter((spaceId: unknown): spaceId is string => typeof spaceId === 'string' && Boolean(spaceId));
    if (usesGPTLive && agent.rag_enabled && knowledgeSpaceIds.length && !liveTools.some((tool) => tool.name === 'search_knowledge_base')) {
      liveTools.push({
        type: 'function',
        name: 'search_knowledge_base',
        description: agent.rag_mode === 'guardrail'
          ? 'Search the approved knowledge base. Use this before answering questions that depend on company knowledge, and do not invent an answer when evidence is unavailable.'
          : 'Search the approved knowledge base for information relevant to the user request.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'The question or lookup query' } },
          required: ['query'],
          additionalProperties: false
        }
      });
    }
    const liveBackendInstructions = usesGPTLive && agent.rag_enabled && knowledgeSpaceIds.length
      ? `${agent.instructions || ''}\n\nUse search_knowledge_base for requests that depend on approved company knowledge.${agent.rag_mode === 'guardrail' ? ' If the tool does not return sufficient evidence, say that the approved knowledge is insufficient instead of guessing.' : ''}`.trim()
      : agent.instructions;
    const session = usesGPTLive ? gptLiveSession({
      instructions: liveBackendInstructions,
      conversationInstructions: agent.voice_persona_prompt,
      voice: agent.voice,
      backendModel: agent.voice_provider_config?.backend_model || agent.chat_model,
      tools: liveTools
    }) : routedSessionId ? liveVoiceSession({ model: voiceProvider === 'xai_realtime' ? undefined : agent.model, voice: agent.voice, textOnly: voiceProvider !== 'openai_realtime', turn_detection: turnDetection }) : {
      type: 'realtime',
      model: normalizeRealtimeModel(agent.model || OPENAI_MODELS.realtime.default),
      output_modalities: isClientSecretRequest ? ['text'] : ['audio'],
      instructions: agent.instructions || undefined,
      audio: {
        input: {
          ...(turnDetection ? { turn_detection: turnDetection } : { turn_detection: null })
        },
        output: { voice: sanitizeVoice(agent.voice) }
      },
      max_output_tokens: agent.max_response_output_tokens || 4096
    };

    const safetyIdentifier = await hashSafetyIdentifier(vaUser.id);
    if (usesGPTLive) {
      if (!isLiveWebRTCRequest || !jsonBody.sdp.trim()) {
        return new Response(JSON.stringify({ error: 'GPT-Live requires a WebRTC SDP offer' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      const openAIResponse = await fetch(`${OPENAI_BASE_URL}/live/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          'OpenAI-Safety-Identifier': safetyIdentifier
        },
        body: JSON.stringify({
          session,
          transport: { type: 'webrtc', sdp: jsonBody.sdp }
        })
      });
      return new Response(await openAIResponse.text(), {
        status: openAIResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (isClientSecretRequest) {
      if (jsonBody?.transport !== 'websocket') {
        return new Response(JSON.stringify({ error: 'transport must be websocket' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const openAIResponse = await fetch(`${OPENAI_BASE_URL}/realtime/client_secrets`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          'OpenAI-Safety-Identifier': safetyIdentifier
        },
        body: JSON.stringify({ session })
      });
      const responseBody = await openAIResponse.text();
      if (!openAIResponse.ok) {
        return new Response(responseBody, {
          status: openAIResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const payload = JSON.parse(responseBody);
      const token = payload?.value ?? payload?.client_secret?.value;
      if (!token) throw new Error('Realtime API did not return a client secret');
      return new Response(JSON.stringify({
        token,
        expires_at: payload?.expires_at ?? payload?.client_secret?.expires_at ?? null
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const form = new FormData();
    form.set('sdp', await req.text());
    form.set('session', JSON.stringify(session));
    const openAIResponse = await fetch(`${OPENAI_BASE_URL}/realtime/calls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Safety-Identifier': safetyIdentifier
      },
      body: form
    });
    const responseBody = await openAIResponse.text();
    return new Response(responseBody, {
      status: openAIResponse.status,
      headers: {
        ...corsHeaders,
        'Content-Type': openAIResponse.ok ? 'application/sdp' : 'text/plain'
      }
    });
  } catch (error) {
    console.error('[realtime-session]', error);
    return new Response(error instanceof Error ? error.message : 'Failed to create Realtime session', {
      status: 500,
      headers: corsHeaders
    });
  }
});
