export interface VoiceEmbed {
  id: string;
  agent_config_id: string;
  user_id: string;
  public_id: string;
  allowed_origins: string[];
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
  tts_voice: string | null;
  rtc_enabled: boolean;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}
