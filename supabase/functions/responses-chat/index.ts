import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { normalizeChatModel, OPENAI_MODELS } from '../../../shared/openai-models.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_BASE_URL = Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase service role credentials are missing');
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function hashIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return new Response('Authentication required', { status: 401, headers: corsHeaders });
    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData.user) return new Response('Invalid session', { status: 401, headers: corsHeaders });
    const { data: vaUser } = await adminClient.from('va_users').select('id').eq('auth_user_id', authData.user.id).maybeSingle();
    if (!vaUser) return new Response('User profile not found', { status: 403, headers: corsHeaders });

    const body = await req.json();
    if (!body?.agent_id || !Array.isArray(body?.input)) {
      return new Response('agent_id and input are required', { status: 400, headers: corsHeaders });
    }
    const { data: agent, error: agentError } = await adminClient
      .from('va_agent_configs')
      .select('id,user_id,instructions,chat_model,model,max_response_output_tokens,a2ui_enabled')
      .eq('id', body.agent_id)
      .eq('user_id', vaUser.id)
      .maybeSingle();
    if (agentError) throw agentError;
    if (!agent) return new Response('Agent configuration not found', { status: 404, headers: corsHeaders });

    const model = normalizeChatModel(agent.chat_model || agent.model || OPENAI_MODELS.chat.default);
    const instructions = [
      agent.instructions,
      'Always reply in English unless the user explicitly asks for another language.',
      body.instructions_suffix
    ].filter(Boolean).join('\n\n');
    const payload: Record<string, unknown> = {
      model,
      instructions,
      input: body.input,
      tools: Array.isArray(body.tools) && body.tools.length ? body.tools : undefined,
      max_output_tokens: Math.min(Math.max(agent.max_response_output_tokens || 1024, 1), 8000),
      reasoning: model.startsWith('gpt-5.6') ? { effort: 'low' } : undefined,
      text: model.startsWith('gpt-5.6') ? { verbosity: 'low' } : undefined,
      safety_identifier: await hashIdentifier(vaUser.id),
      store: false
    };
    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(payload)
    });
    const responseBody = await response.text();
    return new Response(responseBody, {
      status: response.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[responses-chat]', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Responses request failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
