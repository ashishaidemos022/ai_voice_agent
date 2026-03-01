import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};

type VoiceEmbedAction = 'get_embed' | 'create_embed' | 'update_embed';

interface VoiceEmbedRequestPayload {
  action: VoiceEmbedAction;
  agent_config_id?: string;
  allowed_origins?: string[] | string;
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
  widget_width?: number | null;
  widget_height?: number | null;
  button_image_url?: string | null;
  is_enabled?: boolean;
  rtc_enabled?: boolean;
  tts_voice?: string | null;
  rotate_public_id?: boolean;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase environment variables are not configured');
}

// Uses service role to bypass RLS, but we enforce ownership checks explicitly.
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function parseAuthUserId(authBearerToken: string): string {
  const token = authBearerToken.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw new Error('Unauthorized');
  }
  const [, payloadBase64] = token.split('.');
  if (!payloadBase64) {
    throw new Error('Unauthorized');
  }
  const normalized = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  let payload: any;
  try {
    payload = JSON.parse(atob(padded));
  } catch {
    throw new Error('Unauthorized');
  }
  const sub = typeof payload?.sub === 'string' ? payload.sub : null;
  if (!sub) {
    throw new Error('Unauthorized');
  }
  return sub;
}

async function resolveVaUserId(authBearerToken: string): Promise<string> {
  const authUserId = parseAuthUserId(authBearerToken);

  const { data: vaUser, error: vaUserError } = await adminClient
    .from('va_users')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (vaUserError || !vaUser?.id) {
    throw new Error('User profile not found');
  }

  return vaUser.id as string;
}

async function ensureOwnsAgentConfig(vaUserId: string, agentConfigId: string) {
  const { data: config, error } = await adminClient
    .from('va_agent_configs')
    .select('id, user_id, name, voice, voice_provider')
    .eq('id', agentConfigId)
    .single();
  if (error || !config) {
    throw error ?? new Error('Agent config not found');
  }
  if (config.user_id && config.user_id !== vaUserId) {
    throw new Error('Forbidden');
  }
  return config as {
    id: string;
    user_id: string | null;
    name: string | null;
    voice: string | null;
    voice_provider: string | null;
  };
}

function extractAuthHeader(req: Request): string | null {
  const direct = req.headers.get('Authorization') || req.headers.get('authorization');
  if (direct) return direct;
  const alt =
    req.headers.get('x-sb-access-token') ||
    req.headers.get('x-supabase-auth') ||
    req.headers.get('x-supabase-access-token');
  if (alt) {
    return alt.startsWith('Bearer ') ? alt : `Bearer ${alt}`;
  }
  const cookie = req.headers.get('cookie');
  if (cookie) {
    const token = cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('sb-access-token='))
      ?.split('=')[1];
    if (token) {
      return `Bearer ${token}`;
    }
  }
  return null;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'voice-agent'
  );
}

function randomSuffix(length = 4): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (value) => chars[value % chars.length]).join('');
}

function parseOrigins(input?: string[] | string): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .map((origin) => origin?.trim())
      .filter((origin): origin is string => Boolean(origin?.length));
  }
  return input
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function fetchEmbedById(id: string) {
  const { data, error } = await adminClient.from('va_voice_embeds').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function ensureUniqueVoicePublicId(
  client: ReturnType<typeof createClient>,
  agentConfigId: string,
  baseName: string,
  defaults: {
    allowed_origins?: string[];
    rtc_enabled?: boolean;
    tts_voice?: string | null;
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
    widget_width?: number | null;
    widget_height?: number | null;
    button_image_url?: string | null;
  } = {}
) {
  const base = slugify(baseName);
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = randomSuffix(5);
    const candidate = `${base}-${suffix}`;
    const insertPayload = {
      agent_config_id: agentConfigId,
      public_id: candidate,
      allowed_origins: defaults.allowed_origins ?? [],
      rtc_enabled: defaults.rtc_enabled ?? true,
      tts_voice: defaults.tts_voice ?? null,
      logo_url: defaults.logo_url ?? null,
      brand_name: defaults.brand_name ?? null,
      accent_color: defaults.accent_color ?? null,
      background_color: defaults.background_color ?? null,
      surface_color: defaults.surface_color ?? null,
      text_color: defaults.text_color ?? null,
      button_color: defaults.button_color ?? null,
      button_text_color: defaults.button_text_color ?? null,
      helper_text_color: defaults.helper_text_color ?? null,
      corner_radius: defaults.corner_radius ?? null,
      font_family: defaults.font_family ?? null,
      wave_color: defaults.wave_color ?? null,
      bubble_color: defaults.bubble_color ?? null,
      widget_width: defaults.widget_width ?? null,
      widget_height: defaults.widget_height ?? null,
      button_image_url: defaults.button_image_url ?? null
    };
    const { data, error } = await client.from('va_voice_embeds').insert(insertPayload).select('*').single();
    if (!error && data) return data;
    const isUniqueViolation = error?.message?.includes('va_voice_embeds_public_id_key');
    if (!isUniqueViolation) {
      throw error ?? new Error('Failed to create voice embed');
    }
  }
  throw new Error('Unable to generate unique voice embed id after multiple attempts');
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
    const authHeader = extractAuthHeader(req);
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let vaUserId: string;
    try {
      vaUserId = await resolveVaUserId(authHeader);
    } catch (authError: any) {
      return new Response(JSON.stringify({ error: authError?.message || 'Unauthorized' }), {
        status: authError?.message === 'Forbidden' ? 403 : 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const payload = (await req.json()) as VoiceEmbedRequestPayload;
    if (!payload?.action) {
      return new Response(JSON.stringify({ error: 'Missing action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!payload.agent_config_id) {
      return new Response(JSON.stringify({ error: 'agent_config_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Always enforce ownership via service role client (bypass RLS but keep security).
    const agentConfig = await ensureOwnsAgentConfig(vaUserId, payload.agent_config_id);
    const isOpenAI = !agentConfig.voice_provider || agentConfig.voice_provider === 'openai_realtime';

    switch (payload.action) {
      case 'get_embed': {
        const { data, error } = await adminClient
          .from('va_voice_embeds')
          .select('*')
          .eq('agent_config_id', payload.agent_config_id)
          .eq('user_id', vaUserId)
          .maybeSingle();
        if (error) throw error;

        // Self-heal legacy rows: tts_voice is an OpenAI-only override.
        // If this embed belongs to a non-OpenAI provider, always clear tts_voice.
        // If OpenAI and tts_voice matches the agent preset voice, clear it so future preset changes reflect.
        if (data?.id && data.tts_voice !== null) {
          const shouldClear = !isOpenAI || data.tts_voice === agentConfig.voice;
          if (shouldClear) {
            const { error: healError } = await adminClient
              .from('va_voice_embeds')
              .update({ tts_voice: null })
              .eq('id', data.id);
            if (healError) throw healError;
            const healed = await fetchEmbedById(data.id);
            return new Response(JSON.stringify({ embed: healed }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        }

        return new Response(JSON.stringify({ embed: data }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'create_embed': {
        const existing = await adminClient
          .from('va_voice_embeds')
          .select('*')
          .eq('agent_config_id', payload.agent_config_id)
          .eq('user_id', vaUserId)
          .maybeSingle();
        if (existing.error && existing.error.code !== 'PGRST116') {
          throw existing.error;
        }
        if (existing.data) {
          return new Response(JSON.stringify({ embed: existing.data, warning: 'Voice embed already exists' }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const defaults = {
          allowed_origins: parseOrigins(payload.allowed_origins),
          rtc_enabled: payload.rtc_enabled ?? true,
          // tts_voice is an OpenAI-only override. Default NULL so embeds follow the agent preset voice.
          tts_voice: isOpenAI ? payload.tts_voice ?? null : null,
          logo_url: payload.logo_url ?? null,
          brand_name: payload.brand_name ?? null,
          accent_color: payload.accent_color ?? null,
          background_color: payload.background_color ?? null,
          surface_color: payload.surface_color ?? null,
          text_color: payload.text_color ?? null,
          button_color: payload.button_color ?? null,
          button_text_color: payload.button_text_color ?? null,
          helper_text_color: payload.helper_text_color ?? null,
          corner_radius: payload.corner_radius ?? null,
          font_family: payload.font_family ?? null,
          wave_color: payload.wave_color ?? null,
          bubble_color: payload.bubble_color ?? null,
          widget_width: payload.widget_width ?? null,
          widget_height: payload.widget_height ?? null,
          button_image_url: payload.button_image_url ?? null
        };

        const created = await ensureUniqueVoicePublicId(
          adminClient,
          payload.agent_config_id,
          agentConfig.name || 'voice-agent',
          defaults
        );

        // Defensive self-heal + deterministic ownership.
        if (created?.id) {
          const patch: Record<string, any> = {};
          if (!isOpenAI && created.tts_voice !== null) patch.tts_voice = null;
          if (created.user_id !== vaUserId) patch.user_id = vaUserId;
          if (Object.keys(patch).length > 0) {
            await adminClient.from('va_voice_embeds').update(patch).eq('id', created.id);
          }
          const hydrated = await fetchEmbedById(created.id);
          return new Response(JSON.stringify({ embed: hydrated }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ embed: created }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'update_embed': {
        const fields: Record<string, any> = {};
        if (payload.allowed_origins !== undefined) fields.allowed_origins = parseOrigins(payload.allowed_origins);
        if (payload.logo_url !== undefined) fields.logo_url = payload.logo_url;
        if (payload.brand_name !== undefined) fields.brand_name = payload.brand_name;
        if (payload.accent_color !== undefined) fields.accent_color = payload.accent_color;
        if (payload.background_color !== undefined) fields.background_color = payload.background_color;
        if (payload.surface_color !== undefined) fields.surface_color = payload.surface_color;
        if (payload.text_color !== undefined) fields.text_color = payload.text_color;
        if (payload.button_color !== undefined) fields.button_color = payload.button_color;
        if (payload.button_text_color !== undefined) fields.button_text_color = payload.button_text_color;
        if (payload.helper_text_color !== undefined) fields.helper_text_color = payload.helper_text_color;
        if (payload.corner_radius !== undefined) fields.corner_radius = payload.corner_radius;
        if (payload.font_family !== undefined) fields.font_family = payload.font_family;
        if (payload.wave_color !== undefined) fields.wave_color = payload.wave_color;
        if (payload.bubble_color !== undefined) fields.bubble_color = payload.bubble_color;
        if (payload.widget_width !== undefined) fields.widget_width = payload.widget_width;
        if (payload.widget_height !== undefined) fields.widget_height = payload.widget_height;
        if (payload.button_image_url !== undefined) fields.button_image_url = payload.button_image_url;
        if (payload.is_enabled !== undefined) fields.is_enabled = payload.is_enabled;
        if (payload.rtc_enabled !== undefined) fields.rtc_enabled = payload.rtc_enabled;

        if (payload.tts_voice !== undefined) {
          // Only OpenAI realtime embeds can override voice via tts_voice.
          fields.tts_voice = isOpenAI ? payload.tts_voice : null;
        } else if (!isOpenAI) {
          // Self-heal on ANY update for non-OpenAI providers: tts_voice must always be NULL.
          fields.tts_voice = null;
        }

        if (payload.rotate_public_id) {
          const base = slugify(agentConfig.name || 'voice-agent');
          let updatedSlug: string | null = null;
          for (let attempt = 0; attempt < 5; attempt++) {
            const candidate = `${base}-${randomSuffix(5)}`;
            const { data, error } = await adminClient
              .from('va_voice_embeds')
              .update({ public_id: candidate })
              .eq('agent_config_id', payload.agent_config_id)
              .eq('user_id', vaUserId)
              .select('*')
              .single();
            if (!error && data) {
              updatedSlug = data.public_id;
              break;
            }
            const uniqueViolation = error?.message?.includes('va_voice_embeds_public_id_key');
            if (!uniqueViolation) {
              throw error ?? new Error('Failed to rotate voice embed id');
            }
          }
          if (!updatedSlug) throw new Error('Unable to rotate voice embed id');
        }

        if (Object.keys(fields).length > 0) {
          const { error: updateError } = await adminClient
            .from('va_voice_embeds')
            .update(fields)
            .eq('agent_config_id', payload.agent_config_id)
            .eq('user_id', vaUserId);
          if (updateError) throw updateError;
        }

        const { data, error } = await adminClient
          .from('va_voice_embeds')
          .select('*')
          .eq('agent_config_id', payload.agent_config_id)
          .eq('user_id', vaUserId)
          .single();
        if (error) throw error;

        return new Response(JSON.stringify({ embed: data }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unsupported action: ${payload.action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
  } catch (error: any) {
    console.error('[voice-embed-service] error', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
