/*
  # Extend agent config tool selections to support n8n automations

  ## Summary
  - Allow `va_agent_config_tools.tool_source` to store `n8n`
  - Track the linked n8n integration and arbitrary metadata per selection
  - Ensure triggers validate ownership + config-scoping for webhook integrations
*/

ALTER TABLE public.va_agent_config_tools
  ADD COLUMN IF NOT EXISTS n8n_integration_id uuid REFERENCES public.va_n8n_integrations(id) ON DELETE CASCADE;

ALTER TABLE public.va_agent_config_tools
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.va_agent_config_tools
  DROP CONSTRAINT IF EXISTS va_agent_config_tools_tool_source_check,
  ADD CONSTRAINT va_agent_config_tools_tool_source_check
    CHECK (tool_source IN ('client', 'server', 'mcp', 'n8n'));

CREATE INDEX IF NOT EXISTS idx_va_agent_config_tools_n8n_integration
  ON public.va_agent_config_tools(n8n_integration_id);

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
    PERFORM 1
    FROM public.va_mcp_connections
    WHERE id = NEW.connection_id
      AND user_id = cfg_user;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Connection % does not belong to the same user as config %', NEW.connection_id, NEW.config_id;
    END IF;
  END IF;

  IF NEW.n8n_integration_id IS NOT NULL THEN
    PERFORM 1
    FROM public.va_n8n_integrations
    WHERE id = NEW.n8n_integration_id
      AND user_id = cfg_user
      AND config_id = NEW.config_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'n8n integration % does not belong to the same user or agent config %', NEW.n8n_integration_id, NEW.config_id;
    END IF;
  END IF;

  NEW.user_id := cfg_user;
  RETURN NEW;
END;
$$;
