/*
  # Update voice model defaults to GPT Realtime 2.1

  - Sets the current voice model default for agent configs and onboarding presets
  - Migrates only realtime voice model identifiers; chat_model remains chat-specific
*/

ALTER TABLE public.va_agent_configs
  ALTER COLUMN model SET DEFAULT 'gpt-realtime-2.1';

ALTER TABLE public.va_agent_presets
  ALTER COLUMN model SET DEFAULT 'gpt-realtime-2.1';

UPDATE public.va_agent_configs
SET model = 'gpt-realtime-2.1'
WHERE model IS NULL
  OR lower(model) IN ('gpt-realtime', 'gpt-realtime-1.5', 'gpt-realtime-2')
  OR lower(model) LIKE 'gpt-4o-realtime%'
  OR lower(model) LIKE 'gpt-4o-mini-realtime%';

UPDATE public.va_agent_presets
SET model = 'gpt-realtime-2.1'
WHERE model IS NULL
  OR lower(model) IN ('gpt-realtime', 'gpt-realtime-1.5', 'gpt-realtime-2')
  OR lower(model) LIKE 'gpt-4o-realtime%'
  OR lower(model) LIKE 'gpt-4o-mini-realtime%';

COMMENT ON COLUMN public.va_agent_configs.model IS
  'Realtime voice model ID; defaults to gpt-realtime-2.1.';

COMMENT ON COLUMN public.va_agent_configs.chat_model IS
  'Text chat model ID; intentionally managed separately from the realtime voice model.';
