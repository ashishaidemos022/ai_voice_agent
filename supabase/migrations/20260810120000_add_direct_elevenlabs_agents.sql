/*
  Add ElevenLabs Agents as a direct, end-to-end conversational provider.
  This is separate from elevenlabs_tts, which keeps OpenAI Realtime as the
  input/LLM layer and replaces only synthesized output.
*/

ALTER TABLE public.va_agent_configs
  DROP CONSTRAINT IF EXISTS va_agent_configs_voice_provider_check;

ALTER TABLE public.va_agent_configs
  ADD CONSTRAINT va_agent_configs_voice_provider_check
  CHECK (voice_provider = ANY (ARRAY[
    'openai_realtime'::text,
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
    AND nullif(trim(coalesce(NEW.voice_provider_config->>'agent_id', '')), '') IS NULL THEN
    RAISE EXCEPTION 'voice_provider_config.agent_id is required for ElevenLabs Agents';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.va_agent_configs.voice_provider IS
  'Voice pipeline: OpenAI Realtime, PersonaPlex, OpenAI+ElevenLabs TTS, or direct ElevenLabs Agent.';
