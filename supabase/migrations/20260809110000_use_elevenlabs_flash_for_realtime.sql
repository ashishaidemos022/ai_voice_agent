/*
  # Use Eleven Flash v2.5 for realtime voice agents

  ElevenLabs recommends Flash v2.5 for conversational agents. Preserve explicit
  Eleven v3 expressive configurations while upgrading the previous realtime
  default and any explicitly stored Multilingual v2 selections.
*/

UPDATE public.va_agent_configs
SET voice_provider_config = jsonb_set(
  COALESCE(voice_provider_config, '{}'::jsonb),
  '{model_id}',
  '"eleven_flash_v2_5"'::jsonb,
  true
)
WHERE voice_provider = 'elevenlabs_tts'
  AND COALESCE(voice_provider_config->>'expressive_mode', 'false') <> 'true'
  AND (
    NOT (COALESCE(voice_provider_config, '{}'::jsonb) ? 'model_id')
    OR voice_provider_config->>'model_id' = 'eleven_multilingual_v2'
  );
