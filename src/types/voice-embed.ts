export interface VoiceEmbed {
  id: string;
  agent_config_id: string;
  user_id: string;
  public_id: string;
  allowed_origins: string[];
  tts_voice: string | null;
  rtc_enabled: boolean;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}
