export interface AgentEmbed {
  id: string;
  agent_config_id: string;
  user_id: string;
  public_id: string;
  allowed_origins: string[];
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}
