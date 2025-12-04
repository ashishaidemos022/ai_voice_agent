/*
  # Expand tool execution logging for chat sessions

  ## Summary
  - Allow tool executions to reference either a realtime voice session or a chat session
  - Track chat messages alongside existing voice message linkage
  - Keep user ownership enforcement in sync with the new dual-session model
*/

ALTER TABLE public.va_tool_executions
  DROP CONSTRAINT IF EXISTS va_tool_executions_session_fk,
  DROP CONSTRAINT IF EXISTS va_tool_executions_session_id_fkey;

ALTER TABLE public.va_tool_executions
  ALTER COLUMN session_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS chat_session_id uuid,
  ADD COLUMN IF NOT EXISTS chat_message_id uuid;

ALTER TABLE public.va_tool_executions
  ADD CONSTRAINT va_tool_exec_session_fk
    FOREIGN KEY (session_id) REFERENCES public.va_sessions(id) ON DELETE CASCADE;

ALTER TABLE public.va_tool_executions
  ADD CONSTRAINT va_tool_exec_chat_session_fk
    FOREIGN KEY (chat_session_id) REFERENCES public.va_chat_sessions(id) ON DELETE CASCADE;

ALTER TABLE public.va_tool_executions
  ADD CONSTRAINT va_tool_exec_chat_message_fk
    FOREIGN KEY (chat_message_id) REFERENCES public.va_chat_messages(id) ON DELETE SET NULL;

ALTER TABLE public.va_tool_executions
  DROP CONSTRAINT IF EXISTS va_tool_exec_session_presence,
  ADD CONSTRAINT va_tool_exec_session_presence
    CHECK (
      session_id IS NOT NULL
      OR chat_session_id IS NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_va_tool_exec_chat_session
  ON public.va_tool_executions(chat_session_id);

CREATE INDEX IF NOT EXISTS idx_va_tool_exec_chat_message
  ON public.va_tool_executions(chat_message_id);

CREATE OR REPLACE FUNCTION public.enforce_tool_exec_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sess_user uuid;
BEGIN
  IF NEW.session_id IS NOT NULL THEN
    SELECT user_id INTO sess_user FROM public.va_sessions WHERE id = NEW.session_id;
    IF sess_user IS NULL THEN
      RAISE EXCEPTION 'Voice session % not found for tool execution', NEW.session_id;
    END IF;
  ELSIF NEW.chat_session_id IS NOT NULL THEN
    SELECT user_id INTO sess_user FROM public.va_chat_sessions WHERE id = NEW.chat_session_id;
    IF sess_user IS NULL THEN
      RAISE EXCEPTION 'Chat session % not found for tool execution', NEW.chat_session_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Tool execution must reference a voice session or chat session';
  END IF;

  NEW.user_id := sess_user;
  RETURN NEW;
END;
$$;
