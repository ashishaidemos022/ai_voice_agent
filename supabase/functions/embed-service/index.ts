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
  baseName: string
) {
  const base = slugify(baseName);
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = randomSuffix(4);
    const candidate = `${base}-${suffix}`;
    const { data, error } = await client
      .from('va_agent_embeds')
      .insert({ agent_config_id: agentConfigId, public_id: candidate })
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

        const created = await ensureUniquePublicId(supabase, payload.agent_config_id, config.name || 'agent');
        return new Response(JSON.stringify({ embed: created }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'update_embed': {
        const fields: Record<string, any> = {};
        if (payload.allowed_origins !== undefined) {
          fields.allowed_origins = parseOrigins(payload.allowed_origins);
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
