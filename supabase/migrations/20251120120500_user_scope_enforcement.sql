/*
  # Enforce Per-User Ownership Across Voice Agent Tables

  ## Summary
  - Resets seed data to prepare for per-user ownership
  - Adds missing foreign keys, indexes, and helper columns
  - Introduces triggers that automatically propagate user_id
  - Ensures all conversation artifacts reference a single owner
*/

-- Dangerous but required: wipe existing demo data so NOT NULL/FK constraints can be enforced
TRUNCATE TABLE
  public.va_tool_executions,
  public.va_messages,
  public.va_sessions,
  public.va_agent_config_tools,
  public.va_agent_configs,
  public.va_mcp_connection_health,
  public.va_mcp_tools,
  public.va_mcp_connections
RESTART IDENTITY CASCADE;

-- Agent configs -> provider keys + strict ownership
ALTER TABLE public.va_agent_configs
  ADD COLUMN IF NOT EXISTS provider_key_id uuid REFERENCES public.va_provider_keys(id) ON DELETE SET NULL;

ALTER TABLE public.va_agent_configs
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.va_agent_configs
  DROP CONSTRAINT IF EXISTS va_agent_configs_user_id_fkey,
  ADD CONSTRAINT va_agent_configs_user_fk
    FOREIGN KEY (user_id) REFERENCES public.va_users(id) ON DELETE CASCADE;

ALTER TABLE public.va_agent_configs
  ALTER COLUMN model SET DEFAULT 'gpt-4o-realtime-preview-2024-12-17',
  ALTER COLUMN voice SET DEFAULT 'alloy',
  ALTER COLUMN temperature SET DEFAULT 0.8,
  ALTER COLUMN max_response_output_tokens SET DEFAULT 4096,
  ALTER COLUMN turn_detection_enabled SET DEFAULT true,
  ALTER COLUMN turn_detection_config SET DEFAULT '{"type": "server_vad", "threshold": 0.5, "prefix_padding_ms": 300, "silence_duration_ms": 500}'::jsonb,
  ALTER COLUMN is_default SET DEFAULT false,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_va_agent_configs_user_default
  ON public.va_agent_configs(user_id, is_default);

CREATE INDEX IF NOT EXISTS idx_va_agent_configs_provider_key
  ON public.va_agent_configs(provider_key_id);

-- Agent config tools inherit ownership from their agent config
ALTER TABLE public.va_agent_config_tools
  ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE public.va_agent_config_tools
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.va_agent_config_tools
  DROP CONSTRAINT IF EXISTS va_agent_config_tools_user_fk,
  ADD CONSTRAINT va_agent_config_tools_user_fk
    FOREIGN KEY (user_id) REFERENCES public.va_users(id) ON DELETE CASCADE;

ALTER TABLE public.va_agent_config_tools
  DROP CONSTRAINT IF EXISTS va_agent_config_tools_connection_id_fkey,
  ADD CONSTRAINT va_agent_config_tools_connection_fk
    FOREIGN KEY (connection_id) REFERENCES public.va_mcp_connections(id) ON DELETE CASCADE;

ALTER TABLE public.va_agent_config_tools
  DROP CONSTRAINT IF EXISTS va_agent_config_tools_tool_id_fkey,
  ADD CONSTRAINT va_agent_config_tools_tool_fk
    FOREIGN KEY (tool_id) REFERENCES public.va_mcp_tools(id) ON DELETE CASCADE;

-- MCP connections + derived tables
ALTER TABLE public.va_mcp_connections
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS last_tool_sync_at timestamptz;

ALTER TABLE public.va_mcp_connections
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.va_mcp_connections
  DROP CONSTRAINT IF EXISTS va_mcp_connections_user_id_fkey,
  ADD CONSTRAINT va_mcp_connections_user_fk
    FOREIGN KEY (user_id) REFERENCES public.va_users(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_va_mcp_connections_user_name
  ON public.va_mcp_connections(user_id, name);

ALTER TABLE public.va_mcp_connection_health
  ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE public.va_mcp_connection_health
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.va_mcp_connection_health
  DROP CONSTRAINT IF EXISTS va_mcp_connection_health_user_id_fkey,
  ADD CONSTRAINT va_mcp_connection_health_user_fk
    FOREIGN KEY (user_id) REFERENCES public.va_users(id) ON DELETE CASCADE;

ALTER TABLE public.va_mcp_connection_health
  DROP CONSTRAINT IF EXISTS va_mcp_connection_health_connection_id_fkey,
  ADD CONSTRAINT va_mcp_connection_health_connection_fk
    FOREIGN KEY (connection_id) REFERENCES public.va_mcp_connections(id) ON DELETE CASCADE;

ALTER TABLE public.va_mcp_tools
  ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE public.va_mcp_tools
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.va_mcp_tools
  DROP CONSTRAINT IF EXISTS va_mcp_tools_user_id_fkey,
  ADD CONSTRAINT va_mcp_tools_user_fk
    FOREIGN KEY (user_id) REFERENCES public.va_users(id) ON DELETE CASCADE;

ALTER TABLE public.va_mcp_tools
  DROP CONSTRAINT IF EXISTS va_mcp_tools_connection_id_fkey,
  ADD CONSTRAINT va_mcp_tools_connection_fk
    FOREIGN KEY (connection_id) REFERENCES public.va_mcp_connections(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_va_mcp_tools_user ON public.va_mcp_tools(user_id);
CREATE INDEX IF NOT EXISTS idx_va_mcp_connection_health_user ON public.va_mcp_connection_health(user_id);

-- Sessions/messages/tools now reference a specific agent/user
ALTER TABLE public.va_sessions
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS agent_id uuid;

ALTER TABLE public.va_sessions
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN agent_id SET NOT NULL;

ALTER TABLE public.va_sessions
  ADD CONSTRAINT va_sessions_user_fk
    FOREIGN KEY (user_id) REFERENCES public.va_users(id) ON DELETE CASCADE;

ALTER TABLE public.va_sessions
  ADD CONSTRAINT va_sessions_agent_fk
    FOREIGN KEY (agent_id) REFERENCES public.va_agent_configs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_va_sessions_user_created
  ON public.va_sessions(user_id, created_at DESC);

ALTER TABLE public.va_messages
  ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE public.va_messages
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.va_messages
  ADD CONSTRAINT va_messages_user_fk
    FOREIGN KEY (user_id) REFERENCES public.va_users(id) ON DELETE CASCADE;

ALTER TABLE public.va_messages
  DROP CONSTRAINT IF EXISTS va_messages_session_id_fkey,
  ADD CONSTRAINT va_messages_session_fk
    FOREIGN KEY (session_id) REFERENCES public.va_sessions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_va_messages_user_timestamp
  ON public.va_messages(user_id, timestamp DESC);

ALTER TABLE public.va_tool_executions
  ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE public.va_tool_executions
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.va_tool_executions
  ADD CONSTRAINT va_tool_executions_user_fk
    FOREIGN KEY (user_id) REFERENCES public.va_users(id) ON DELETE CASCADE;

ALTER TABLE public.va_tool_executions
  DROP CONSTRAINT IF EXISTS va_tool_executions_session_id_fkey,
  ADD CONSTRAINT va_tool_executions_session_fk
    FOREIGN KEY (session_id) REFERENCES public.va_sessions(id) ON DELETE CASCADE;

ALTER TABLE public.va_tool_executions
  DROP CONSTRAINT IF EXISTS va_tool_executions_message_id_fkey,
  ADD CONSTRAINT va_tool_executions_message_fk
    FOREIGN KEY (message_id) REFERENCES public.va_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_va_tool_executions_user_created
  ON public.va_tool_executions(user_id, executed_at DESC);

-- Triggers to propagate user ownership
CREATE OR REPLACE FUNCTION public.enforce_act_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cfg_user uuid;
BEGIN
  SELECT user_id INTO cfg_user FROM public.va_agent_configs WHERE id = NEW.config_id;
  IF cfg_user IS NULL THEN
    RAISE EXCEPTION 'Agent config % not found', NEW.config_id;
  END IF;

  IF NEW.connection_id IS NOT NULL THEN
    PERFORM 1 FROM public.va_mcp_connections WHERE id = NEW.connection_id AND user_id = cfg_user;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Connection % does not belong to the same user as config %', NEW.connection_id, NEW.config_id;
    END IF;
  END IF;

  NEW.user_id := cfg_user;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_act_user ON public.va_agent_config_tools;
CREATE TRIGGER trg_va_act_user
BEFORE INSERT OR UPDATE ON public.va_agent_config_tools
FOR EACH ROW
EXECUTE FUNCTION public.enforce_act_user();

CREATE OR REPLACE FUNCTION public.enforce_mcp_tool_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conn_user uuid;
BEGIN
  SELECT user_id INTO conn_user FROM public.va_mcp_connections WHERE id = NEW.connection_id;
  IF conn_user IS NULL THEN
    RAISE EXCEPTION 'MCP connection % not found', NEW.connection_id;
  END IF;

  NEW.user_id := conn_user;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_mcp_tools_user ON public.va_mcp_tools;
CREATE TRIGGER trg_va_mcp_tools_user
BEFORE INSERT OR UPDATE ON public.va_mcp_tools
FOR EACH ROW
EXECUTE FUNCTION public.enforce_mcp_tool_user();

CREATE OR REPLACE FUNCTION public.enforce_mcp_health_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conn_user uuid;
BEGIN
  SELECT user_id INTO conn_user FROM public.va_mcp_connections WHERE id = NEW.connection_id;
  IF conn_user IS NULL THEN
    RAISE EXCEPTION 'MCP connection % not found', NEW.connection_id;
  END IF;

  NEW.user_id := conn_user;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_mcp_health_user ON public.va_mcp_connection_health;
CREATE TRIGGER trg_va_mcp_health_user
BEFORE INSERT OR UPDATE ON public.va_mcp_connection_health
FOR EACH ROW
EXECUTE FUNCTION public.enforce_mcp_health_user();

CREATE OR REPLACE FUNCTION public.enforce_session_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cfg_user uuid;
BEGIN
  SELECT user_id INTO cfg_user FROM public.va_agent_configs WHERE id = NEW.agent_id;
  IF cfg_user IS NULL THEN
    RAISE EXCEPTION 'Agent config % not found', NEW.agent_id;
  END IF;

  NEW.user_id := cfg_user;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_sessions_user ON public.va_sessions;
CREATE TRIGGER trg_va_sessions_user
BEFORE INSERT OR UPDATE ON public.va_sessions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_session_user();

CREATE OR REPLACE FUNCTION public.enforce_message_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sess_user uuid;
BEGIN
  SELECT user_id INTO sess_user FROM public.va_sessions WHERE id = NEW.session_id;
  IF sess_user IS NULL THEN
    RAISE EXCEPTION 'Session % not found', NEW.session_id;
  END IF;

  NEW.user_id := sess_user;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_messages_user ON public.va_messages;
CREATE TRIGGER trg_va_messages_user
BEFORE INSERT OR UPDATE ON public.va_messages
FOR EACH ROW
EXECUTE FUNCTION public.enforce_message_user();

CREATE OR REPLACE FUNCTION public.enforce_tool_exec_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sess_user uuid;
BEGIN
  SELECT user_id INTO sess_user FROM public.va_sessions WHERE id = NEW.session_id;
  IF sess_user IS NULL THEN
    RAISE EXCEPTION 'Session % not found', NEW.session_id;
  END IF;

  NEW.user_id := sess_user;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_tool_exec_user ON public.va_tool_executions;
CREATE TRIGGER trg_va_tool_exec_user
BEFORE INSERT OR UPDATE ON public.va_tool_executions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_tool_exec_user();
