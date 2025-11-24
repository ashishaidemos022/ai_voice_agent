/*
  # Harden RLS for Per-User Ownership

  ## Summary
  - Enables Row-Level Security on all sensitive va_ tables
  - Drops permissive development policies
  - Grants users access only to rows tied to their va_user record
  - Limits provider key exposure to metadata only
*/

-- Ensure deterministic helper function exists
CREATE OR REPLACE FUNCTION public.current_va_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.va_users
  WHERE auth_user_id = auth.uid()
$$;

-- Enable/disable RLS as needed
ALTER TABLE public.va_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_provider_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_agent_config_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_mcp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_mcp_connection_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_mcp_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_tool_executions ENABLE ROW LEVEL SECURITY;
-- Presets remain globally readable
ALTER TABLE public.va_agent_presets DISABLE ROW LEVEL SECURITY;

-- Drop legacy permissive policies
DROP POLICY IF EXISTS "Allow all to select connections" ON public.va_mcp_connections;
DROP POLICY IF EXISTS "Allow all to insert connections" ON public.va_mcp_connections;
DROP POLICY IF EXISTS "Allow all to update connections" ON public.va_mcp_connections;
DROP POLICY IF EXISTS "Allow all to delete connections" ON public.va_mcp_connections;

DROP POLICY IF EXISTS "Allow all to select tools" ON public.va_mcp_tools;
DROP POLICY IF EXISTS "Allow all to insert tools" ON public.va_mcp_tools;
DROP POLICY IF EXISTS "Allow all to update tools" ON public.va_mcp_tools;
DROP POLICY IF EXISTS "Allow all to delete tools" ON public.va_mcp_tools;

DROP POLICY IF EXISTS "Allow all to select health records" ON public.va_mcp_connection_health;
DROP POLICY IF EXISTS "Allow all to insert health records" ON public.va_mcp_connection_health;
DROP POLICY IF EXISTS "Allow all to update health records" ON public.va_mcp_connection_health;
DROP POLICY IF EXISTS "Allow all to delete health records" ON public.va_mcp_connection_health;

-- Users can view/update their own profile
DROP POLICY IF EXISTS va_users_self_select ON public.va_users;
DROP POLICY IF EXISTS va_users_self_update ON public.va_users;

CREATE POLICY va_users_self_select
  ON public.va_users
  FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY va_users_self_update
  ON public.va_users
  FOR UPDATE
  TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Provider keys: restrict column-level exposure
REVOKE ALL ON public.va_provider_keys FROM anon;
REVOKE ALL ON public.va_provider_keys FROM authenticated;
GRANT SELECT (id, user_id, provider, key_alias, last_four, created_at, updated_at)
  ON public.va_provider_keys TO authenticated;
GRANT ALL ON public.va_provider_keys TO service_role;

DROP POLICY IF EXISTS va_provider_keys_owner ON public.va_provider_keys;

CREATE POLICY va_provider_keys_owner
  ON public.va_provider_keys
  FOR ALL
  TO authenticated
  USING (user_id = public.current_va_user_id())
  WITH CHECK (user_id = public.current_va_user_id());

-- Helper macro via DO block for owner policies
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT unnest(ARRAY[
      'va_agent_configs',
      'va_agent_config_tools',
      'va_mcp_connections',
      'va_mcp_connection_health',
      'va_mcp_tools',
      'va_sessions',
      'va_messages',
      'va_tool_executions'
    ]) AS tbl
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_owner ON public.%I', rec.tbl, rec.tbl);
    EXECUTE format($f$
      CREATE POLICY %I_owner
        ON public.%I
        FOR ALL
        TO authenticated
        USING (user_id = public.current_va_user_id())
        WITH CHECK (user_id = public.current_va_user_id());
    $f$, rec.tbl, rec.tbl);
  END LOOP;
END$$;

-- Allow service role (Edge Functions) to insert health checks regardless of auth context
CREATE POLICY va_mcp_connection_health_service_write
  ON public.va_mcp_connection_health
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Optional: allow service role full access to operational tables
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT unnest(ARRAY[
      'va_agent_configs',
      'va_agent_config_tools',
      'va_mcp_connections',
      'va_mcp_connection_health',
      'va_mcp_tools',
      'va_sessions',
      'va_messages',
      'va_tool_executions',
      'va_provider_keys'
    ]) AS tbl
  LOOP
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', rec.tbl);
  END LOOP;
END$$;
