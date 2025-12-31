import { supabase } from './supabase';
import type { VoiceEmbed } from '../types/voice-embed';

type VoiceEmbedAction = 'get_embed' | 'create_embed' | 'update_embed';

interface VoiceEmbedRequest {
  action: VoiceEmbedAction;
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
  widget_width?: number | null;
  widget_height?: number | null;
  button_image_url?: string | null;
  is_enabled?: boolean;
  rtc_enabled?: boolean;
  tts_voice?: string | null;
  rotate_public_id?: boolean;
}

interface VoiceEmbedResponse {
  embed?: VoiceEmbed | null;
  warning?: string;
  error?: string;
}

async function callVoiceEmbedService(payload: VoiceEmbedRequest): Promise<VoiceEmbedResponse> {
  const { data, error } = await supabase.functions.invoke<VoiceEmbedResponse>('voice-embed-service', {
    body: payload
  });
  if (error) {
    throw new Error(error.message || 'Voice embed service request failed');
  }
  return data ?? {};
}

export async function fetchVoiceEmbedConfig(agentConfigId: string): Promise<VoiceEmbed | null> {
  const response = await callVoiceEmbedService({
    action: 'get_embed',
    agent_config_id: agentConfigId
  });
  return response.embed ?? null;
}

export async function createVoiceEmbed(agentConfigId: string): Promise<VoiceEmbed> {
  const response = await callVoiceEmbedService({
    action: 'create_embed',
    agent_config_id: agentConfigId
  });
  if (!response.embed) {
    throw new Error('Failed to create voice embed');
  }
  return response.embed;
}

export async function updateVoiceEmbed(
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
    widget_width?: number | null;
    widget_height?: number | null;
    button_image_url?: string | null;
    is_enabled?: boolean;
    rtc_enabled?: boolean;
    tts_voice?: string | null;
    rotate_public_id?: boolean;
  }
): Promise<VoiceEmbed> {
  const response = await callVoiceEmbedService({
    action: 'update_embed',
    agent_config_id: agentConfigId,
    ...updates
  });
  if (!response.embed) {
    throw new Error('Failed to update voice embed');
  }
  return response.embed;
}
