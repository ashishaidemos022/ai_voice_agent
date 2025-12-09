/*
  # Create agent embed records

  ## Summary
  - Stores a public-facing slug (`public_id`) that maps to a private agent configuration
  - Allows optional domain allow-listing and enable/disable control
  - Automatically scopes ownership via `user_id` derived from the parent agent config
  - Adds RLS policies so only the owning tenant can manage embeds
*/

CREATE TABLE IF NOT EXISTS public.va_agent_embeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_config_id uuid NOT NULL REFERENCES public.va_agent_configs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.va_users(id) ON DELETE CASCADE,
  public_id text NOT NULL UNIQUE,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_va_agent_embeds_public_id ON public.va_agent_embeds(public_id);
CREATE INDEX IF NOT EXISTS idx_va_agent_embeds_agent_id ON public.va_agent_embeds(agent_config_id);

COMMENT ON TABLE public.va_agent_embeds IS 'Public embed identities that map to private agent configurations.';

ALTER TABLE public.va_agent_embeds ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.enforce_embed_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cfg_user uuid;
BEGIN
  SELECT user_id INTO cfg_user FROM public.va_agent_configs WHERE id = NEW.agent_config_id;
  IF cfg_user IS NULL THEN
    RAISE EXCEPTION 'Agent config % not found for embed', NEW.agent_config_id;
  END IF;
  NEW.user_id := cfg_user;
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_agent_embeds_owner ON public.va_agent_embeds;
CREATE TRIGGER trg_va_agent_embeds_owner
BEFORE INSERT OR UPDATE ON public.va_agent_embeds
FOR EACH ROW
EXECUTE FUNCTION public.enforce_embed_owner();

GRANT SELECT ON public.va_agent_embeds TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.va_agent_embeds TO authenticated;

CREATE POLICY "Users select their embeds"
  ON public.va_agent_embeds
  FOR SELECT
  USING (user_id = public.current_va_user_id());

CREATE POLICY "Users insert their embeds"
  ON public.va_agent_embeds
  FOR INSERT
  WITH CHECK (user_id = public.current_va_user_id());

CREATE POLICY "Users update their embeds"
  ON public.va_agent_embeds
  FOR UPDATE
  USING (user_id = public.current_va_user_id())
  WITH CHECK (user_id = public.current_va_user_id());

CREATE POLICY "Users delete their embeds"
  ON public.va_agent_embeds
  FOR DELETE
  USING (user_id = public.current_va_user_id());
