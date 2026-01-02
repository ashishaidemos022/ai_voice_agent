import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};

type EmbedAction = 'get_embed' | 'create_embed' | 'update_embed';

interface EmbedRequestPayload {
  action: EmbedAction;
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
  logo_background_color?: string | null;
  widget_width?: number | null;
  widget_height?: number | null;
  button_image_url?: string | null;
  is_enabled?: boolean;
  rotate_public_id?: boolean;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Supabase environment variables are not configured');
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
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'agent';
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

async function ensureUniquePublicId(
  client: ReturnType<typeof createClient>,
  agentConfigId: string,
  baseName: string,
  defaults: {
    allowed_origins?: string[];
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
    logo_background_color?: string | null;
    widget_width?: number | null;
    widget_height?: number | null;
    button_image_url?: string | null;
  } = {}
) {
  const base = slugify(baseName);
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = randomSuffix(4);
    const candidate = `${base}-${suffix}`;
    const { data, error } = await client
      .from('va_agent_embeds')
      .insert({
        agent_config_id: agentConfigId,
        public_id: candidate,
        allowed_origins: defaults.allowed_origins ?? [],
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
        logo_background_color: defaults.logo_background_color ?? null,
        widget_width: defaults.widget_width ?? null,
        widget_height: defaults.widget_height ?? null,
        button_image_url: defaults.button_image_url ?? null
      })
      .select('*')
      .single();
    if (!error && data) {
      return data;
    }
    const isUniqueViolation = error?.message?.includes('va_agent_embeds_public_id_key');
    if (!isUniqueViolation) {
      throw error ?? new Error('Failed to create embed');
    }
  }
  throw new Error('Unable to generate unique embed id after multiple attempts');
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

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const payload = (await req.json()) as EmbedRequestPayload;
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

    switch (payload.action) {
      case 'get_embed': {
        const { data, error } = await supabase
          .from('va_agent_embeds')
          .select('*')
          .eq('agent_config_id', payload.agent_config_id)
          .maybeSingle();
        if (error) {
          throw error;
        }
        return new Response(JSON.stringify({ embed: data }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'create_embed': {
        const { data: config, error: configError } = await supabase
          .from('va_agent_configs')
          .select('id, name')
          .eq('id', payload.agent_config_id)
          .single();
        if (configError || !config) {
          throw configError ?? new Error('Agent config not found');
        }

        const existing = await supabase
          .from('va_agent_embeds')
          .select('id')
          .eq('agent_config_id', payload.agent_config_id)
          .maybeSingle();
        if (existing.error && existing.error.code !== 'PGRST116') {
          throw existing.error;
        }
        if (existing.data) {
          return new Response(JSON.stringify({ embed: existing.data, warning: 'Embed already exists' }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const defaults = {
          allowed_origins: parseOrigins(payload.allowed_origins),
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
          logo_background_color: payload.logo_background_color ?? null,
          widget_width: payload.widget_width ?? null,
          widget_height: payload.widget_height ?? null,
          button_image_url: payload.button_image_url ?? null
        };
        const created = await ensureUniquePublicId(supabase, payload.agent_config_id, config.name || 'agent', defaults);
        return new Response(JSON.stringify({ embed: created }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'update_embed': {
        const fields: Record<string, any> = {};
        if (payload.allowed_origins !== undefined) {
          fields.allowed_origins = parseOrigins(payload.allowed_origins);
        }
        if (payload.logo_url !== undefined) {
          fields.logo_url = payload.logo_url;
        }
        if (payload.brand_name !== undefined) {
          fields.brand_name = payload.brand_name;
        }
        if (payload.accent_color !== undefined) {
          fields.accent_color = payload.accent_color;
        }
        if (payload.background_color !== undefined) {
          fields.background_color = payload.background_color;
        }
        if (payload.surface_color !== undefined) {
          fields.surface_color = payload.surface_color;
        }
        if (payload.text_color !== undefined) {
          fields.text_color = payload.text_color;
        }
        if (payload.button_color !== undefined) {
          fields.button_color = payload.button_color;
        }
        if (payload.button_text_color !== undefined) {
          fields.button_text_color = payload.button_text_color;
        }
        if (payload.helper_text_color !== undefined) {
          fields.helper_text_color = payload.helper_text_color;
        }
        if (payload.corner_radius !== undefined) {
          fields.corner_radius = payload.corner_radius;
        }
        if (payload.font_family !== undefined) {
          fields.font_family = payload.font_family;
        }
        if (payload.wave_color !== undefined) {
          fields.wave_color = payload.wave_color;
        }
        if (payload.bubble_color !== undefined) {
          fields.bubble_color = payload.bubble_color;
        }
        if (payload.logo_background_color !== undefined) {
          fields.logo_background_color = payload.logo_background_color;
        }
        if (payload.widget_width !== undefined) {
          fields.widget_width = payload.widget_width;
        }
        if (payload.widget_height !== undefined) {
          fields.widget_height = payload.widget_height;
        }
        if (payload.button_image_url !== undefined) {
          fields.button_image_url = payload.button_image_url;
        }
        if (payload.is_enabled !== undefined) {
          fields.is_enabled = payload.is_enabled;
        }

        if (payload.rotate_public_id) {
          const { data: config, error: configError } = await supabase
            .from('va_agent_configs')
            .select('id, name')
            .eq('id', payload.agent_config_id)
            .single();
          if (configError || !config) {
            throw configError ?? new Error('Agent config not found');
          }

          const base = slugify(config.name || 'agent');
          let updatedSlug: string | null = null;
          for (let attempt = 0; attempt < 5; attempt++) {
            const candidate = `${base}-${randomSuffix(5)}`;
            const { data, error } = await supabase
              .from('va_agent_embeds')
              .update({ public_id: candidate })
              .eq('agent_config_id', payload.agent_config_id)
              .select('*')
              .single();
            if (!error && data) {
              updatedSlug = data.public_id;
              break;
            }
            const uniqueViolation = error?.message?.includes('va_agent_embeds_public_id_key');
            if (!uniqueViolation) {
              throw error ?? new Error('Failed to rotate public id');
            }
          }
          if (!updatedSlug) {
            throw new Error('Unable to rotate public id');
          }
        }

        if (Object.keys(fields).length > 0) {
          const { error: updateError } = await supabase
            .from('va_agent_embeds')
            .update(fields)
            .eq('agent_config_id', payload.agent_config_id);
          if (updateError) {
            throw updateError;
          }
        }

        const { data, error } = await supabase
          .from('va_agent_embeds')
          .select('*')
          .eq('agent_config_id', payload.agent_config_id)
          .single();
        if (error) {
          throw error;
        }
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
    console.error('[embed-service] error', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
