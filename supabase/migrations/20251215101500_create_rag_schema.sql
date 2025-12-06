/*
  # Retrieval Augmented Generation Schema

  ## Summary
  - Adds multi-tenant knowledge spaces + document metadata
  - Binds agent configs to knowledge spaces via junction table
  - Stores RAG query logs for auditability
  - Extends agent configs with RAG toggles (enabled/mode)
*/

-- Ensure helper exists
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

CREATE TABLE IF NOT EXISTS public.va_rag_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.va_users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  vector_store_id text,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('creating', 'ready', 'error', 'archived')),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_va_rag_spaces_tenant_name
  ON public.va_rag_spaces(tenant_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_va_rag_spaces_vector_store
  ON public.va_rag_spaces(vector_store_id);

CREATE TABLE IF NOT EXISTS public.va_rag_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.va_rag_spaces(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.va_users(id) ON DELETE CASCADE,
  title text,
  source_type text NOT NULL CHECK (source_type IN ('file', 'text', 'url')),
  openai_file_id text,
  openai_filename text,
  mime_type text,
  status text NOT NULL DEFAULT 'indexing' CHECK (status IN ('indexing', 'ready', 'error', 'archived')),
  error_message text,
  tokens integer,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_va_rag_documents_space
  ON public.va_rag_documents(space_id, status);

CREATE TABLE IF NOT EXISTS public.va_rag_agent_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_config_id uuid NOT NULL REFERENCES public.va_agent_configs(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES public.va_rag_spaces(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.va_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_config_id, space_id)
);

CREATE TABLE IF NOT EXISTS public.va_rag_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.va_users(id) ON DELETE CASCADE,
  agent_config_id uuid REFERENCES public.va_agent_configs(id) ON DELETE SET NULL,
  conversation_id uuid,
  turn_id uuid,
  query_text text NOT NULL,
  vector_store_ids text[] NOT NULL DEFAULT '{}',
  retrieved jsonb,
  model text,
  latency_ms integer,
  token_usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Triggers to hydrate tenant_id + timestamps
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_va_rag_spaces ON public.va_rag_spaces;
CREATE TRIGGER trg_touch_va_rag_spaces
BEFORE UPDATE ON public.va_rag_spaces
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_va_rag_documents ON public.va_rag_documents;
CREATE TRIGGER trg_touch_va_rag_documents
BEFORE UPDATE ON public.va_rag_documents
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.sync_rag_document_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner uuid;
BEGIN
  SELECT tenant_id INTO owner FROM public.va_rag_spaces WHERE id = NEW.space_id;
  IF owner IS NULL THEN
    RAISE EXCEPTION 'Knowledge space % missing or inaccessible', NEW.space_id;
  END IF;
  NEW.tenant_id := owner;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_rag_documents_tenant ON public.va_rag_documents;
CREATE TRIGGER trg_va_rag_documents_tenant
BEFORE INSERT ON public.va_rag_documents
FOR EACH ROW
EXECUTE FUNCTION public.sync_rag_document_tenant();

CREATE OR REPLACE FUNCTION public.sync_rag_agent_space_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner uuid;
BEGIN
  SELECT user_id INTO owner FROM public.va_agent_configs WHERE id = NEW.agent_config_id;
  IF owner IS NULL THEN
    RAISE EXCEPTION 'Agent config % missing owner', NEW.agent_config_id;
  END IF;
  NEW.tenant_id := owner;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_va_rag_agent_spaces_tenant ON public.va_rag_agent_spaces;
CREATE TRIGGER trg_va_rag_agent_spaces_tenant
BEFORE INSERT ON public.va_rag_agent_spaces
FOR EACH ROW
EXECUTE FUNCTION public.sync_rag_agent_space_tenant();

-- Extend agent configs with rag flags
ALTER TABLE public.va_agent_configs
  ADD COLUMN IF NOT EXISTS rag_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rag_mode text NOT NULL DEFAULT 'assist' CHECK (rag_mode IN ('assist', 'guardrail')),
  ADD COLUMN IF NOT EXISTS rag_default_model text DEFAULT 'gpt-4.1-mini';

-- RLS policies -------------------------------------------------
ALTER TABLE public.va_rag_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_rag_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_rag_agent_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_rag_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY va_rag_spaces_owner
  ON public.va_rag_spaces
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_va_user_id())
  WITH CHECK (tenant_id = public.current_va_user_id());

CREATE POLICY va_rag_documents_owner
  ON public.va_rag_documents
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_va_user_id())
  WITH CHECK (tenant_id = public.current_va_user_id());

CREATE POLICY va_rag_agent_spaces_owner
  ON public.va_rag_agent_spaces
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_va_user_id())
  WITH CHECK (tenant_id = public.current_va_user_id());

CREATE POLICY va_rag_logs_owner
  ON public.va_rag_logs
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_va_user_id());

GRANT ALL ON public.va_rag_spaces TO service_role;
GRANT ALL ON public.va_rag_documents TO service_role;
GRANT ALL ON public.va_rag_agent_spaces TO service_role;
GRANT ALL ON public.va_rag_logs TO service_role;

