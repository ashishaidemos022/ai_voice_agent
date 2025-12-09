import { supabase } from './supabase';
import type { AgentEmbed } from '../types/embed';

type EmbedServiceAction = 'get_embed' | 'create_embed' | 'update_embed';

interface EmbedServiceRequest {
  action: EmbedServiceAction;
  agent_config_id: string;
  allowed_origins?: string[] | string;
  is_enabled?: boolean;
  rotate_public_id?: boolean;
}

interface EmbedServiceResponse {
  embed?: AgentEmbed | null;
  warning?: string;
  error?: string;
}

async function callEmbedService(payload: EmbedServiceRequest): Promise<EmbedServiceResponse> {
  const { data, error } = await supabase.functions.invoke<EmbedServiceResponse>('embed-service', {
    body: payload
  });
  if (error) {
    throw new Error(error.message || 'Embed service request failed');
  }
  return data ?? {};
}

export async function fetchAgentEmbed(agentConfigId: string): Promise<AgentEmbed | null> {
  const response = await callEmbedService({
    action: 'get_embed',
    agent_config_id: agentConfigId
  });
  return response.embed ?? null;
}

export async function createAgentEmbed(agentConfigId: string): Promise<AgentEmbed> {
  const response = await callEmbedService({
    action: 'create_embed',
    agent_config_id: agentConfigId
  });
  if (!response.embed) {
    throw new Error('Failed to create embed');
  }
  return response.embed;
}

export async function updateAgentEmbed(
  agentConfigId: string,
  updates: { allowed_origins?: string[] | string; is_enabled?: boolean; rotate_public_id?: boolean }
): Promise<AgentEmbed> {
  const response = await callEmbedService({
    action: 'update_embed',
    agent_config_id: agentConfigId,
    ...updates
  });
  if (!response.embed) {
    throw new Error('Failed to update embed');
  }
  return response.embed;
}
