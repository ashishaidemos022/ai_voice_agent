// ElevenLabs Realtime Translation broker.
//
//   action "token"   (browser, Supabase user JWT)  → short-lived gateway token scoped to
//                     one user, one origin and one translation direction.
//   action "resolve" (Vercel gateway only, shared secret header) → decrypted ElevenLabs key +
//                     the upstream wss URL. ElevenLabs has no single-use token type for
//                     /v1/translation/realtime, so the key has to reach the proxy server-side;
//                     it never reaches the browser.
import { createClient } from 'npm:@supabase/supabase-js@2.112.2';
import { jwtVerify, SignJWT } from 'npm:jose@5.2.4';
import {
  buildTranslationUpstreamUrl,
  normalizeTranslationConfig,
  type TranslationSessionConfig
} from '../../../shared/realtime-translation.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const JWT_SECRET = Deno.env.get('ELEVENLABS_GATEWAY_JWT_SECRET');
const GATEWAY_SECRET = Deno.env.get('ELEVENLABS_TRANSLATION_GATEWAY_SECRET');
const TOKEN_TTL_SECONDS = Number(Deno.env.get('ELEVENLABS_TRANSLATION_TOKEN_TTL_SECONDS') || 90);
const ELEVENLABS_WS_BASE_URL = Deno.env.get('ELEVENLABS_TRANSLATION_WS_BASE_URL') || 'wss://api.elevenlabs.io';
const DEFAULT_GATEWAY_WS_URL = Deno.env.get('ELEVENLABS_TRANSLATION_GATEWAY_WS_URL') ||
  'wss://ai-voice-agent-sage.vercel.app/api/translate-ws';
const TOKEN_PURPOSE = 'elevenlabs-translation';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase service role credentials are missing');
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

type TokenRequest = {
  action: 'token';
  provider_key_id?: string;
  session_id?: string;
  origin?: string;
  config?: Partial<TranslationSessionConfig>;
};

type ResolveRequest = {
  action: 'resolve';
  token?: string;
  origin?: string;
};

type TranslationClaims = {
  purpose?: string;
  sub?: string;
  session_id?: string;
  allowed_origins?: string[];
  elevenlabs_key_id?: string;
  translation?: ReturnType<typeof normalizeTranslationConfig>;
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

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

function resolveGatewayWsUrl(origin: string): string {
  try {
    const parsed = new URL(origin);
    const isProductionHost = parsed.hostname === 'ai-voice-agent-sage.vercel.app';
    const isProjectPreview = parsed.hostname.endsWith('-ashishs-projects-cb76c7ca.vercel.app');
    if (parsed.protocol === 'https:' && (isProductionHost || isProjectPreview)) {
      return `wss://${parsed.host}/api/translate-ws`;
    }
  } catch {
    // fall through
  }
  return DEFAULT_GATEWAY_WS_URL;
}

function secretBytes(): Uint8Array {
  if (!JWT_SECRET) throw new HttpError(500, 'ELEVENLABS_GATEWAY_JWT_SECRET not configured');
  return new TextEncoder().encode(JWT_SECRET);
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

async function handleToken(req: Request, request: TokenRequest) {
  const authHeader = req.headers.get('Authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!accessToken) throw new HttpError(401, 'Missing Authorization header');

  const { data: { user }, error: userError } = await adminClient.auth.getUser(accessToken);
  if (userError || !user) throw new HttpError(401, 'Unauthorized');

  const { data: vaUser } = await adminClient
    .from('va_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!vaUser?.id) throw new HttpError(403, 'User profile not found');

  const origin = normalizeOrigin(request.origin || req.headers.get('origin') || req.headers.get('referer'));
  if (!origin) throw new HttpError(400, 'origin is required');
  const sessionId = `${request.session_id || ''}`.trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(sessionId)) throw new HttpError(400, 'session_id is required');

  let config;
  try {
    config = normalizeTranslationConfig(request.config || {});
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Invalid translation config');
  }

  const keyQuery = adminClient
    .from('va_provider_keys')
    .select('id, user_id, provider')
    .eq('user_id', vaUser.id)
    .eq('provider', 'elevenlabs');
  const { data: keyRows, error: keyError } = request.provider_key_id
    ? await keyQuery.eq('id', request.provider_key_id).limit(1)
    : await keyQuery.order('created_at', { ascending: false }).limit(1);
  if (keyError) throw new HttpError(500, 'Unable to load ElevenLabs key');
  const keyRow = keyRows?.[0];
  if (!keyRow) throw new HttpError(404, 'Add an ElevenLabs API key in Create Agent → Provider keys first');

  const token = await new SignJWT({
    purpose: TOKEN_PURPOSE,
    session_id: sessionId,
    allowed_origins: [origin],
    elevenlabs_key_id: keyRow.id,
    translation: config
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(vaUser.id)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secretBytes());

  return jsonResponse({
    token,
    gateway_ws_url: resolveGatewayWsUrl(origin),
    expires_in: TOKEN_TTL_SECONDS
  });
}

async function handleResolve(req: Request, request: ResolveRequest) {
  if (!GATEWAY_SECRET) throw new HttpError(500, 'ELEVENLABS_TRANSLATION_GATEWAY_SECRET not configured');
  const presented = req.headers.get('x-viaana-gateway-secret') || '';
  if (!presented || !timingSafeEqual(presented, GATEWAY_SECRET)) throw new HttpError(401, 'Gateway not authorized');
  if (!request.token) throw new HttpError(400, 'token is required');

  let claims: TranslationClaims;
  try {
    const { payload } = await jwtVerify(request.token, secretBytes(), { algorithms: ['HS256'] });
    claims = payload as TranslationClaims;
  } catch {
    throw new HttpError(401, 'Invalid or expired translation token');
  }
  if (claims.purpose !== TOKEN_PURPOSE || !claims.translation || !claims.elevenlabs_key_id) {
    throw new HttpError(401, 'Invalid translation token');
  }
  const origin = normalizeOrigin(request.origin);
  if (!origin || !(claims.allowed_origins || []).includes(origin)) throw new HttpError(403, 'Origin not allowed');

  const { data: keyRow, error } = await adminClient
    .from('va_provider_keys')
    .select('encrypted_key, provider, user_id')
    .eq('id', claims.elevenlabs_key_id)
    .single();
  if (error || !keyRow || keyRow.provider !== 'elevenlabs' || keyRow.user_id !== claims.sub) {
    throw new HttpError(403, 'Unable to resolve ElevenLabs provider key');
  }
  let apiKey = '';
  try {
    apiKey = atob(keyRow.encrypted_key || '').trim();
  } catch {
    // handled below
  }
  if (!apiKey) throw new HttpError(500, 'Stored ElevenLabs API key is invalid');

  // Re-validate the signed config defensively before building the URL.
  const config = normalizeTranslationConfig(claims.translation);
  return jsonResponse({
    api_key: apiKey,
    upstream_url: buildTranslationUpstreamUrl(ELEVENLABS_WS_BASE_URL, config, claims.session_id),
    session_id: claims.session_id,
    user_id: claims.sub
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const request = await req.json();
    if (request?.action === 'token') return await handleToken(req, request as TokenRequest);
    if (request?.action === 'resolve') return await handleResolve(req, request as ResolveRequest);
    return jsonResponse({ error: 'Unsupported action' }, 400);
  } catch (error) {
    if (error instanceof HttpError) return jsonResponse({ error: error.message }, error.status);
    console.error('[elevenlabs-translation]', error instanceof Error ? error.message : error);
    return jsonResponse({ error: 'Unexpected error' }, 500);
  }
});
