import { createClient } from 'npm:@supabase/supabase-js@2.112.2';
import { jwtVerify, SignJWT } from 'npm:jose@5.2.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const JWT_SECRET = Deno.env.get('ELEVENLABS_GATEWAY_JWT_SECRET');
const RELAY_TTL_SECONDS = Number(Deno.env.get('ELEVENLABS_RELAY_TOKEN_TTL_SECONDS') || 3600);
const ELEVENLABS_BASE_URL = Deno.env.get('ELEVENLABS_BASE_URL') || 'https://api.elevenlabs.io';
const ELEVENLABS_TIMEOUT_MS = Number(Deno.env.get('ELEVENLABS_UPSTREAM_TIMEOUT_MS') || 65000);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase service role credentials are missing');
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

type GatewayClaims = {
  purpose?: string;
  voice_provider?: string;
  agent_id?: string;
  session_id?: string;
  allowed_origins?: string[];
  voice_id?: string | null;
  elevenlabs_key_id?: string;
  elevenlabs_model_id?: string;
  elevenlabs_output_format?: string;
  elevenlabs_voice_settings?: Record<string, unknown> | null;
  elevenlabs_expressive_mode?: boolean;
};

type RelayRequest = {
  action?: 'validate' | 'tts-token' | 'speak';
  token?: string;
  relay_token?: string;
  agent_id?: string;
  session_id?: string;
  origin?: string;
  text?: string;
};

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
    return value;
  }
}

function isOriginAllowed(origin: string | null, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  return allowed.some((stored) => stored === '*' || normalizeOrigin(stored) === normalized);
}

async function verifyToken(token: string): Promise<GatewayClaims> {
  if (!JWT_SECRET) throw new Error('ELEVENLABS_GATEWAY_JWT_SECRET not configured');
  const secret = new TextEncoder().encode(JWT_SECRET);
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
  return payload as GatewayClaims;
}

function validateScope(claims: GatewayClaims, request: RelayRequest, relay = false) {
  if (relay) {
    if (claims.purpose !== 'elevenlabs-relay') throw new Error('Invalid relay token');
  } else if (claims.voice_provider !== 'elevenlabs_tts') {
    throw new Error('Invalid voice provider');
  }

  if (!request.agent_id || claims.agent_id !== request.agent_id) throw new Error('Agent scope mismatch');
  if (!request.session_id || claims.session_id !== request.session_id) throw new Error('Session scope mismatch');
  if (!isOriginAllowed(normalizeOrigin(request.origin), claims.allowed_origins)) {
    throw new Error('Origin not allowed');
  }
  if (!claims.elevenlabs_key_id || !claims.voice_id) throw new Error('Incomplete ElevenLabs configuration');
}

async function resolveProviderKey(keyId: string): Promise<string> {
  const { data, error } = await adminClient
    .from('va_provider_keys')
    .select('encrypted_key, provider')
    .eq('id', keyId)
    .single();
  if (error || !data || data.provider !== 'elevenlabs') {
    throw new Error('Unable to resolve ElevenLabs provider key');
  }
  try {
    const value = atob(data.encrypted_key || '').trim();
    if (!value) throw new Error('empty key');
    return value;
  } catch {
    throw new Error('Stored ElevenLabs API key is invalid');
  }
}

async function createTtsWebsocketSession(claims: GatewayClaims) {
  const modelId = claims.elevenlabs_model_id || 'eleven_flash_v2_5';
  if (modelId === 'eleven_v3') {
    return { transport: 'http' as const };
  }

  const apiKey = await resolveProviderKey(claims.elevenlabs_key_id!);
  const base = new URL(ELEVENLABS_BASE_URL);
  const cleanPath = base.pathname.replace(/\/+$/, '');
  base.pathname = `${cleanPath.endsWith('/v1') ? cleanPath.slice(0, -3) : cleanPath}/v1/single-use-token/tts_websocket`
    .replace(/\/{2,}/g, '/');
  base.search = '';
  base.hash = '';

  const response = await fetch(base, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.token) {
    const reason = payload?.detail?.message || payload?.detail || payload?.error || response.statusText;
    throw new Error(`Unable to create ElevenLabs TTS token (${response.status}): ${reason || 'unknown'}`);
  }

  return {
    transport: 'websocket' as const,
    tts_websocket_token: payload.token,
    voice_id: claims.voice_id,
    model_id: modelId,
    output_format: claims.elevenlabs_output_format || 'pcm_24000',
    voice_settings: claims.elevenlabs_voice_settings || {
      stability: 0.5,
      similarity_boost: 0.75,
      use_speaker_boost: false
    }
  };
}

async function synthesize(claims: GatewayClaims, text: string): Promise<Response> {
  const apiKey = await resolveProviderKey(claims.elevenlabs_key_id!);
  const base = new URL(ELEVENLABS_BASE_URL);
  const cleanPath = base.pathname.replace(/\/+$/, '');
  base.pathname = cleanPath.endsWith('/v1') ? cleanPath.slice(0, -3) || '/' : cleanPath || '/';
  base.search = '';
  base.hash = '';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ELEVENLABS_TIMEOUT_MS);
  try {
    const voiceId = encodeURIComponent(claims.voice_id!);
    const paths = [`/v1/text-to-speech/${voiceId}/stream`, `/v1/text-to-speech/${voiceId}`];
    let lastError: Error | null = null;

    for (const path of paths) {
      const url = new URL(path, base);
      url.searchParams.set('output_format', claims.elevenlabs_output_format || 'pcm_24000');
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/octet-stream'
        },
        body: JSON.stringify({
          text,
          model_id: claims.elevenlabs_model_id || 'eleven_flash_v2_5',
          voice_settings: claims.elevenlabs_voice_settings || undefined
        }),
        signal: controller.signal
      });
      if (response.ok) return response;

      const reason = (await response.text()).slice(0, 300) || response.statusText || 'unknown';
      lastError = new Error(`ElevenLabs request failed: ${response.status} ${reason}`);
      if (response.status !== 404) throw lastError;
    }

    throw lastError || new Error('ElevenLabs request failed');
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const request = (await req.json()) as RelayRequest;

    if (request.action === 'validate') {
      if (!request.token) return jsonResponse({ error: 'Gateway token is required' }, 400);
      const claims = await verifyToken(request.token);
      validateScope(claims, request);
      await resolveProviderKey(claims.elevenlabs_key_id!);

      const secret = new TextEncoder().encode(JWT_SECRET!);
      const relayToken = await new SignJWT({
        ...claims,
        purpose: 'elevenlabs-relay'
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${RELAY_TTL_SECONDS}s`)
        .sign(secret);
      const ttsSession = await createTtsWebsocketSession(claims).catch((error) => {
        console.warn('[elevenlabs-speech] WebSocket token unavailable; using HTTP streaming', error);
        return { transport: 'http' as const };
      });
      return jsonResponse({ relay_token: relayToken, ...ttsSession });
    }

    if (request.action === 'tts-token') {
      if (!request.relay_token) return jsonResponse({ error: 'Relay token is required' }, 400);
      const claims = await verifyToken(request.relay_token);
      validateScope(claims, request, true);
      return jsonResponse(await createTtsWebsocketSession(claims));
    }

    if (request.action === 'speak') {
      if (!request.relay_token) return jsonResponse({ error: 'Relay token is required' }, 400);
      const claims = await verifyToken(request.relay_token);
      validateScope(claims, request, true);
      const text = `${request.text || ''}`.trim();
      if (!text) return jsonResponse({ error: 'Text is required' }, 400);
      if (text.length > 5000) return jsonResponse({ error: 'Text exceeds 5000 characters' }, 400);

      const upstream = await synthesize(claims, text);
      return new Response(upstream.body, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/octet-stream' }
      });
    }

    return jsonResponse({ error: 'Unsupported action' }, 400);
  } catch (error) {
    console.error('[elevenlabs-speech]', error);
    const message = error instanceof Error ? error.message : 'ElevenLabs relay failed';
    const status = /token|scope|origin|provider|signature|jwt|expired/i.test(message) ? 401 : 500;
    return jsonResponse({ error: message }, status);
  }
});
