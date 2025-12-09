PRD: External Embeddable AI Chat Agent System

Overview

We are adding the ability for users to embed their configured AI agents (voice or text) on any external website using an iframe or JS widget. This feature enables users of our platform to create their own AI agents inside our app and deploy them externally to interact with their customers.

The system must:
	•	Generate a public “embed identity” (e.g. public_id) per agent.
	•	Provide an iframe-based embed UI.
	•	Provide an optional JS widget (Intercom-style floating bubble).
	•	Route all chat messages through a secure backend endpoint.
	•	Enforce security rules (no exposure of OpenAI keys, domain allow-list, safe per-agent isolation).
	•	Store all conversations in the existing va_sessions, va_messages, and va_tool_executions schema.
	•	Work with the existing agent configuration tables (va_agent_configs, va_agent_config_tools, va_mcp_tools).
	•	Support both text and eventual voice agent embedding.

⸻

1. Goals

Primary Goals
	1.	Allow users to embed their AI agent on any external website.
	2.	Provide a robust backend API that runs the agent securely.
	3.	Log all conversations into Supabase under the user’s existing tables.
	4.	Ensure each user/agent is isolated via public_id, ensuring secure external access.
	5.	Provide a lightweight UI widget that works without authentication.

Secondary Goals
	1.	Support domain-based access control.
	2.	Provide analytics for embedded agents (session count, messages count, etc).
	3.	Prepare for future voice agent streaming (Realtime API).

⸻

2. Non-Goals
	•	This feature does not replace the internal console agent UI.
	•	This feature does not yet support multi-modal embeddings (images, camera).
	•	This feature does not provide built-in authentication for end-users (anonymous usage only).

⸻

3. New Database Structures

3.1 New Table: va_agent_embeds

create table public.va_agent_embeds (
  id uuid primary key default gen_random_uuid(),

  -- links to the configured agent
  agent_config_id uuid not null references public.va_agent_configs(id) on delete cascade,

  -- public-facing agent ID (short slug/token)
  public_id text not null unique,

  -- optional security control
  allowed_origins text[] default '{}',

  is_enabled boolean default true,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

Requirements
	•	public_id must be globally unique, human-friendly (e.g., support-bot-23hd).
	•	Auto-generating public_id is acceptable.
	•	Make an index on public_id.

⸻

4. Backend Components

4.1 Endpoint: POST /agent-chat

A secure API route (Next.js API route or Supabase Edge Function) that:

Request Format

{
  "public_id": "support-bot-123",
  "messages": [
    {"role": "user", "content": "Hi, I need help!"}
  ],
  "session_id": "optional-uuid-or-client-id"
}

Logic Flow
	1.	Validate incoming JSON.
	2.	Lookup agent embed via public_id:

select * from va_agent_embeds where public_id = $1 and is_enabled = true;


	3.	Optional origin validation:
	•	Check Origin header.
	•	If allowed_origins is non-empty, enforce strict matching.
	4.	Fetch agent config from va_agent_configs.
	5.	Fetch associated enabled tools from:
	•	va_agent_config_tools
	•	va_mcp_tools
	6.	Create or reuse a session in va_sessions.
	7.	Call OpenAI Chat/Realtime API with:
	•	instructions
	•	model from config
	•	temperature
	•	max tokens
	•	tool definitions
	8.	Save messages to va_messages.
	9.	Return assistant response in JSON.

Response Format

{
  "assistant": {
    "content": "Sure, how can I help you today?"
  },
  "session_id": "uuid"
}


⸻

5. UI Components

5.1 In-App “Embed” Tab on Agent Details

When the user opens an agent:
	•	Show a new tab: “Embed”
	•	If no embed record exists:
	•	Button: “Generate Embed Token”
	•	POST to /api/embed/create

Display
	•	public_id
	•	“Allowed Origins” editor (CSV list or chips)
	•	On/off toggle: is_enabled
	•	Two code snippets:

Snippet A: iframe Embed

<iframe
  src="https://YOUR_APP.com/embed/agent/support-bot-123"
  style="width: 100%; max-width: 400px; height: 600px; border-radius: 12px; border: none;"
  allow="microphone"
></iframe>

Snippet B: Floating JS Widget

<script>
  window.MyVoiceAgent = { publicId: "support-bot-123" };
  (function() {
    const s = document.createElement("script");
    s.src = "https://YOUR_APP.com/widget.js";
    s.async = true;
    document.head.appendChild(s);
  })();
</script>


⸻

6. Widget.js Requirements

6.1 Overview

A standalone JS file served at:
https://YOUR_APP.com/widget.js

This script should:
	1.	Create a chat bubble in bottom-right corner.
	2.	Expand into a small chat window when clicked.
	3.	Manage conversation history locally in localStorage.
	4.	Send all messages to /agent-chat.
	5.	Display assistant responses.
	6.	Support loading indicators & errors.

6.2 Styling
	•	Must work standalone, no Tailwind.
	•	Inline or shadow DOM styling to avoid conflicts.

⸻

7. Embed Page (Iframe UI)

/embed/agent/[public_id]

Should:
	•	Query the backend to validate agent exists.
	•	Render a simple chat interface:
	•	Chat scroll
	•	Input box
	•	Send button
	•	All communication goes to /agent-chat

No authentication should be required.

⸻

8. Security Requirements
	1.	Never expose OpenAI API keys to external sites.
	2.	All API calls from embed/widget → backend only.
	3.	Validate public_id on every call.
	4.	Enforce allowed_origins if enabled.
	5.	Rate limiting per public_id:
	•	e.g. 30 requests/minute
	6.	No Supabase insert/update/delete allowed from external sites.

⸻

9. Analytics (Phase 2)

Future requirement, not needed for v1.
	•	Sessions per day
	•	Messages per day
	•	Unique external users (via browser fingerprint)

⸻

10. Edge Cases & Error Handling

External Errors
	•	If public_id not found → 404 agent_not_found
	•	If origin not allowed → 403 origin_not_allowed
	•	If agent disabled → 403 agent_disabled

Internal Errors
	•	Supabase failure → 500 database_error
	•	OpenAI failure → 500 model_error

All errors should return readable JSON:

{ "error": "description_here" }


⸻

11. Testing Requirements

Unit Tests
	•	public_id resolution
	•	allowed_origins logic
	•	agent disabled logic
	•	session creation
	•	message logging

Integration Tests
	•	Full request → response flow
	•	Widget load on blank HTML page
	•	Iframe load from different domain

⸻

12. Delivery & Acceptance Criteria

A feature is considered complete when:
	•	Users can generate embed tokens.
	•	iframe embed works on any external site.
	•	Widget.js embed works and loads a floating chat bubble.
	•	Conversations are stored in Supabase correctly.
	•	Tools execute correctly via the /agent-chat endpoint.
	•	No OpenAI or Supabase secrets leak.
	•	ORIGIN validation works.
	•	Chrome, Firefox, Safari, Mobile Safari compatibility confirmed.

⸻

13. Future Enhancements (not required now)
	•	Voice streaming (OpenAI Realtime) inside widget.
	•	Agent theming (colors, font, positioning).
	•	Authentication for end users (JWT guest tokens).
	•	Analytics dashboard (agent performance insights).
	•	Ability to embed multiple agents per site.

