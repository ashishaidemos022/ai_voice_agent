/*
  # Grant anon select on agent presets

  ## Summary
  - Align table grants with the existing RLS policy that allows `anon` and `authenticated`
    to read `va_agent_presets`.
*/

GRANT SELECT ON TABLE public.va_agent_presets TO anon;
