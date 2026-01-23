/*
  # Add PersonaPlex voice provider support

  1. Schema changes
    - Extend `va_agent_configs` with PersonaPlex voice provider fields
    - Add `va_voice_provider_settings` for endpoint configuration
    - Add `va_voice_provider_health` for status tracking

  2. Security
    - Match existing va_ table behavior by disabling RLS
*/

ALTER TABLE va_agent_configs
  ADD COLUMN IF NOT EXISTS voice_provider text NOT NULL DEFAULT 'openai_realtime',
  ADD COLUMN IF NOT EXISTS voice_persona_prompt text,
  ADD COLUMN IF NOT EXISTS voice_id text,
  ADD COLUMN IF NOT EXISTS voice_sample_rate_hz integer DEFAULT 24000;

CREATE TABLE IF NOT EXISTS va_voice_provider_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  provider text NOT NULL,
  endpoint_url text NOT NULL,
  auth_type text NOT NULL DEFAULT 'none',
  encrypted_secret text,
  is_enabled boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_va_voice_provider_settings_user_id
  ON va_voice_provider_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_va_voice_provider_settings_provider
  ON va_voice_provider_settings(provider);

ALTER TABLE va_voice_provider_settings DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS va_voice_provider_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  endpoint_url text NOT NULL,
  status text NOT NULL DEFAULT 'down',
  last_checked_at timestamptz,
  latency_ms integer,
  error_message text
);

CREATE INDEX IF NOT EXISTS idx_va_voice_provider_health_provider
  ON va_voice_provider_health(provider);
CREATE INDEX IF NOT EXISTS idx_va_voice_provider_health_endpoint
  ON va_voice_provider_health(endpoint_url);

ALTER TABLE va_voice_provider_health DISABLE ROW LEVEL SECURITY;
