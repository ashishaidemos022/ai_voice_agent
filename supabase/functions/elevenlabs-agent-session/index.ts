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
  action?: 'list_agents' | 'signed_url';
  provider_key_id?: string;
  agent_id?: string;
  agent_public_id?: string;
  session_id?: string;
  origin?: string;
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
