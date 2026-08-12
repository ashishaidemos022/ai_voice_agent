/* Add direct xAI Grok Speech-to-Speech as a first-class voice provider. */

ALTER TABLE public.va_provider_keys
  DROP CONSTRAINT IF EXISTS va_provider_keys_provider_check;

ALTER TABLE public.va_provider_keys
  ADD CONSTRAINT va_provider_keys_provider_check
  CHECK (provider = ANY (ARRAY['openai'::text, 'xai'::text, 'elevenlabs'::text]));

ALTER TABLE public.va_agent_configs
  DROP CONSTRAINT IF EXISTS va_agent_configs_voice_provider_check;

ALTER TABLE public.va_agent_configs
  ADD CONSTRAINT va_agent_configs_voice_provider_check
  CHECK (voice_provider = ANY (ARRAY[
    'openai_realtime'::text,
    'xai_realtime'::text,
    'personaplex'::text,
    'elevenlabs_tts'::text,
    'elevenlabs_agent'::text
  ]));

CREATE OR REPLACE FUNCTION public.validate_va_agent_voice_provider_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  key_provider text;
  key_user_id uuid;
  resolved_provider text := coalesce(NEW.voice_provider, 'openai_realtime');
  expected_key_provider text;
  configuration_authority text := coalesce(
    NEW.voice_provider_config->>'configuration_authority',
    'provider_managed'
  );
BEGIN
  expected_key_provider := CASE
    WHEN resolved_provider IN ('elevenlabs_tts', 'elevenlabs_agent') THEN 'elevenlabs'
    WHEN resolved_provider = 'xai_realtime' THEN 'xai'
    ELSE NULL
  END;

  IF expected_key_provider IS NULL THEN
    IF NEW.voice_provider_key_id IS NOT NULL THEN
      RAISE EXCEPTION 'voice_provider_key_id is not valid for voice provider %', resolved_provider;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.voice_provider_key_id IS NULL THEN
    RAISE EXCEPTION 'voice_provider_key_id is required for voice provider %', resolved_provider;
  END IF;

  SELECT provider, user_id
  INTO key_provider, key_user_id
  FROM public.va_provider_keys
  WHERE id = NEW.voice_provider_key_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'voice_provider_key_id % not found', NEW.voice_provider_key_id;
  END IF;

  IF key_provider <> expected_key_provider THEN
    RAISE EXCEPTION 'voice_provider_key_id % must reference provider %, got %',
      NEW.voice_provider_key_id, expected_key_provider, key_provider;
  END IF;

  IF NEW.user_id IS NOT NULL AND key_user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'voice_provider_key_id % must belong to same user as agent config %',
      NEW.voice_provider_key_id, NEW.id;
  END IF;

  IF resolved_provider = 'elevenlabs_agent'
    AND configuration_authority <> 'app_managed'
    AND nullif(trim(coalesce(NEW.voice_provider_config->>'agent_id', '')), '') IS NULL THEN
    RAISE EXCEPTION 'voice_provider_config.agent_id is required for provider-managed ElevenLabs Agents';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_va_agent_voice_provider_key() IS
  'Validates same-owner provider keys for ElevenLabs and direct xAI voice providers.';
