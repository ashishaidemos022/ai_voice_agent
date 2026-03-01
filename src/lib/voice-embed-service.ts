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

async function getAccessToken(options?: { forceRefresh?: boolean }): Promise<string | null> {
  const forceRefresh = Boolean(options?.forceRefresh);
  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (!forceRefresh && session?.access_token) return session.access_token;

  const { data: refreshed } = await supabase.auth.refreshSession();
  return refreshed.session?.access_token ?? null;
}

async function callVoiceEmbedService(payload: VoiceEmbedRequest): Promise<VoiceEmbedResponse> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase client environment is not configured');
  }

  let accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('Your session expired. Please sign out and sign in again.');
  }

  const buildHeaders = (token: string): Record<string, string> => ({
    'Content-Type': 'application/json',
    apikey: anonKey,
    Authorization: `Bearer ${token}`
  });

  const request = async (token: string) => {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/voice-embed-service`, {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify(payload)
    });

    let data: VoiceEmbedResponse | null = null;
    try {
      data = (await response.json()) as VoiceEmbedResponse;
    } catch {
      data = null;
    }

    return { response, data };
  };

  let { response, data } = await request(accessToken);

  if (response.status === 401) {
    accessToken = await getAccessToken({ forceRefresh: true });
    if (!accessToken) {
      throw new Error('Your session expired. Please sign out and sign in again.');
    }
    const retry = await request(accessToken);
    response = retry.response;
    data = retry.data;
  }

  if (!response.ok) {
    throw new Error(data?.error || `Voice embed service request failed (${response.status})`);
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
