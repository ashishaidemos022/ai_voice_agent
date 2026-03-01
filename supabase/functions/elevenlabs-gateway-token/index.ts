import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { SignJWT } from 'npm:jose@5.2.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GATEWAY_WS_URL = Deno.env.get('ELEVENLABS_GATEWAY_WS_URL');
const JWT_SECRET = Deno.env.get('ELEVENLABS_GATEWAY_JWT_SECRET');
const TOKEN_TTL_SECONDS = Number(Deno.env.get('ELEVENLABS_GATEWAY_TOKEN_TTL_SECONDS') || 90);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase service role credentials are missing');
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type GatewayTokenRequest = {
  agent_id?: string;
  agent_public_id?: string;
  session_id?: string;
  origin?: string;
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

function normalizeGatewayWsUrl(raw: string): string {
  const parsed = new URL(raw);
  if (!parsed.pathname || parsed.pathname === '/') {
    parsed.pathname = '/ws';
  }
  return parsed.toString();
}

async function signGatewayToken(payload: Record<string, unknown>) {
  if (!JWT_SECRET) {
    throw new Error('ELEVENLABS_GATEWAY_JWT_SECRET not configured');
  }
  const secret = new TextEncoder().encode(JWT_SECRET);
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .setIssuedAt()
    .sign(secret);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    if (!GATEWAY_WS_URL) {
      throw new Error('ELEVENLABS_GATEWAY_WS_URL not configured');
    }
    const gatewayWsUrl = normalizeGatewayWsUrl(GATEWAY_WS_URL);

    const payload = (await req.json()) as GatewayTokenRequest;
    const originHeader = payload.origin || req.headers.get('origin') || req.headers.get('referer');
    const origin = normalizeOrigin(originHeader);

    if (!payload.agent_id && !payload.agent_public_id) {
      return new Response(JSON.stringify({ error: 'agent_id or agent_public_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!payload.session_id) {
      return new Response(JSON.stringify({ error: 'session_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!origin) {
      return new Response(JSON.stringify({ error: 'origin is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let agentConfig: any = null;
    let allowedOrigins: string[] = [];
    let subject = 'embed';

    if (payload.agent_public_id) {
      const { data, error } = await adminClient
        .from('va_voice_embeds')
        .select(
          `
            id,
            public_id,
            allowed_origins,
            agent_config:va_agent_configs(
              id,
              user_id,
              instructions,
              voice_provider,
              voice_id,
              voice_provider_key_id,
              voice_provider_config
            )
          `
        )
        .eq('public_id', payload.agent_public_id)
        .eq('is_enabled', true)
        .single();
      if (error || !data?.agent_config) {
        return new Response(JSON.stringify({ error: 'Voice embed not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      allowedOrigins = data.allowed_origins || [];
      if (!isOriginAllowed(origin, allowedOrigins)) {
        return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      agentConfig = data.agent_config;
      subject = 'embed';
    } else if (payload.agent_id) {
      const authHeader = req.headers.get('Authorization') || '';
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const {
        data: { user },
        error: userError
      } = await adminClient.auth.getUser(token);

      if (userError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { data: vaUser, error: vaUserError } = await adminClient
        .from('va_users')
        .select('id')
        .eq('auth_user_id', user.id)
        .maybeSingle();

      if (vaUserError || !vaUser?.id) {
        return new Response(JSON.stringify({ error: 'User profile not found' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { data: config, error: configError } = await adminClient
        .from('va_agent_configs')
        .select('id, user_id, instructions, voice_provider, voice_id, voice_provider_key_id, voice_provider_config')
        .eq('id', payload.agent_id)
        .single();

      if (configError || !config) {
        return new Response(JSON.stringify({ error: 'Agent config not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      if (config.user_id && config.user_id !== vaUser.id) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      allowedOrigins = [origin];
      agentConfig = config;
      subject = vaUser.id;
    }

    if (!agentConfig || agentConfig.voice_provider !== 'elevenlabs_tts') {
      return new Response(JSON.stringify({ error: 'ElevenLabs TTS not enabled for this agent' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!agentConfig.voice_provider_key_id) {
      return new Response(JSON.stringify({ error: 'ElevenLabs provider key missing for this agent' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: keyRow, error: keyError } = await adminClient
      .from('va_provider_keys')
      .select('id, user_id, provider')
      .eq('id', agentConfig.voice_provider_key_id)
      .single();

    if (keyError || !keyRow) {
      return new Response(JSON.stringify({ error: 'ElevenLabs provider key not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (keyRow.provider !== 'elevenlabs') {
      return new Response(JSON.stringify({ error: 'Invalid provider key type for ElevenLabs' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (agentConfig.user_id && keyRow.user_id !== agentConfig.user_id) {
      return new Response(JSON.stringify({ error: 'Provider key does not belong to agent owner' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const providerConfig = (agentConfig.voice_provider_config && typeof agentConfig.voice_provider_config === 'object')
      ? agentConfig.voice_provider_config
      : {};
    const expressiveMode = Boolean(providerConfig.expressive_mode);
    const resolvedModelId = providerConfig.model_id || (expressiveMode ? 'eleven_v3' : 'eleven_multilingual_v2');

    const token = await signGatewayToken({
      sub: subject,
      agent_id: agentConfig.id,
      session_id: payload.session_id,
      allowed_origins: allowedOrigins,
      voice_provider: 'elevenlabs_tts',
      voice_id: agentConfig.voice_id || null,
      elevenlabs_key_id: keyRow.id,
      elevenlabs_model_id: resolvedModelId,
      elevenlabs_output_format: providerConfig.output_format || 'pcm_24000',
      elevenlabs_voice_settings: providerConfig.voice_settings || null,
      elevenlabs_expressive_mode: expressiveMode
    });

    return new Response(
      JSON.stringify({
        token,
        gateway_ws_url: gatewayWsUrl,
        expires_in: TOKEN_TTL_SECONDS
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[elevenlabs-gateway-token] error', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
