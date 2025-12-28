import { createClient } from 'npm:@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};

type RagAction =
  | 'create_space'
  | 'upload_document'
  | 'run_query';

type RagRequestPayload = {
  action: RagAction;
  name?: string;
  description?: string;
  space_id?: string;
  source_type?: 'file' | 'text' | 'url';
  filename?: string;
  mime_type?: string;
  content_base64?: string;
  text_content?: string;
  agent_config_id?: string;
  query?: string;
  space_ids?: string[];
  rag_mode?: 'assist' | 'guardrail';
  conversation_id?: string;
  turn_id?: string;
  model?: string;
};

const OPENAI_BASE_URL = Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_ORG = Deno.env.get('OPENAI_ORGANIZATION');
const OPENAI_PROJECT = Deno.env.get('OPENAI_PROJECT');

if (!OPENAI_API_KEY) {
  console.warn('[rag-service] OPENAI_API_KEY is not configured. RAG actions will fail.');
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

function openAIHeaders(contentType?: string): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'OpenAI-Beta': 'assistants=v2'
  };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  if (OPENAI_ORG) {
    headers['OpenAI-Organization'] = OPENAI_ORG;
  }
  if (OPENAI_PROJECT) {
    headers['OpenAI-Project'] = OPENAI_PROJECT;
  }
  return headers;
}

async function createVectorStore(name: string, tenantId: string) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  const payload = {
    name,
    metadata: {
      tenant_id: tenantId,
      created_by: 'rag-service'
    }
  };
  const response = await fetch(`${OPENAI_BASE_URL}/vector_stores`, {
    method: 'POST',
    headers: openAIHeaders('application/json'),
    body: JSON.stringify(payload)
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json?.error?.message || 'Failed to create vector store');
  }
  return json;
}

function decodeBase64File(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function uploadFileToOpenAI(params: {
  bytes: Uint8Array;
  filename: string;
  mimeType?: string;
}) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const formData = new FormData();
  formData.append('purpose', 'assistants');

  const file = new Blob([params.bytes.buffer], {
    type: params.mimeType || 'application/octet-stream'
  });
  formData.append('file', file, params.filename);

  const response = await fetch(`${OPENAI_BASE_URL}/files`, {
    method: 'POST',
    headers: openAIHeaders(undefined),
    body: formData
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json?.error?.message || 'Failed to upload file to OpenAI');
  }
  return json;
}

async function attachFileToVectorStore(vectorStoreId: string, fileId: string) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  const response = await fetch(`${OPENAI_BASE_URL}/vector_stores/${vectorStoreId}/files`, {
    method: 'POST',
    headers: openAIHeaders('application/json'),
    body: JSON.stringify({ file_id: fileId })
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json?.error?.message || 'Failed to attach file to vector store');
  }
  return json;
}

const ragJsonSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'Final answer grounded in retrieved context.' },
    citations: {
      type: 'array',
      description: 'Up to 5 citations that justify the answer.',
      items: {
        type: 'object',
        properties: {
          file_id: { type: 'string' },
          title: { type: 'string' },
          snippet: { type: 'string' },
          relevance: { type: 'number' },
          url: { type: 'string', nullable: true }
        },
        required: ['file_id', 'title', 'snippet', 'relevance', 'url'],
        additionalProperties: false
      }
    }
  },
  required: ['answer', 'citations'],
  additionalProperties: false
};

async function runRagQuery(params: {
  query: string;
  vectorStoreIds: string[];
  ragMode: 'assist' | 'guardrail';
  model?: string;
}) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const instructions =
    params.ragMode === 'guardrail'
      ? 'You may ONLY answer using the retrieved knowledge. If the knowledge base does not contain the answer, respond with answer: "INSUFFICIENT" and return an empty citations array.'
      : 'Prefer retrieved knowledge when answering questions. Always include concise citations referencing the document title or filename.';

  const body = {
    model: params.model || 'gpt-4.1-mini',
    temperature: params.ragMode === 'guardrail' ? 0 : 0.2,
    max_output_tokens: 900,
    input: [
      { role: 'system', content: instructions },
      { role: 'user', content: params.query }
    ],
    text: {
      format: {
        name: 'rag_context_payload',
      type: 'json_schema',
        schema: ragJsonSchema
      }
    },
    tools: [
      {
        type: 'file_search',
        vector_store_ids: params.vectorStoreIds
      }
    ]
  };

  const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
    method: 'POST',
    headers: openAIHeaders('application/json'),
    body: JSON.stringify(body)
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json?.error?.message || 'OpenAI response request failed');
  }

  let rawText = '';
  if (Array.isArray(json.output)) {
    for (const item of json.output) {
      if (!Array.isArray(item?.content)) continue;
      for (const chunk of item.content) {
        if (chunk?.type === 'output_text' && chunk.text) {
          rawText += chunk.text;
        } else if (chunk?.type === 'text' && chunk.text) {
          rawText += chunk.text;
        }
      }
    }
  }
  if (!rawText && Array.isArray(json.output_text)) {
    rawText = json.output_text.join('\n');
  }

  let parsed: any = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch (_err) {
    parsed = null;
  }

  const answerFromModel = typeof parsed?.answer === 'string' ? parsed.answer : rawText;
  const citations = Array.isArray(parsed?.citations) ? parsed.citations : [];
  const guardrailViolated =
    params.ragMode === 'guardrail' &&
    (!citations.length || answerFromModel?.toUpperCase?.() === 'INSUFFICIENT');

  return {
    model: json.model || params.model || 'gpt-4.1-mini',
    answer: guardrailViolated
      ? 'I do not have enough approved knowledge to answer that at the moment.'
      : (answerFromModel || '').trim(),
    citations,
    tokenUsage: json.usage || null,
    raw: json,
    guardrailViolated
  };
}

Deno.serve(async (req: Request) => {
  // derive origin and build base headers for every response
  const origin = req.headers.get('origin') || '*';
  const baseHeaders = {
    ...corsHeaders,
    'Access-Control-Allow-Origin': origin
  };

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: baseHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' }
    });
  }

  // We still read any auth header, but we won't require it
  const authHeader = extractAuthHeader(req);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('Supabase environment variables are not configured');
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Tenant resolution:
    // - If we have a real user token (not anon), try to map to va_users
    // - Otherwise, fall back to a default tenant
    let tenantId: string | null = null;
    let userId: string | null = null;

    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');

      if (token !== anonKey) {
        const authedClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } }
        });

        const {
          data: { user },
          error: userError
        } = await authedClient.auth.getUser(token);

        if (!userError && user) {
          userId = user.id;

          const { data: vaUser, error: profileError } = await adminClient
            .from('va_users')
            .select('id')
            .eq('auth_user_id', user.id)
            .maybeSingle();

          if (!profileError && vaUser?.id) {
            tenantId = vaUser.id;
          }
        }
      }
    }

    // Fallback tenant if none resolved via user
    if (!tenantId) {
      tenantId = Deno.env.get('VA_DEFAULT_TENANT_ID') || 'public';
    }

    const payload: RagRequestPayload = await req.json();
    const action = payload.action;

    if (!action) {
      return new Response(JSON.stringify({ error: 'Action is required' }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('[rag-service] action received', {
      action,
      tenantId,
      hasQuery: Boolean(payload.query),
      spaceCount: Array.isArray(payload.space_ids) ? payload.space_ids.length : undefined,
      userId
    });

    if (action === 'create_space') {
      if (!payload.name?.trim()) {
        return new Response(JSON.stringify({ error: 'Name is required' }), {
          status: 400,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' }
        });
      }

      const vectorStore = await createVectorStore(payload.name.trim(), tenantId);
      const { data: space, error: insertError } = await adminClient
        .from('va_rag_spaces')
        .insert({
          tenant_id: tenantId,
          name: payload.name.trim(),
          description: payload.description || null,
          vector_store_id: vectorStore.id,
          status: 'ready'
        })
        .select()
        .single();

      if (insertError) {
        throw insertError;
      }

      return new Response(
        JSON.stringify({ success: true, space }),
        { status: 200, headers: { ...baseHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'upload_document') {
      if (!payload.space_id) {
        return new Response(JSON.stringify({ error: 'space_id is required' }), {
          status: 400,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { data: space, error: spaceError } = await adminClient
        .from('va_rag_spaces')
        .select('*')
        .eq('id', payload.space_id)
        .single();

      if (spaceError || !space || space.tenant_id !== tenantId) {
        return new Response(JSON.stringify({ error: 'Space not found' }), {
          status: 404,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (!space.vector_store_id) {
        return new Response(JSON.stringify({ error: 'Space is missing vector store id' }), {
          status: 400,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' }
        });
      }

      const isText = payload.source_type === 'text' || (!!payload.text_content && !payload.content_base64);
      let bytes: Uint8Array;

      if (isText) {
        const text = payload.text_content?.trim();
        if (!text) {
          return new Response(JSON.stringify({ error: 'Text content is empty' }), {
            status: 400,
            headers: { ...baseHeaders, 'Content-Type': 'application/json' }
          });
        }
        bytes = new TextEncoder().encode(text);
      } else {
        if (!payload.content_base64) {
          return new Response(JSON.stringify({ error: 'content_base64 is required for file uploads' }), {
            status: 400,
            headers: { ...baseHeaders, 'Content-Type': 'application/json' }
          });
        }
        bytes = decodeBase64File(payload.content_base64);
      }

      const filename = payload.filename || `knowledge-${Date.now()}.txt`;
      const mimeType = payload.mime_type || (isText ? 'text/plain' : 'application/octet-stream');
      const openaiFile = await uploadFileToOpenAI({ bytes, filename, mimeType });
      await attachFileToVectorStore(space.vector_store_id, openaiFile.id);

      const { data: document, error: docError } = await adminClient
        .from('va_rag_documents')
        .insert({
          tenant_id: tenantId,
          space_id: space.id,
          title: payload.description || filename,
          source_type: isText ? 'text' : payload.source_type || 'file',
          openai_file_id: openaiFile.id,
          openai_filename: openaiFile.filename || filename,
          mime_type: mimeType,
          status: 'ready'
        })
        .select()
        .single();

      if (docError) {
        throw docError;
      }

      return new Response(
        JSON.stringify({ success: true, document }),
        { status: 200, headers: { ...baseHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'run_query') {
      const query = payload.query?.trim();
      if (!query) {
        return new Response(JSON.stringify({ error: 'query is required' }), {
          status: 400,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' }
        });
      }

      const spaceIds = Array.isArray(payload.space_ids) ? payload.space_ids : [];
      if (!spaceIds.length) {
        return new Response(JSON.stringify({ error: 'At least one knowledge space is required' }), {
          status: 400,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Resolve tenant from agent_config_id when the request is unauthenticated (embed use-case)
      let effectiveTenantId = tenantId;
      if (payload.agent_config_id) {
        const { data: agent, error: agentError } = await adminClient
          .from('va_agent_configs')
          .select('id, tenant_id')
          .eq('id', payload.agent_config_id)
          .maybeSingle();

        if (!agentError && agent?.tenant_id) {
          effectiveTenantId = agent.tenant_id;
        }
      }

      const { data: spaces, error: spacesError } = await adminClient
        .from('va_rag_spaces')
        .select('id, tenant_id, vector_store_id, name')
        .in('id', spaceIds);

      if (spacesError) {
        throw spacesError;
      }

      const allowedSpaces = (spaces || []).filter((space: any) => space.tenant_id === effectiveTenantId);

      // If tenant resolution failed or doesn't match provided spaces, fall back to the first space's tenant
      if (allowedSpaces.length === 0 && spaces?.length) {
        effectiveTenantId = spaces[0].tenant_id;
      }

      const finalSpaces = allowedSpaces.length
        ? allowedSpaces
        : (spaces || []).filter((space: any) => space.tenant_id === effectiveTenantId);

      if (!finalSpaces.length) {
        console.warn('[rag-service] Invalid knowledge space selection', {
          requestedSpaceIds: spaceIds,
          resolvedTenant: effectiveTenantId,
          foundSpaces: spaces?.map((s: any) => ({ id: s.id, tenant_id: s.tenant_id }))
        });
        return new Response(JSON.stringify({ error: 'Invalid knowledge space selection' }), {
          status: 403,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' }
        });
      }

      const vectorStoreIds = finalSpaces
        .map((space: any) => space.vector_store_id)
        .filter((id: string | null) => !!id);

      if (!vectorStoreIds.length) {
        return new Response(JSON.stringify({ error: 'No vector stores available for selected spaces' }), {
          status: 400,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' }
        });
      }

      const ragMode = payload.rag_mode === 'guardrail' ? 'guardrail' : 'assist';
      const started = Date.now();

      console.log('[rag-service] executing run_query', {
        tenantId: effectiveTenantId,
        queryLength: query.length,
        vectorStoreIds,
        ragMode
      });

      const ragResponse = await runRagQuery({
        query,
        vectorStoreIds,
        ragMode,
        model: payload.model
      });

      const latency = Date.now() - started;
      console.log('[rag-service] run_query completed', {
        tenantId: effectiveTenantId,
        latency,
        citations: ragResponse.citations?.length || 0,
        guardrail: ragResponse.guardrailViolated
      });

      await adminClient.from('va_rag_logs').insert({
        tenant_id: effectiveTenantId,
        agent_config_id: payload.agent_config_id || null,
        conversation_id: payload.conversation_id || null,
        turn_id: payload.turn_id || null,
        query_text: query,
        vector_store_ids: vectorStoreIds,
        retrieved: ragResponse.citations || [],
        model: ragResponse.model,
        latency_ms: latency,
        token_usage: ragResponse.tokenUsage
      });

      return new Response(
        JSON.stringify({
          success: true,
          answer: ragResponse.answer,
          citations: ragResponse.citations,
          guardrail_triggered: ragResponse.guardrailViolated,
          vector_store_ids: vectorStoreIds,
          model: ragResponse.model
        }),
        { status: 200, headers: { ...baseHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('[rag-service] error', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Unexpected error' }),
      { status: 500, headers: { ...baseHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
