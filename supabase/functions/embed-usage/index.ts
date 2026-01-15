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

type UsagePayload = {
  public_id: string;
  session_id?: string | null;
  model?: string | null;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    totalTokens?: number;
  };
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

type ModelPricing = {
  inputPer1K: number;
  outputPer1K: number;
};

const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-realtime': { inputPer1K: 0.005, outputPer1K: 0.015 },
  'gpt-4o-realtime-preview-2024-12-17': { inputPer1K: 0.005, outputPer1K: 0.015 },
  'gpt-4.1-mini': { inputPer1K: 0.00015, outputPer1K: 0.0006 }
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

function estimateUsageCost(model: string | null | undefined, inputTokens: number, outputTokens: number) {
  if (!model) return 0;
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (inputTokens / 1000) * pricing.inputPer1K + (outputTokens / 1000) * pricing.outputPer1K;
}

function normalizeUsage(usage?: UsagePayload['usage']) {
  if (!usage) return null;
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens) || 0;
  if (!inputTokens && !outputTokens && !totalTokens) return null;
  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens || inputTokens + outputTokens
  };
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
    const body = (await req.json()) as UsagePayload;
    if (!body?.public_id) {
      return new Response(JSON.stringify({ error: 'public_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const sessionId = body.session_id || null;
    let sessionInfo: { id: string; agent_id: string; session_metadata: Record<string, any> | null } | null = null;
    let preferredType: 'chat' | 'voice' | undefined;
    let publicId = body.public_id;

    if (sessionId) {
      const { data } = await adminClient
        .from('va_sessions')
        .select('id, agent_id, session_metadata')
        .eq('id', sessionId)
        .maybeSingle();
      if (data?.id) {
        sessionInfo = data;
        const metadata = data.session_metadata || {};
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

    if (sessionId) {
      const sessionData = sessionInfo;
      if (!sessionData?.id || sessionData.agent_id !== embedRecord.embed.agent_config_id) {
        return new Response(JSON.stringify({ error: 'Session mismatch' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    const usage = normalizeUsage(body.usage);
    if (!usage) {
      return new Response(JSON.stringify({ error: 'Usage payload missing' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const model = body.model || null;
    const costUsd = estimateUsageCost(model, usage.inputTokens, usage.outputTokens);

    await adminClient.from('va_usage_events').insert({
      user_id: embedRecord.embed.agent_config.user_id,
      source: embedRecord.embedType === 'voice' ? 'embed_voice' : 'embed_chat',
      model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      cost_usd: costUsd,
      metadata: {
        session_id: sessionId,
        embed_id: embedRecord.embed.id,
        embed_public_id: embedRecord.embed.public_id,
        agent_preset_id: embedRecord.embed.agent_config_id,
        embed_type: embedRecord.embedType
      }
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('[embed-usage] error', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
