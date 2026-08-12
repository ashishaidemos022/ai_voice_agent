import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { OPENAI_MODELS, normalizeRealtimeModel } from '../../../shared/openai-models.ts';

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

function sanitizeVoice(value?: string | null): string {
  const voice = (value || 'marin').toLowerCase();
  return supportedVoices.has(voice) ? voice : 'marin';
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
    const isClientSecretRequest = contentType.includes('application/json');
    if (!isWebRTCRequest && !isClientSecretRequest) {
      return new Response('Expected an application/sdp or application/json POST request', {
        status: 415,
        headers: corsHeaders
      });
    }

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
      .select('id,user_id,model,voice,instructions,max_response_output_tokens,turn_detection_enabled,turn_detection_config,voice_provider,voice_provider_key_id')
      .eq('id', agentId)
      .eq('user_id', vaUser.id)
      .maybeSingle();
    if (agentError) throw agentError;
    if (!storedAgent) {
      return new Response('Agent configuration not found', { status: 404, headers: corsHeaders });
    }
    let agent = storedAgent;
    const voiceProvider = storedAgent.voice_provider || 'openai_realtime';

    if (voiceProvider === 'xai_realtime') {
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
    }

    const turnDetection = agent.turn_detection_enabled === false
      ? null
      : agent.turn_detection_config || {
          type: 'server_vad',
          threshold: 0.75,
          prefix_padding_ms: 150,
          silence_duration_ms: 700
        };
    const session = {
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
    if (isClientSecretRequest) {
      const requestBody = await req.json().catch(() => ({}));
      if (requestBody?.transport !== 'websocket') {
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
