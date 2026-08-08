/*
  # Move text chat defaults to GPT-5.6 Terra

  Voice and chat models remain separate: Realtime 2.1 handles speech while
  GPT-5.6 Terra handles Responses API text workflows.
*/

ALTER TABLE public.va_agent_configs
  ALTER COLUMN chat_model SET DEFAULT 'gpt-5.6-terra';

UPDATE public.va_agent_configs
SET chat_model = 'gpt-5.6-terra'
WHERE chat_model IS NULL
  OR lower(chat_model) = 'gpt-4.1-mini'
  OR lower(chat_model) LIKE '%realtime%';

COMMENT ON COLUMN public.va_agent_configs.chat_model IS
  'Responses API text model ID; defaults to gpt-5.6-terra.';
