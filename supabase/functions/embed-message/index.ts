import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase service role environment variables are not configured');
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type MessagePayload = {
  public_id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  audio_metadata?: Record<string, any> | null;
};

type EmbedRecord = {
  id: string;
  public_id: string;
  allowed_origins: string[];
  agent_config_id: string;
  agent_config: {
    id: string;
    user_id: string;
  } | null;
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

async function fetchEmbed(
  publicId: string,
  preferredType?: 'chat' | 'voice'
): Promise<{ embed: EmbedRecord; embedType: 'chat' | 'voice' } | null> {
  const baseSelect = `
    id,
    public_id,
    allowed_origins,
    agent_config_id,
    agent_config:va_agent_configs(id, user_id)
  `;

  if (preferredType === 'chat') {
    const { data, error } = await adminClient
      .from('va_agent_embeds')
      .select(baseSelect)
      .eq('public_id', publicId)
      .eq('is_enabled', true)
      .maybeSingle();
    if (data) {
      return { embed: data as EmbedRecord, embedType: 'chat' };
    }
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    return null;
  }

  if (preferredType === 'voice') {
    const { data, error } = await adminClient
      .from('va_voice_embeds')
      .select(baseSelect)
      .eq('public_id', publicId)
      .eq('is_enabled', true)
      .maybeSingle();
    if (data) {
      return { embed: data as EmbedRecord, embedType: 'voice' };
    }
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    return null;
  }

  const { data: chatEmbed, error: chatError } = await adminClient
    .from('va_agent_embeds')
    .select(baseSelect)
    .eq('public_id', publicId)
    .eq('is_enabled', true)
    .maybeSingle();

  if (chatEmbed) {
    return { embed: chatEmbed as EmbedRecord, embedType: 'chat' };
  }

  if (chatError && chatError.code !== 'PGRST116') {
    throw chatError;
  }

  const { data: voiceEmbed, error: voiceError } = await adminClient
    .from('va_voice_embeds')
    .select(baseSelect)
    .eq('public_id', publicId)
    .eq('is_enabled', true)
    .maybeSingle();

  if (voiceEmbed) {
    return { embed: voiceEmbed as EmbedRecord, embedType: 'voice' };
  }

  if (voiceError && voiceError.code !== 'PGRST116') {
    throw voiceError;
  }

  return null;
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
    const body = (await req.json()) as MessagePayload;
    if (!body?.public_id || !body?.session_id || !body?.role) {
      return new Response(JSON.stringify({ error: 'public_id, session_id, and role are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const content = (body.content || '').trim();
    if (!content) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const sessionId = body.session_id;
    let sessionInfo: { id: string; agent_id: string; session_metadata: Record<string, any> | null } | null = null;
    let preferredType: 'chat' | 'voice' | undefined;
    let publicId = body.public_id;

    const { data: sessionData } = await adminClient
      .from('va_sessions')
      .select('id, agent_id, session_metadata')
      .eq('id', sessionId)
      .maybeSingle();
    if (sessionData?.id) {
      sessionInfo = sessionData;
      const metadata = sessionData.session_metadata || {};
      if (
        metadata.source === 'voice-embed' ||
        metadata.voice_embed_id ||
        metadata.voice_embed_public_id
      ) {
        preferredType = 'voice';
        publicId = metadata.voice_embed_public_id || publicId;
      } else if (metadata.source === 'embed' || metadata.embed_id || metadata.embed_public_id) {
        preferredType = 'chat';
        publicId = metadata.embed_public_id || publicId;
      }
    }

    const embedRecord = await fetchEmbed(publicId, preferredType);
    if (!embedRecord) {
      return new Response(JSON.stringify({ error: 'Embed not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const originHeader = req.headers.get('origin') || req.headers.get('referer');
    if (!isOriginAllowed(originHeader, embedRecord.embed.allowed_origins || [])) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!embedRecord.embed.agent_config?.user_id) {
      return new Response(JSON.stringify({ error: 'Embed owner missing' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!sessionInfo?.id || sessionInfo.agent_id !== embedRecord.embed.agent_config_id) {
      return new Response(JSON.stringify({ error: 'Session mismatch' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await adminClient.from('va_messages').insert({
      session_id: sessionInfo.id,
      user_id: embedRecord.embed.agent_config.user_id,
      role: body.role,
      content,
      audio_metadata: body.audio_metadata || {}
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('[embed-message] error', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
