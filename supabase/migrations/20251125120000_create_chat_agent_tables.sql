/*
  # Agentic Chat Schema

  ## Summary
  - Adds va_chat_sessions / va_chat_messages / va_chat_tool_events
  - Extends va_agent_configs with chat-specific metadata (avatar, tags, chat model, summary)
  - Enables RLS with ownership enforced via triggers referencing parent session
*/

-- Extend agent configs with chat metadata used for preset selection + widget branding
ALTER TABLE public.va_agent_configs
  ADD COLUMN IF NOT EXISTS chat_model text DEFAULT 'gpt-4o-realtime-preview-2024-12-17',
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS agent_avatar_url text,
  ADD COLUMN IF NOT EXISTS chat_theme jsonb DEFAULT '{}'::jsonb;

UPDATE public.va_agent_configs
SET chat_model = CASE
  WHEN chat_model ILIKE '%realtime%' THEN chat_model
  WHEN model ILIKE '%realtime%' THEN model
  ELSE 'gpt-4o-realtime-preview-2024-12-17'
END;

-- Primary chat session table
CREATE TABLE IF NOT EXISTS public.va_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.va_users(id) ON DELETE CASCADE,
  agent_preset_id uuid NOT NULL REFERENCES public.va_agent_configs(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'widget')),
  metadata jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'error')),
  message_count integer NOT NULL DEFAULT 0,
  tool_call_count integer NOT NULL DEFAULT 0,
  first_token_ms integer,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_va_chat_sessions_user ON public.va_chat_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_va_chat_sessions_agent ON public.va_chat_sessions(agent_preset_id);

-- Individual chat messages (user/assistant/system/tool output)
CREATE TABLE IF NOT EXISTS public.va_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.va_chat_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.va_users(id) ON DELETE CASCADE,
  sender text NOT NULL CHECK (sender IN ('user', 'assistant', 'system', 'tool')),
  message text NOT NULL,
  tool_name text,
  raw jsonb,
  streamed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_va_chat_messages_session ON public.va_chat_messages(session_id, created_at);

-- Tool execution audit trail for chat
CREATE TABLE IF NOT EXISTS public.va_chat_tool_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.va_chat_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.va_users(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  request jsonb,
  response jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_va_chat_tool_events_session ON public.va_chat_tool_events(session_id, created_at DESC);

-- Trigger helpers ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_va_chat_session()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN
    NEW.last_message_at := COALESCE(NEW.last_message_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_va_chat_session ON public.va_chat_sessions;
CREATE TRIGGER trg_touch_va_chat_session
BEFORE INSERT OR UPDATE ON public.va_chat_sessions
FOR EACH ROW
EXECUTE FUNCTION public.touch_va_chat_session();

CREATE OR REPLACE FUNCTION public.propagate_va_chat_message_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sess_user uuid;
BEGIN
  SELECT user_id INTO sess_user FROM public.va_chat_sessions WHERE id = NEW.session_id;
  IF sess_user IS NULL THEN
    RAISE EXCEPTION 'Chat session % missing or has no owner', NEW.session_id;
  END IF;
  NEW.user_id := sess_user;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_chat_messages_user ON public.va_chat_messages;
CREATE TRIGGER trg_va_chat_messages_user
BEFORE INSERT ON public.va_chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.propagate_va_chat_message_user();

CREATE OR REPLACE FUNCTION public.propagate_va_chat_tool_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sess_user uuid;
BEGIN
  SELECT user_id INTO sess_user FROM public.va_chat_sessions WHERE id = NEW.session_id;
  IF sess_user IS NULL THEN
    RAISE EXCEPTION 'Chat session % missing or has no owner', NEW.session_id;
  END IF;
  NEW.user_id := sess_user;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_chat_tool_events_user ON public.va_chat_tool_events;
CREATE TRIGGER trg_va_chat_tool_events_user
BEFORE INSERT ON public.va_chat_tool_events
FOR EACH ROW
EXECUTE FUNCTION public.propagate_va_chat_tool_user();

CREATE OR REPLACE FUNCTION public.increment_va_chat_counters()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.va_chat_sessions
  SET
    message_count = message_count + 1,
    last_message_at = NEW.created_at,
    updated_at = now()
  WHERE id = NEW.session_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_chat_messages_counters ON public.va_chat_messages;
CREATE TRIGGER trg_va_chat_messages_counters
AFTER INSERT ON public.va_chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.increment_va_chat_counters();

CREATE OR REPLACE FUNCTION public.increment_va_chat_tool_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.va_chat_sessions
  SET
    tool_call_count = tool_call_count + 1,
    updated_at = now()
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_chat_tool_events_counters ON public.va_chat_tool_events;
CREATE TRIGGER trg_va_chat_tool_events_counters
AFTER INSERT ON public.va_chat_tool_events
FOR EACH ROW
EXECUTE FUNCTION public.increment_va_chat_tool_count();

-- Row level security -------------------------------------------------------
ALTER TABLE public.va_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_chat_tool_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their chat sessions"
  ON public.va_chat_sessions
  FOR ALL
  TO authenticated
  USING (user_id = public.current_va_user_id())
  WITH CHECK (user_id = public.current_va_user_id());

CREATE POLICY "Users read chat messages"
  ON public.va_chat_messages
  FOR SELECT
  TO authenticated
  USING (user_id = public.current_va_user_id());

CREATE POLICY "Users insert chat messages"
  ON public.va_chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = public.current_va_user_id());

CREATE POLICY "Users read chat tool events"
  ON public.va_chat_tool_events
  FOR SELECT
  TO authenticated
  USING (user_id = public.current_va_user_id());

CREATE POLICY "Users insert chat tool events"
  ON public.va_chat_tool_events
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = public.current_va_user_id());
