-- Remove the default Concierge preset so new workspaces start with a clean slate.
DELETE FROM public.va_agent_presets
WHERE name = 'Concierge';
