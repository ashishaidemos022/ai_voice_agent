import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};

type TriggerRequest = {
  integration_id: string;
  payload?: Record<string, any>;
  summary?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  session_id?: string;
  metadata?: Record<string, any>;
};

async function signPayload(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const payloadData = encoder.encode(body);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, payloadData);
  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req: Request) => {
  const extractAuthHeader = (): string | null => {
    const direct =
      req.headers.get('Authorization') ||
      req.headers.get('authorization');
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
        .map(part => part.trim())
        .find(part => part.startsWith('sb-access-token='))
        ?.split('=')[1];
      if (token) {
        return `Bearer ${token}`;
      }
    }
    return null;
  };

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
    const authHeader = extractAuthHeader();
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('Supabase environment variables are not configured');
    }

    const authedClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const {
      data: { user },
      error: userError
    } = await authedClient.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { integration_id, payload, summary, severity, session_id, metadata }: TriggerRequest = await req.json();

    if (!integration_id) {
      return new Response(JSON.stringify({ error: 'integration_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: integration, error: integrationError } = await adminClient
      .from('va_n8n_integrations')
      .select('*')
      .eq('id', integration_id)
      .single();

    if (integrationError || !integration) {
      return new Response(JSON.stringify({ error: 'Integration not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (integration.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!integration.enabled) {
      return new Response(JSON.stringify({ error: 'Integration is disabled' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const eventEnvelope = {
      summary: summary || 'Voice agent triggered n8n automation',
      severity: severity || 'low',
      payload: payload || {},
      session: integration.forward_session_context
        ? {
            session_id: session_id || null,
            agent_config_id: integration.config_id,
            user_id: user.id
          }
        : null,
      metadata: metadata || {},
      triggered_at: new Date().toISOString()
    };

    const body = JSON.stringify(eventEnvelope);
    const webhookHeaders: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    const customHeaders = integration.custom_headers || {};
    for (const [key, value] of Object.entries(customHeaders)) {
      if (!key) continue;
      webhookHeaders[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }

    if (integration.secret) {
      webhookHeaders['x-va-signature'] = `sha256=${await signPayload(integration.secret, body)}`;
    }

    const response = await fetch(integration.webhook_url, {
      method: integration.http_method || 'POST',
      headers: webhookHeaders,
      body
    });

    const rawResponse = await response.text();
    let parsedResponse: any = rawResponse;
    try {
      parsedResponse = JSON.parse(rawResponse);
    } catch {
      // leave as text
    }

    await adminClient
      .from('va_n8n_integrations')
      .update({ last_trigger_at: new Date().toISOString() })
      .eq('id', integration_id);

    return new Response(
      JSON.stringify({
        success: response.ok,
        status: response.status,
        response: parsedResponse
      }),
      {
        status: response.ok ? 200 : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
