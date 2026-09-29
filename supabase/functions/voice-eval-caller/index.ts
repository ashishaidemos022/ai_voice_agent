import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { OPENAI_MODELS } from '../../../shared/openai-models.ts';
import { BRAIN_OUTPUT_SCHEMA, type BrainRequest } from '../../../shared/voice-eval/caller/brain-prompt.ts';
import { handleCallerRequest, type CallerDeps } from '../../../shared/voice-eval/caller/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_BASE_URL = Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
const ELEVENLABS_BASE_URL = (Deno.env.get('ELEVENLABS_BASE_URL') || 'https://api.elevenlabs.io').replace(/\/+$/, '').replace(/\/v1$/, '');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase service role credentials are missing');
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function decodeKey(encrypted: string | null | undefined): string | null {
  try {
    const value = atob(encrypted || '').trim();
    return value || null;
  } catch {
    return null;
  }
}

function outputText(json: Record<string, any>): string {
  if (typeof json.output_text === 'string') return json.output_text;
  return (Array.isArray(json.output) ? json.output : [])
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .filter((content: any) => content?.type === 'output_text')
    .map((content: any) => (typeof content.text === 'string' ? content.text : ''))
    .join('');
}

const deps: CallerDeps = {
  async loadRun(ownerId, runId) {
    const { data } = await adminClient
      .from('voice_eval_runs')
      .select('id, scenario_id, status, agent_config_id')
      .eq('id', runId)
      .eq('owner_id', ownerId)
      .maybeSingle();
    return data;
  },
  async resolveElevenLabsKey(ownerId, agentConfigId) {
    if (agentConfigId) {
      const { data: config } = await adminClient
        .from('va_agent_configs')
        .select('voice_provider_key_id')
        .eq('id', agentConfigId)
        .eq('user_id', ownerId)
        .maybeSingle();
      if (config?.voice_provider_key_id) {
        const { data: key } = await adminClient
          .from('va_provider_keys')
          .select('encrypted_key')
          .eq('id', config.voice_provider_key_id)
          .eq('provider', 'elevenlabs')
          .maybeSingle();
        const value = decodeKey(key?.encrypted_key);
        if (value) return value;
      }
    }
    const { data: fallback } = await adminClient
      .from('va_provider_keys')
      .select('encrypted_key')
      .eq('user_id', ownerId)
      .eq('provider', 'elevenlabs')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return decodeKey(fallback?.encrypted_key);
  },
  async brain(request: BrainRequest) {
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODELS.chat.mini,
        instructions: request.instructions,
        input: [{ role: 'user', content: request.input }],
        reasoning: { effort: 'none' },
        text: { format: { type: 'json_schema', name: 'caller_turn', strict: true, schema: BRAIN_OUTPUT_SCHEMA } },
        max_output_tokens: 200,
        store: false
      })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json?.error?.message || `OpenAI request failed (${response.status})`);
    return outputText(json);
  },
  async tts(apiKey, voiceId, text) {
    const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=pcm_24000`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`ElevenLabs TTS failed (${response.status}): ${detail.slice(0, 200)}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return jsonResponse({ error: 'Authentication required' }, 401);
    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData.user) return jsonResponse({ error: 'Invalid session' }, 401);
    const { data: vaUser } = await adminClient.from('va_users').select('id').eq('auth_user_id', authData.user.id).maybeSingle();
    if (!vaUser) return jsonResponse({ error: 'User profile not found' }, 403);
    const body = await req.json().catch(() => ({}));
    const result = await handleCallerRequest(deps, vaUser.id, body && typeof body === 'object' ? body : {});
    if (result.status >= 500) console.error('[voice-eval-caller]', result.body.error);
    return jsonResponse(result.body, result.status);
  } catch (error) {
    console.error('[voice-eval-caller]', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Synthetic caller failed' }, 500);
  }
});
