-- Audio telemetry is separate from chat billing; unknown costs remain NULL.
CREATE TABLE public.va_voice_audio_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.va_users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.va_chat_sessions(id) ON DELETE CASCADE,
  turn_id text,
  operation text NOT NULL CHECK (operation IN ('transcribe', 'speak')),
  model text NOT NULL,
  segment integer,
  input_bytes integer,
  input_characters integer,
  duration_seconds numeric,
  latency_ms integer NOT NULL,
  provider_request_id text,
  usage jsonb,
  estimated_cost_usd numeric(14,8),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX va_voice_audio_events_session ON public.va_voice_audio_events(session_id, created_at);
ALTER TABLE public.va_voice_audio_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read voice audio usage" ON public.va_voice_audio_events
  FOR SELECT TO authenticated USING (user_id = public.current_va_user_id());
REVOKE ALL ON public.va_voice_audio_events FROM anon, authenticated;
GRANT SELECT ON public.va_voice_audio_events TO authenticated;
GRANT ALL ON public.va_voice_audio_events TO service_role;
