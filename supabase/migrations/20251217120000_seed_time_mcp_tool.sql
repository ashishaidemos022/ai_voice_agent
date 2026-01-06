/*
  # Seed Time MCP Tool for All Users

  ## Summary
  - Adds a hosted Time MCP connection per user.
  - Adds the get_current_time tool definition per connection.
  - Auto-provisions the connection/tool for new users.
*/

CREATE OR REPLACE FUNCTION public.ensure_time_mcp_for_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conn_id uuid;
BEGIN
  INSERT INTO public.va_mcp_connections (
    user_id,
    name,
    server_url,
    api_key,
    status,
    is_enabled,
    last_health_check,
    metadata
  )
  VALUES (
    p_user_id,
    'Time (Cloud)',
    'https://mcp-time-server.vercel.app/api/mcp',
    '',
    'active',
    true,
    now(),
    jsonb_build_object('source', 'system', 'default', true)
  )
  ON CONFLICT (user_id, name)
  DO UPDATE SET
    server_url = EXCLUDED.server_url,
    api_key = EXCLUDED.api_key,
    status = EXCLUDED.status,
    is_enabled = EXCLUDED.is_enabled,
    last_health_check = EXCLUDED.last_health_check
  RETURNING id INTO conn_id;

  IF conn_id IS NULL THEN
    SELECT id INTO conn_id
    FROM public.va_mcp_connections
    WHERE user_id = p_user_id
      AND name = 'Time (Cloud)'
    LIMIT 1;
  END IF;

  IF conn_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.va_mcp_tools (
    connection_id,
    tool_name,
    description,
    parameters_schema,
    is_enabled,
    category,
    icon
  )
  VALUES (
    conn_id,
    'get_current_time',
    'Returns current time from server clock with timezone details.',
    '{
      "type": "object",
      "properties": {
        "timezone": {
          "type": "string",
          "description": "IANA timezone like America/Los_Angeles (optional)."
        }
      },
      "additionalProperties": false
    }'::jsonb,
    true,
    'Utility',
    'clock'
  )
  ON CONFLICT (connection_id, tool_name)
  DO UPDATE SET
    description = EXCLUDED.description,
    parameters_schema = EXCLUDED.parameters_schema,
    is_enabled = EXCLUDED.is_enabled,
    category = EXCLUDED.category,
    icon = EXCLUDED.icon;

  UPDATE public.va_mcp_connections
  SET last_tool_sync_at = now()
  WHERE id = conn_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_time_mcp_from_va_users()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_time_mcp_for_user(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_users_seed_time_mcp ON public.va_users;
CREATE TRIGGER trg_va_users_seed_time_mcp
AFTER INSERT ON public.va_users
FOR EACH ROW
EXECUTE FUNCTION public.seed_time_mcp_from_va_users();

DO $$
DECLARE
  u record;
BEGIN
  FOR u IN SELECT id FROM public.va_users LOOP
    PERFORM public.ensure_time_mcp_for_user(u.id);
  END LOOP;
END;
$$;
