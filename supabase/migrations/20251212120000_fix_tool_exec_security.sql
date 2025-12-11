/*
  # Ensure tool execution trigger can read protected sessions

  ## Summary
  - Recreate enforce_tool_exec_user() as SECURITY DEFINER so RLS on va_sessions / va_chat_sessions
    does not block anonymous/embedded tool executions.
  - Keeps the same validation logic but guarantees it runs with elevated privileges.
*/

CREATE OR REPLACE FUNCTION public.enforce_tool_exec_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

COMMENT ON FUNCTION public.enforce_tool_exec_user() IS
  'Populates va_tool_executions.user_id by looking up the owning voice/chat session. Runs as SECURITY DEFINER so session rows are readable despite RLS.';

-- Refresh trigger to ensure it points at the updated function definition (optional safety).
DROP TRIGGER IF EXISTS trg_va_tool_exec_user ON public.va_tool_executions;
CREATE TRIGGER trg_va_tool_exec_user
BEFORE INSERT OR UPDATE ON public.va_tool_executions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_tool_exec_user();
