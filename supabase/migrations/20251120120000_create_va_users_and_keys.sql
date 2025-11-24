/*
  # Create VA Users, Provider Keys, and Presets

  ## Summary
  - Adds `va_users` as the primary profile table linked to `auth.users`
  - Stores encrypted OpenAI keys in `va_provider_keys`
  - Seeds reusable onboarding presets via `va_agent_presets`
  - Adds helper trigger + function scaffolding for onboarding flows
*/

-- Create primary user profile table
CREATE TABLE IF NOT EXISTS public.va_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  display_name text,
  onboarding_state text NOT NULL DEFAULT 'pending',
  default_agent_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_va_users_auth_user_id ON public.va_users(auth_user_id);

COMMENT ON TABLE public.va_users IS 'Application-visible profile metadata mapped 1:1 to Supabase auth.users.';

-- Track provider API keys per user
CREATE TABLE IF NOT EXISTS public.va_provider_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.va_users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai')),
  key_alias text NOT NULL,
  encrypted_key text NOT NULL,
  last_four text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key_alias)
);

CREATE INDEX IF NOT EXISTS idx_va_provider_keys_user ON public.va_provider_keys(user_id);

COMMENT ON TABLE public.va_provider_keys IS 'Securely stores encrypted API keys (per user, per provider).';

-- Voice agent presets for onboarding flows
CREATE TABLE IF NOT EXISTS public.va_agent_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  instructions text NOT NULL,
  model text NOT NULL DEFAULT 'gpt-4o-realtime-preview-2024-12-17',
  temperature numeric NOT NULL DEFAULT 0.8,
  voice text NOT NULL DEFAULT 'alloy',
  turn_detection_config jsonb NOT NULL DEFAULT jsonb_build_object(
    'type', 'server_vad',
    'threshold', 0.5,
    'prefix_padding_ms', 300,
    'silence_duration_ms', 500
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.va_agent_presets (name, description, instructions)
VALUES
  (
    'Concierge',
    'Friendly assistant to help with schedules, reminders, and quick research.',
    'You are a proactive voice concierge. Keep replies short, clarify when needed, and offer to take next steps for the user.'
  ),
  (
    'Technical Support',
    'Calm technical helper focused on diagnostics and troubleshooting.',
    'You walk users through diagnostics patiently. Confirm each step, avoid assumptions, and summarize next actions.'
  ),
  (
    'Sales Demo',
    'Upbeat representative that guides prospects through an interactive script.',
    'You give confident, high-energy demos. Highlight differentiators, ask discovery questions, and adapt talking points based on answers.'
  )
ON CONFLICT (name) DO NOTHING;

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION public.touch_va_users()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_va_users ON public.va_users;
CREATE TRIGGER trg_touch_va_users
BEFORE UPDATE ON public.va_users
FOR EACH ROW
EXECUTE FUNCTION public.touch_va_users();

-- Automatically provision va_users rows when a Supabase auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.va_users (auth_user_id, email, display_name)
  VALUES (
    NEW.id,
    coalesce(NEW.email, ''),
    coalesce(NEW.raw_user_meta_data->>'name', NEW.email, 'New User')
  )
  ON CONFLICT (auth_user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user();

-- Helper for RLS policies to fetch current va_user id
CREATE OR REPLACE FUNCTION public.current_va_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.va_users
  WHERE auth_user_id = auth.uid()
$$;
