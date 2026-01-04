/*
  # Allow Read Access to Agent Presets

  ## Summary
  - Add SELECT policy so va_agent_presets remains globally readable under RLS.
*/

ALTER TABLE public.va_agent_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS va_agent_presets_read ON public.va_agent_presets;

CREATE POLICY va_agent_presets_read
  ON public.va_agent_presets
  FOR SELECT
  TO anon, authenticated
  USING (true);
