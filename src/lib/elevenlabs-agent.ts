import { supabase } from './supabase';

export type ElevenLabsAgentSummary = {
  agent_id: string;
  name: string;
  tags?: string[];
  created_at_unix_secs?: number;
  archived?: boolean;
};

export type ElevenLabsVoiceSummary = {
  voice_id: string;
  name: string;
  category?: string | null;
  description?: string | null;
  preview_url?: string | null;
  labels?: Record<string, string>;
  verified_languages?: Array<{
    language?: string;
    locale?: string;
    accent?: string;
    preview_url?: string;
  }>;
};

export type ElevenLabsAgentSyncResult = {
  agent_id: string;
  created: boolean;
  synced_at: string;
  sync_hash: string;
  tool_count: number;
  remote_version_id?: string | null;
  voice_provider_config: Record<string, any>;
};

type AgentSessionRequest = {
  agentId?: string;
  publicId?: string;
  sessionId: string;
  origin: string;
};

export type ElevenLabsConversationUsage = {
  conversation_id: string;
  status: string;
  duration_seconds: number;
  cost_usd: number;
  message_count: number;
  model: string | null;
  pending?: boolean;
};

function functionUrl(): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!supabaseUrl) throw new Error('Supabase URL is not configured');
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/elevenlabs-agent-session`;
}

async function authenticatedHeaders(): Promise<Record<string, string>> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const { data: { session } } = await supabase.auth.getSession();
  if (!anonKey || !session?.access_token) {
    throw new Error('Your session expired. Please sign in again.');
  }
  return {
    'Content-Type': 'application/json',
    apikey: anonKey,
    Authorization: `Bearer ${session.access_token}`
  };
}

export async function listElevenLabsAgents(providerKeyId: string): Promise<ElevenLabsAgentSummary[]> {
  const response = await fetch(functionUrl(), {
    method: 'POST',
    headers: await authenticatedHeaders(),
    body: JSON.stringify({ action: 'list_agents', provider_key_id: providerKeyId })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Unable to load ElevenLabs Agents (${response.status})`);
  }
  return Array.isArray(payload?.agents) ? payload.agents : [];
}

export async function listElevenLabsVoices(providerKeyId: string): Promise<ElevenLabsVoiceSummary[]> {
  const response = await fetch(functionUrl(), {
    method: 'POST',
    headers: await authenticatedHeaders(),
    body: JSON.stringify({ action: 'list_voices', provider_key_id: providerKeyId })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Unable to load ElevenLabs voices (${response.status})`);
  }
  return Array.isArray(payload?.voices) ? payload.voices : [];
}

export async function syncElevenLabsAgent(configId: string): Promise<ElevenLabsAgentSyncResult> {
  const response = await fetch(functionUrl(), {
    method: 'POST',
    headers: await authenticatedHeaders(),
    body: JSON.stringify({ action: 'sync_agent', config_id: configId })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.agent_id) {
    throw new Error(payload?.error || `Unable to publish ElevenLabs Agent (${response.status})`);
  }
  return payload as ElevenLabsAgentSyncResult;
}

export async function requestElevenLabsAgentSignedUrl(request: AgentSessionRequest): Promise<string> {
  const response = await fetch(functionUrl(), {
    method: 'POST',
    headers: await authenticatedHeaders(),
    body: JSON.stringify({
      action: 'signed_url',
      agent_id: request.agentId,
      session_id: request.sessionId,
      origin: request.origin
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.signed_url) {
    throw new Error(payload?.error || `Unable to start ElevenLabs Agent (${response.status})`);
  }
  return payload.signed_url;
}

export async function finalizeElevenLabsAgentUsage(request: {
  configId: string;
  sessionId: string;
  conversationId: string;
}): Promise<ElevenLabsConversationUsage> {
  let lastPayload: any = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(functionUrl(), {
      method: 'POST',
      headers: await authenticatedHeaders(),
      body: JSON.stringify({
        action: 'finalize_usage',
        config_id: request.configId,
        session_id: request.sessionId,
        conversation_id: request.conversationId
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.conversation_id) {
      throw new Error(payload?.error || `Unable to finalize ElevenLabs usage (${response.status})`);
    }
    lastPayload = payload;
    if (!payload.pending) return payload as ElevenLabsConversationUsage;
    if (attempt < 7) await new Promise((resolve) => window.setTimeout(resolve, 1_500));
  }
  throw new Error(
    `ElevenLabs conversation ${lastPayload?.conversation_id || request.conversationId} is still processing usage`
  );
}

export async function requestElevenLabsAgentEmbedSignedUrl(request: AgentSessionRequest): Promise<string> {
  const response = await fetch(functionUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'signed_url',
      agent_public_id: request.publicId,
      session_id: request.sessionId,
      origin: request.origin
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.signed_url) {
    throw new Error(payload?.error || `Unable to start ElevenLabs Agent (${response.status})`);
  }
  return payload.signed_url;
}
