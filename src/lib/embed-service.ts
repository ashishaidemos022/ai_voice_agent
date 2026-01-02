import { supabase } from './supabase';
import type { AgentEmbed } from '../types/embed';

type EmbedServiceAction = 'get_embed' | 'create_embed' | 'update_embed';

interface EmbedServiceRequest {
  action: EmbedServiceAction;
  agent_config_id: string;
  allowed_origins?: string[] | string;
  logo_url?: string | null;
  brand_name?: string | null;
  accent_color?: string | null;
  background_color?: string | null;
  surface_color?: string | null;
  text_color?: string | null;
  button_color?: string | null;
  button_text_color?: string | null;
  helper_text_color?: string | null;
  corner_radius?: number | null;
  font_family?: string | null;
  wave_color?: string | null;
  bubble_color?: string | null;
  logo_background_color?: string | null;
  widget_width?: number | null;
  widget_height?: number | null;
  button_image_url?: string | null;
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
  updates: {
    allowed_origins?: string[] | string;
    logo_url?: string | null;
    brand_name?: string | null;
    accent_color?: string | null;
    background_color?: string | null;
    surface_color?: string | null;
    text_color?: string | null;
    button_color?: string | null;
    button_text_color?: string | null;
    helper_text_color?: string | null;
    corner_radius?: number | null;
    font_family?: string | null;
    wave_color?: string | null;
    bubble_color?: string | null;
    logo_background_color?: string | null;
    widget_width?: number | null;
    widget_height?: number | null;
    button_image_url?: string | null;
    is_enabled?: boolean;
    rotate_public_id?: boolean;
  }
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
