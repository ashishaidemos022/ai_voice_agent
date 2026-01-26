/*
  # Add A2UI toggle to agent configs

  - Adds `a2ui_enabled` boolean flag to `va_agent_configs`
  - Defaults to false
  - Backfills existing rows
*/

ALTER TABLE public.va_agent_configs
  ADD COLUMN IF NOT EXISTS a2ui_enabled boolean DEFAULT false;

UPDATE public.va_agent_configs
  SET a2ui_enabled = false
  WHERE a2ui_enabled IS NULL;

ALTER TABLE public.va_agent_configs
  ALTER COLUMN a2ui_enabled SET NOT NULL;
