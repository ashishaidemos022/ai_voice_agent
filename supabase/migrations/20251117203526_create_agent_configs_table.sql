/*
  # Create Voice Agent Configuration Presets Table

  1. New Table
    - `va_agent_configs`
      - `id` (uuid, primary key) - Unique configuration identifier
      - `user_id` (uuid) - Reference to user (nullable for now, can add auth later)
      - `name` (text) - Configuration preset name (e.g., "Professional Assistant", "Creative Companion")
      - `instructions` (text) - System instructions/prompt for the agent
      - `voice` (text) - OpenAI voice selection (alloy, echo, shimmer, ash, ballad, coral, sage, verse, cedar, marin)
      - `temperature` (numeric) - Response temperature (0.0-1.0)
      - `model` (text) - Model identifier
      - `max_response_output_tokens` (integer) - Max tokens per response
      - `turn_detection_enabled` (boolean) - Whether VAD is enabled
      - `turn_detection_config` (jsonb) - VAD configuration settings
      - `is_default` (boolean) - Whether this is the default configuration
      - `created_at` (timestamptz) - Creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp

  2. Security
    - Disable RLS for simplified development (matching existing va_ tables)
    - Add indexes for common query patterns

  3. Notes
    - Allow multiple configurations per user
    - Only one configuration can be marked as default per user
    - JSONB column for flexible turn detection settings
*/

CREATE TABLE IF NOT EXISTS va_agent_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  instructions text NOT NULL,
  voice text NOT NULL DEFAULT 'alloy',
  temperature numeric DEFAULT 0.8,
  model text NOT NULL DEFAULT 'gpt-realtime',
  max_response_output_tokens integer DEFAULT 4096,
  turn_detection_enabled boolean DEFAULT true,
  turn_detection_config jsonb DEFAULT '{"type": "server_vad", "threshold": 0.7, "prefix_padding_ms": 200, "silence_duration_ms": 800}'::jsonb,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_va_agent_configs_user_id ON va_agent_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_va_agent_configs_is_default ON va_agent_configs(is_default);
CREATE INDEX IF NOT EXISTS idx_va_agent_configs_created_at ON va_agent_configs(created_at);

-- Disable RLS to match existing va_ tables
ALTER TABLE va_agent_configs DISABLE ROW LEVEL SECURITY;

-- Insert a default configuration
INSERT INTO va_agent_configs (name, instructions, voice, temperature, is_default)
VALUES (
  'Default Assistant',
  'You are a helpful AI voice assistant. You can help users with various tasks, answer questions, and execute tools when needed. Be conversational and friendly.',
  'alloy',
  0.8,
  true
) ON CONFLICT DO NOTHING;
