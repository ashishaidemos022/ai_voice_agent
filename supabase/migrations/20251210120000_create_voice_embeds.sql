/*
  # Voice embed identities

  ## Summary
  - Create va_voice_embeds table that maps a public slug to a private agent config
  - Store per-embed playback options (voice + rtc toggle) and allowed origins
  - Scope ownership via trigger that derives user_id from parent agent config
  - Add RLS policies so tenants can only manage their own embed records
*/

CREATE TABLE IF NOT EXISTS public.va_voice_embeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_config_id uuid NOT NULL REFERENCES public.va_agent_configs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.va_users(id) ON DELETE CASCADE,
  public_id text NOT NULL UNIQUE,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  tts_voice text,
  rtc_enabled boolean NOT NULL DEFAULT true,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_va_voice_embeds_public_id ON public.va_voice_embeds(public_id);
CREATE INDEX IF NOT EXISTS idx_va_voice_embeds_agent_id ON public.va_voice_embeds(agent_config_id);

COMMENT ON TABLE public.va_voice_embeds IS 'Public voice embed identities mapped to private agent configs.';

ALTER TABLE public.va_voice_embeds ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.enforce_voice_embed_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cfg_user uuid;
  cfg_voice text;
BEGIN
  SELECT user_id, voice INTO cfg_user, cfg_voice FROM public.va_agent_configs WHERE id = NEW.agent_config_id;
  IF cfg_user IS NULL THEN
    RAISE EXCEPTION 'Agent config % not found for voice embed', NEW.agent_config_id;
  END IF;
  NEW.user_id := cfg_user;
  IF NEW.tts_voice IS NULL THEN
    NEW.tts_voice := cfg_voice;
  END IF;
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_voice_embeds_owner ON public.va_voice_embeds;
CREATE TRIGGER trg_va_voice_embeds_owner
BEFORE INSERT OR UPDATE ON public.va_voice_embeds
FOR EACH ROW
EXECUTE FUNCTION public.enforce_voice_embed_owner();

GRANT SELECT ON public.va_voice_embeds TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.va_voice_embeds TO authenticated;

CREATE POLICY "Users select their voice embeds"
  ON public.va_voice_embeds
  FOR SELECT
  USING (user_id = public.current_va_user_id());

CREATE POLICY "Users insert their voice embeds"
  ON public.va_voice_embeds
  FOR INSERT
  WITH CHECK (user_id = public.current_va_user_id());

CREATE POLICY "Users update their voice embeds"
  ON public.va_voice_embeds
  FOR UPDATE
  USING (user_id = public.current_va_user_id())
  WITH CHECK (user_id = public.current_va_user_id());

CREATE POLICY "Users delete their voice embeds"
  ON public.va_voice_embeds
  FOR DELETE
  USING (user_id = public.current_va_user_id());
