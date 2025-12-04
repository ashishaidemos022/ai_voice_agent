-- Create table to store per-agent n8n webhook integrations
CREATE TABLE IF NOT EXISTS public.va_n8n_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.va_users(id) ON DELETE CASCADE,
  config_id uuid NOT NULL REFERENCES public.va_agent_configs(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  webhook_url text NOT NULL,
  http_method text NOT NULL DEFAULT 'POST' CHECK (http_method IN ('POST', 'PUT', 'PATCH')),
  custom_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret text,
  forward_session_context boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  last_trigger_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_va_n8n_integrations_user ON public.va_n8n_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_va_n8n_integrations_config ON public.va_n8n_integrations(config_id);
CREATE INDEX IF NOT EXISTS idx_va_n8n_integrations_enabled ON public.va_n8n_integrations(enabled);

COMMENT ON TABLE public.va_n8n_integrations IS 'Stores user-configured n8n webhook integrations that can be triggered by voice agents.';

-- Ensure user_id always matches the owning agent configuration
CREATE OR REPLACE FUNCTION public.enforce_n8n_integration_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cfg_user uuid;
BEGIN
  SELECT user_id INTO cfg_user FROM public.va_agent_configs WHERE id = NEW.config_id;
  IF cfg_user IS NULL THEN
    RAISE EXCEPTION 'Agent config % not found for n8n integration', NEW.config_id;
  END IF;

  NEW.user_id := cfg_user;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_n8n_integrations_user ON public.va_n8n_integrations;
CREATE TRIGGER trg_va_n8n_integrations_user
BEFORE INSERT OR UPDATE ON public.va_n8n_integrations
FOR EACH ROW
EXECUTE FUNCTION public.enforce_n8n_integration_user();

ALTER TABLE public.va_n8n_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their n8n integrations" ON public.va_n8n_integrations;
CREATE POLICY "Users can view their n8n integrations"
ON public.va_n8n_integrations
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their n8n integrations" ON public.va_n8n_integrations;
CREATE POLICY "Users can insert their n8n integrations"
ON public.va_n8n_integrations
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their n8n integrations" ON public.va_n8n_integrations;
CREATE POLICY "Users can update their n8n integrations"
ON public.va_n8n_integrations
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their n8n integrations" ON public.va_n8n_integrations;
CREATE POLICY "Users can delete their n8n integrations"
ON public.va_n8n_integrations
FOR DELETE
USING (auth.uid() = user_id);
