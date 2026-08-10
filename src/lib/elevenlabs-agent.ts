import { supabase } from './supabase';

export type ElevenLabsAgentSummary = {
  agent_id: string;
  name: string;
  tags?: string[];
  created_at_unix_secs?: number;
  archived?: boolean;
};

type AgentSessionRequest = {
  agentId?: string;
  publicId?: string;
  sessionId: string;
  origin: string;
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
