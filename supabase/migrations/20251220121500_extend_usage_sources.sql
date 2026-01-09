/*
  # Extend usage sources for embeds

  ## Summary
  - Adds embed_chat and embed_voice sources to usage events.
*/

ALTER TABLE public.va_usage_events
  DROP CONSTRAINT IF EXISTS va_usage_events_source_check;

ALTER TABLE public.va_usage_events
  ADD CONSTRAINT va_usage_events_source_check
  CHECK (source IN ('voice', 'chat', 'web_search', 'tool', 'unknown', 'embed_chat', 'embed_voice'));
