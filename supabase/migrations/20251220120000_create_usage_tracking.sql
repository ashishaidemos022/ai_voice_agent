/*
  # Usage Tracking

  ## Summary
  - Adds usage events table for per-response usage capture.
  - Adds daily aggregates for quick dashboard summaries.
  - Secures tables with RLS policies scoped to the current VA user.
*/

CREATE TABLE IF NOT EXISTS public.va_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.va_users(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'unknown' CHECK (source IN ('voice', 'chat', 'web_search', 'tool', 'unknown')),
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_va_usage_events_user_date
  ON public.va_usage_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_va_usage_events_source
  ON public.va_usage_events(user_id, source);

CREATE TABLE IF NOT EXISTS public.va_usage_daily (
  user_id uuid NOT NULL REFERENCES public.va_users(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, usage_date)
);

CREATE OR REPLACE FUNCTION public.bump_va_usage_daily()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.va_usage_daily (
    user_id,
    usage_date,
    input_tokens,
    output_tokens,
    total_tokens,
    cost_usd,
    updated_at
  )
  VALUES (
    NEW.user_id,
    NEW.created_at::date,
    NEW.input_tokens,
    NEW.output_tokens,
    NEW.total_tokens,
    NEW.cost_usd,
    now()
  )
  ON CONFLICT (user_id, usage_date)
  DO UPDATE SET
    input_tokens = public.va_usage_daily.input_tokens + EXCLUDED.input_tokens,
    output_tokens = public.va_usage_daily.output_tokens + EXCLUDED.output_tokens,
    total_tokens = public.va_usage_daily.total_tokens + EXCLUDED.total_tokens,
    cost_usd = public.va_usage_daily.cost_usd + EXCLUDED.cost_usd,
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_usage_daily ON public.va_usage_events;
CREATE TRIGGER trg_va_usage_daily
AFTER INSERT ON public.va_usage_events
FOR EACH ROW
EXECUTE FUNCTION public.bump_va_usage_daily();

ALTER TABLE public.va_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_usage_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert usage events"
  ON public.va_usage_events
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = public.current_va_user_id());

CREATE POLICY "Users read usage events"
  ON public.va_usage_events
  FOR SELECT
  TO authenticated
  USING (user_id = public.current_va_user_id());

CREATE POLICY "Users read usage daily"
  ON public.va_usage_daily
  FOR SELECT
  TO authenticated
  USING (user_id = public.current_va_user_id());
