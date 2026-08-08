import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { OPENAI_MODELS } from '../../../shared/openai-models.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase credentials are missing');
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function hashIdentifier(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const { data: authData, error: authError } = token
      ? await adminClient.auth.getUser(token)
      : { data: { user: null }, error: new Error('Missing token') };
    if (authError || !authData.user) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    const body = await req.json();
    if (!body?.query) return new Response('query is required', { status: 400, headers: corsHeaders });

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODELS.chat.economy,
        input: body.query,
        tools: [{ type: 'web_search' }],
        tool_choice: 'auto',
        max_output_tokens: 1200,
        reasoning: { effort: 'low' },
        text: { verbosity: 'low' },
        safety_identifier: await hashIdentifier(authData.user.id),
        store: false
      })
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Web search failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
