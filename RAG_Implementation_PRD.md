
🚀 Product Requirements Document (PRD)

RAG Functionality for Agent Application using OpenAI Retrieval Services

Author: Ashish
Audience: Codex Engineering
Version: v1.0
Goal: Implement enterprise-grade Retrieval Augmented Generation for Agents (Voice + Chat) using OpenAI’s native RAG (Retrieval / File Search / Responses API).

⸻

1. Overview

The current Agent Application supports:
	•	Voice agents (OpenAI Realtime)
	•	Chat agents (agentic chat widget)
	•	MCP tools
	•	n8n workflows
	•	Agent presets & instructions
	•	Multi-tenant Supabase architecture

Missing capability:

🔍 Agents cannot yet use organizational knowledge (PDFs, documents, manuals, SOPs) to answer questions.

We want to add first-class RAG, powered by OpenAI’s Retrieval / File Search APIs, without building our own embedding/vector infrastructure.

⸻

2. Objectives

Primary Objectives
	1.	Allow tenants to create/manage Knowledge Spaces (KBs).
	2.	Let agents attach one or more KBs to their configuration.
	3.	Enable automatic RAG-enhanced responses for:
	•	Voice agents (OpenAI Realtime pipeline)
	•	Chat agents (UI + web widget)
	4.	Use OpenAI Retrieval/File Search/Responses API (no custom embeddings).
	5.	Full logging and observability inside Supabase.

Secondary Objectives
	•	Multi-tenant isolation (RLS)
	•	Support uploads (PDF, DOCX, TXT, MD, HTML)
	•	Dashboard UI for managing KBs & documents

Non-Goals (v1)
	•	No custom vector DB (Supabase vector extension optional)
	•	No fine-tuning
	•	No large-scale crawling (Confluence, SharePoint)—future enhancements

⸻

3. Product Scope

3.1 Users

User Type	Needs
Tenant admin	Upload docs, create KB spaces
Developer	Attach KBs to agents
End user	Receive accurate, knowledge-aware responses
Voice agent caller	Get info grounded in org documents
Internal operator	View retrieval logs


⸻

4. Key Concepts

Knowledge Space (KB Space)

Logical grouping of documents. E.g., “Healthcare Claims KB”, “Utilities Billing KB”.

Documents

PDFs, URLs, manual text. Each generates OpenAI hosted content.

RAG Query

Any agent turn that uses OpenAI file-search to fetch context documents.

Agent Knowledge Binding

Agent config stores a list of KB Spaces → RAG automatically activates.

⸻

5. User Stories
	1.	As a tenant admin, I can create a KB space.
	2.	As a tenant admin, I can upload docs to a KB.
	3.	As a developer, I can attach KBs to an agent.
	4.	As an end user, the agent answers questions using uploaded docs.
	5.	As a voice caller, the realtime agent uses my KB to answer.
	6.	As an operator, I can see RAG logs and what documents were used.

⸻

6. System Architecture

Frontend → Next.js API Routes → Supabase → OpenAI Retrieval → Agents (Chat + Voice)

Where RAG happens
	•	Chat agent → /api/agent/chat (extended)
	•	Voice agent → Server-side text pipeline → Retrieval → Realtime model
	•	All retrieval uses OpenAI’s file_search / retrieval features.

⸻

7. Functional Requirements

7.1 Knowledge Space Management

FR-1 Create KB Space
	•	Inputs: name, desc, tenant_id
	•	Creates:
	•	Row in va_rag_spaces
	•	OpenAI vector-store equivalent (via openai.rag / file_search API)
	•	Returns vector_store_id / datatstore_id

FR-2 Edit/Delete KB Space
	•	Soft delete required
	•	RLS enforces tenant isolation

FR-3 View KB Spaces
	•	List KBs with document counts and statuses

⸻

7.2 Document Ingestion

FR-4 Upload Document

Supported types: PDF, DOCX, TXT, MD, HTML.

Flow:
	1.	Upload → Next.js route
	2.	Store metadata in Supabase (va_rag_documents)
	3.	Upload file to OpenAI files endpoint
	4.	Associate file with RAG datastore (vector store)
	5.	Mark status indexing → ready

FR-5 Manual Text Paste
	•	Admin pastes text; system creates .txt or direct insertion via RAG API.

FR-6 URL Snapshot (optional v1.1)

⸻

7.3 Agents With RAG

FR-7 Agents Can Attach KB Spaces

In agent config:

knowledge_spaces: [uuid1, uuid2]

FR-8 Chat Agent RAG Flow

On each user message:
	1.	Get agent config
	2.	Get KB spaces → get vector_store_ids
	3.	Call OpenAI Retrieval via Responses API:

POST /v1/responses

{
  "model": "gpt-4.1-mini",
  "input": user_message,
  "file_search": {
    "vector_store_ids": [...]
  }
}

	4.	Receive answer + citations
	5.	Log retrieved docs
	6.	Return to UI

FR-9 Voice Agent RAG Flow

Pipeline:

Speech → Text → RAG search → LLM → Speech

For each query chunk:

openai.responses.create({
  model: "gpt-4.1-mini",
  input: transcript_segment,
  file_search: { vector_store_ids: [...] }
})


⸻

7.4 Logging

FR-10 RAG Logs per Turn

Store in va_rag_logs:
	•	agent_config_id
	•	conversation_id
	•	user_query
	•	retrieved documents
	•	retrieved snippet text
	•	openai_vector_store_ids
	•	timestamps

⸻

8. Supabase Schema Requirements (Final)

8.1 va_rag_spaces

create table public.va_rag_spaces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  description text,
  vector_store_id text, -- OpenAI datastore / file_search store
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);


⸻

8.2 va_rag_documents

create table public.va_rag_documents (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references va_rag_spaces(id) on delete cascade,
  tenant_id uuid not null,
  title text,
  source_type text not null,  -- file, url, text
  openai_file_id text,
  status text default 'indexing',
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);


⸻

8.3 va_rag_agent_spaces

create table public.va_rag_agent_spaces (
  id uuid primary key default gen_random_uuid(),
  agent_config_id uuid not null references va_agent_configs(id),
  space_id uuid not null references va_rag_spaces(id),
  created_at timestamptz default now(),
  unique(agent_config_id, space_id)
);


⸻

8.4 va_rag_logs

create table public.va_rag_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agent_config_id uuid not null,
  conversation_id uuid,
  turn_id uuid,
  query_text text not null,
  vector_store_ids text[],
  retrieved jsonb,
  model text,
  latency_ms integer,
  token_usage jsonb,
  created_at timestamptz default now()
);


⸻

9. API Routes Specification

9.1 POST /api/rag/spaces

Create KB Space + Create Vector Store.

9.2 POST /api/rag/docs/upload

Upload file → OpenAI → Metadata row.

9.3 POST /api/agent/chat

Extend existing route to:
	•	Detect KBs
	•	Perform retrieval
	•	Return grounded answer

9.4 POST /api/agent/voice

Add RAG inside server-side transcript handler.

9.5 GET /api/rag/logs

Paginated logs.

⸻

10. Application Logic

10.1 Query Flow (Chat Agent)

User Query
→ Agent Config
→ KB Spaces → vector_store_ids
→ Retrieval via Responses API
→ Answer + citations
→ Save logs
→ Return response


⸻

11. UI Requirements (Agent Studio)

Admin KB Console
	•	Create KB
	•	Upload documents
	•	View status (indexing / ready)
	•	Delete / archive
	•	Document list

Agent Config UI
	•	Checkbox list of KB Spaces
	•	RAG mode:
	•	Assist only
	•	Guardrail (don’t hallucinate)

Chat Testing UI
	•	“Knowledge used” preview panel
	•	Retrieved snippets with citation markers

⸻

12. Security & RLS

Enforce RLS on:
	•	va_rag_spaces
	•	va_rag_documents
	•	va_rag_agent_spaces
	•	va_rag_logs

Policy:

tenant_id = auth.jwt().tenant_id


⸻

13. Performance & Limits
	•	Target RAG latency: < 1.5s per LLM call
	•	Document size limit: 25MB per file
	•	Total KB per tenant: soft limit 2GB (OpenAI hosting)
	•	Cache vector_store_ids in memory for faster lookup

⸻

14. Edge Cases
	•	If retrieval returns zero results:
	•	Assist mode → LLM answers normally
	•	Guardrail mode → fallback answer: “Insufficient info”
	•	If OpenAI is down:
	•	Fallback to non-RAG model

⸻

15. Future Enhancements
	•	Indexed URL scraping (Sitemap → OpenAI ingestion)
	•	Connecting multiple stores to an agent with weighted relevance
	•	Domain-specific chunking (tables, PDFs, OCR)

⸻

16. Acceptance Criteria
	1.	Agents can answer questions using uploaded documents.
	2.	KB management UI works end-to-end.
	3.	Logs show retrieved document snippets.
	4.	Voice agent and chat agent both use RAG consistently.
	5.	Multi-tenancy isolation enforced.

⸻

✔️ Final Notes for Codex
	•	Use OpenAI Responses API with file_search (recommended by OpenAI).
	•	Avoid home-grown embeddings unless needed for fallback.
	•	All RAG flows must be internal (server-side) for security.
	•	Always log what documents were retrieved.

