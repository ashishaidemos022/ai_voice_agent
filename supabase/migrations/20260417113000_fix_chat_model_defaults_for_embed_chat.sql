/*
  # Fix chat model defaults for embed chat

  - Restores a chat-capable default for `chat_model`
  - Corrects legacy rows where chat_model was overwritten with a realtime-only model
*/

ALTER TABLE public.va_agent_configs
  ALTER COLUMN chat_model SET DEFAULT 'gpt-4.1-mini';

UPDATE public.va_agent_configs
SET chat_model = 'gpt-4.1-mini'
WHERE chat_model IS NOT NULL
  AND (
    lower(chat_model) = 'gpt-realtime'
    OR lower(chat_model) = 'gpt-realtime-1.5'
    OR lower(chat_model) LIKE '%realtime%'
  );
