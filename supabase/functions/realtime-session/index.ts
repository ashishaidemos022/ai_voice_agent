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
    if (req.method !== 'POST' || !req.headers.get('content-type')?.includes('application/sdp')) {
      return new Response('Expected an application/sdp POST request', { status: 415, headers: corsHeaders });
    }
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');

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

    const { data: agent, error: agentError } = await adminClient
      .from('va_agent_configs')
      .select('id,user_id,model,voice,instructions,max_response_output_tokens,turn_detection_enabled,turn_detection_config')
      .eq('id', agentId)
      .eq('user_id', vaUser.id)
      .maybeSingle();
    if (agentError) throw agentError;
    if (!agent) {
      return new Response('Agent configuration not found', { status: 404, headers: corsHeaders });
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
      output_modalities: ['audio'],
      instructions: agent.instructions || undefined,
      audio: {
        input: {
          ...(turnDetection ? { turn_detection: turnDetection } : { turn_detection: null })
        },
        output: { voice: sanitizeVoice(agent.voice) }
      },
      max_output_tokens: agent.max_response_output_tokens || 4096
    };

    const form = new FormData();
    form.set('sdp', await req.text());
    form.set('session', JSON.stringify(session));
    const openAIResponse = await fetch(`${OPENAI_BASE_URL}/realtime/calls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Safety-Identifier': await hashSafetyIdentifier(vaUser.id)
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
