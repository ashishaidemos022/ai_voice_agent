/*
  # Update realtime voice model defaults to GPT Realtime 1.5

  - Sets new defaults for voice agent configs and onboarding presets
  - Migrates legacy realtime model identifiers in existing rows
*/

ALTER TABLE public.va_agent_configs
  ALTER COLUMN model SET DEFAULT 'gpt-realtime-1.5';

ALTER TABLE public.va_agent_configs
  ALTER COLUMN chat_model SET DEFAULT 'gpt-realtime-1.5';

ALTER TABLE public.va_agent_presets
  ALTER COLUMN model SET DEFAULT 'gpt-realtime-1.5';

UPDATE public.va_agent_configs
SET model = 'gpt-realtime-1.5'
WHERE model IS NOT NULL
  AND (
    lower(model) = 'gpt-realtime'
    OR lower(model) LIKE 'gpt-4o-realtime%'
  );

UPDATE public.va_agent_configs
SET chat_model = 'gpt-realtime-1.5'
WHERE chat_model IS NOT NULL
  AND (
    lower(chat_model) = 'gpt-realtime'
    OR lower(chat_model) LIKE 'gpt-4o-realtime%'
  );

UPDATE public.va_agent_presets
SET model = 'gpt-realtime-1.5'
WHERE model IS NOT NULL
  AND (
    lower(model) = 'gpt-realtime'
    OR lower(model) LIKE 'gpt-4o-realtime%'
  );
