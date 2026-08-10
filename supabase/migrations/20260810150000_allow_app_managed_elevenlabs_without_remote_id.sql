/*
  App-managed ElevenLabs presets may be saved before a remote Agent exists.
  The publish control plane creates the Agent and persists its agent_id.
*/

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
  configuration_authority text := coalesce(
    NEW.voice_provider_config->>'configuration_authority',
    'provider_managed'
  );
BEGIN
  IF resolved_provider NOT IN ('elevenlabs_tts', 'elevenlabs_agent') THEN
    IF NEW.voice_provider_key_id IS NOT NULL THEN
      RAISE EXCEPTION 'voice_provider_key_id is only valid for ElevenLabs providers';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.voice_provider_key_id IS NULL THEN
    RAISE EXCEPTION 'voice_provider_key_id is required for ElevenLabs providers';
  END IF;

  SELECT provider, user_id
  INTO key_provider, key_user_id
  FROM public.va_provider_keys
  WHERE id = NEW.voice_provider_key_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'voice_provider_key_id % not found', NEW.voice_provider_key_id;
  END IF;

  IF key_provider <> 'elevenlabs' THEN
    RAISE EXCEPTION 'voice_provider_key_id % must reference provider elevenlabs, got %', NEW.voice_provider_key_id, key_provider;
  END IF;

  IF NEW.user_id IS NOT NULL AND key_user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'voice_provider_key_id % must belong to same user as agent config %', NEW.voice_provider_key_id, NEW.id;
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
  'Validates ElevenLabs key ownership and allows app-managed presets to create their remote Agent during publish.';
