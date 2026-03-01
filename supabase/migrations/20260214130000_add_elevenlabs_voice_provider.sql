/*
  # Add ElevenLabs voice provider support

  ## Summary
  - Extend provider key provider constraint to include `elevenlabs`
  - Scope key alias uniqueness by provider
  - Extend voice provider options on agent configs
  - Add agent-level provider key linkage + provider config JSON
  - Enforce ownership/provider integrity for provider key linkage
*/

-- 1) provider keys: allow openai + elevenlabs
ALTER TABLE public.va_provider_keys
  DROP CONSTRAINT IF EXISTS va_provider_keys_provider_check;

ALTER TABLE public.va_provider_keys
  ADD CONSTRAINT va_provider_keys_provider_check
  CHECK (provider = ANY (ARRAY['openai'::text, 'elevenlabs'::text]));

-- Alias uniqueness should be per provider
ALTER TABLE public.va_provider_keys
  DROP CONSTRAINT IF EXISTS va_provider_keys_user_id_key_alias_key;

ALTER TABLE public.va_provider_keys
  ADD CONSTRAINT va_provider_keys_user_id_provider_key_alias_key
  UNIQUE (user_id, provider, key_alias);

CREATE INDEX IF NOT EXISTS idx_va_provider_keys_user_provider
  ON public.va_provider_keys(user_id, provider);

-- 2) agent configs: support elevenlabs voice provider + provider-specific key/config
ALTER TABLE public.va_agent_configs
  ADD COLUMN IF NOT EXISTS voice_provider_key_id uuid REFERENCES public.va_provider_keys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voice_provider_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.va_agent_configs
  DROP CONSTRAINT IF EXISTS va_agent_configs_voice_provider_check;

ALTER TABLE public.va_agent_configs
  ADD CONSTRAINT va_agent_configs_voice_provider_check
  CHECK (voice_provider = ANY (ARRAY['openai_realtime'::text, 'personaplex'::text, 'elevenlabs_tts'::text]));

CREATE INDEX IF NOT EXISTS idx_va_agent_configs_voice_provider_key
  ON public.va_agent_configs(voice_provider_key_id);

-- 3) integrity guard: when using elevenlabs_tts, enforce valid same-user elevenlabs key
CREATE OR REPLACE FUNCTION public.validate_va_agent_voice_provider_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  key_user_id uuid;
  key_provider text;
BEGIN
  -- Non-ElevenLabs providers should not point at a voice_provider_key_id.
  IF coalesce(NEW.voice_provider, 'openai_realtime') <> 'elevenlabs_tts' THEN
    IF NEW.voice_provider_key_id IS NOT NULL THEN
      RAISE EXCEPTION 'voice_provider_key_id is only valid when voice_provider = elevenlabs_tts';
    END IF;
    RETURN NEW;
  END IF;

  -- ElevenLabs requires a provider key.
  IF NEW.voice_provider_key_id IS NULL THEN
    RAISE EXCEPTION 'voice_provider_key_id is required when voice_provider = elevenlabs_tts';
  END IF;

  SELECT user_id, provider
  INTO key_user_id, key_provider
  FROM public.va_provider_keys
  WHERE id = NEW.voice_provider_key_id;

  IF key_user_id IS NULL THEN
    RAISE EXCEPTION 'voice_provider_key_id % not found', NEW.voice_provider_key_id;
  END IF;

  IF key_provider <> 'elevenlabs' THEN
    RAISE EXCEPTION 'voice_provider_key_id % must reference provider elevenlabs, got %', NEW.voice_provider_key_id, key_provider;
  END IF;

  IF NEW.user_id IS DISTINCT FROM key_user_id THEN
    RAISE EXCEPTION 'voice_provider_key_id % must belong to same user as agent config %', NEW.voice_provider_key_id, NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_va_agent_voice_provider_key ON public.va_agent_configs;
CREATE TRIGGER trg_validate_va_agent_voice_provider_key
BEFORE INSERT OR UPDATE ON public.va_agent_configs
FOR EACH ROW
EXECUTE FUNCTION public.validate_va_agent_voice_provider_key();
