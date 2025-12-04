import { supabase } from './supabase';

export interface N8NIntegration {
  id: string;
  user_id: string;
  config_id: string;
  name: string;
  description?: string | null;
  webhook_url: string;
  http_method: 'POST' | 'PUT' | 'PATCH';
  custom_headers: Record<string, string>;
  secret?: string | null;
  forward_session_context: boolean;
  enabled: boolean;
  last_trigger_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SaveN8NIntegrationInput {
  name?: string;
  description?: string;
  webhook_url?: string;
  http_method?: 'POST' | 'PUT' | 'PATCH';
  custom_headers?: Record<string, string>;
  secret?: string | null;
  forward_session_context?: boolean;
  enabled?: boolean;
}

export async function listN8NIntegrations(configId: string): Promise<N8NIntegration[]> {
  const { data, error } = await supabase
    .from('va_n8n_integrations')
    .select('*')
    .eq('config_id', configId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to fetch n8n integrations', error);
    throw error;
  }

  return (data as N8NIntegration[]) || [];
}

export async function createN8NIntegration(
  configId: string,
  input: SaveN8NIntegrationInput
): Promise<N8NIntegration> {
  if (!input.name || !input.webhook_url) {
    throw new Error('Name and webhook URL are required.');
  }
  const payload = {
    ...input,
    config_id: configId,
    http_method: input.http_method || 'POST',
    custom_headers: input.custom_headers || {},
    forward_session_context:
      input.forward_session_context === undefined ? true : input.forward_session_context,
    enabled: input.enabled ?? true
  };

  const { data, error } = await supabase
    .from('va_n8n_integrations')
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error('Failed to create n8n integration', error);
    throw error;
  }

  return data as N8NIntegration;
}

export async function updateN8NIntegration(
  id: string,
  input: SaveN8NIntegrationInput
): Promise<N8NIntegration> {
  const payload: Record<string, any> = {
    updated_at: new Date().toISOString()
  };

  if (input.name !== undefined) payload.name = input.name;
  if (input.description !== undefined) payload.description = input.description;
  if (input.webhook_url !== undefined) payload.webhook_url = input.webhook_url;
  if (input.http_method !== undefined) payload.http_method = input.http_method;
  if (input.custom_headers !== undefined) payload.custom_headers = input.custom_headers;
  if (input.secret !== undefined) payload.secret = input.secret;
  if (input.forward_session_context !== undefined) {
    payload.forward_session_context = input.forward_session_context;
  }
  if (input.enabled !== undefined) payload.enabled = input.enabled;

  const { data, error } = await supabase
    .from('va_n8n_integrations')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Failed to update n8n integration', error);
    throw error;
  }

  return data as N8NIntegration;
}

export async function deleteN8NIntegration(id: string): Promise<void> {
  const { error } = await supabase
    .from('va_n8n_integrations')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Failed to delete n8n integration', error);
    throw error;
  }
}

export interface TriggerN8NWebhookInput {
  integrationId: string;
  payload?: Record<string, any>;
  summary?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  sessionId?: string | null;
  metadata?: Record<string, any>;
}

export async function triggerN8NWebhook(input: TriggerN8NWebhookInput) {
  const { data: sessionData } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (sessionData?.session?.access_token) {
    headers['Authorization'] = `Bearer ${sessionData.session.access_token}`;
  }

  const { data, error } = await supabase.functions.invoke('n8n-webhook-proxy', {
    body: {
      integration_id: input.integrationId,
      payload: input.payload ?? {},
      summary: input.summary,
      severity: input.severity,
      session_id: input.sessionId,
      metadata: input.metadata ?? {}
    },
    headers
  });

  if (error) {
    console.error('Failed to trigger n8n webhook', error);
    throw new Error(error.message || 'Failed to trigger n8n webhook');
  }

  return data;
}
