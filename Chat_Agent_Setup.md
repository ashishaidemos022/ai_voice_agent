
PRD: Agentic Chat Interface & Website-Embeddable Chat Widget

1. Product Overview

This feature adds Agentic Chat capability to the application—allowing end-users to interact with configured AI agents using text-based chat, powered by:
	•	Agent presets
	•	Agent instructions
	•	Agent tooling (MCP tools, Supabase tools, custom tools)
	•	Real-time streaming responses from OpenAI Realtime API
	•	Session management + event logging

The feature will also support embedding the chat widget into external websites, similarly to the OpenAI Chat Widget.

The overall experience must feel like a modern AI assistant: fast, streamed, contextual, and agentic (multi-tool execution).

⸻

2. Goals & Success Criteria

2.1 Goals
	1.	Allow authenticated users to initiate a chat session with any configured AI agent preset.
	2.	Support full agentic behavior, including:
	•	Tool calling
	•	Function calling
	•	Multi-step orchestration
	•	State tracking
	3.	Provide a clean, modern chat UI with:
	•	Streaming
	•	Typing indicators
	•	Tool-use visualizations
	•	Error handling
	4.	Store conversations, events, and tool logs in Supabase.
	5.	Support website embeddable widget:
	•	Script snippet install
	•	Cross-origin safe
	•	JWT-based user identity
	•	Configurable agent preset

2.2 Success Metrics
	•	Chat loads in < 400ms
	•	Response latency < 1.5s to first token
	•	95% tool-call success rate
	•	Widget installs on external domains with no CORS errors
	•	90% of users complete at least 1 full agent workflow

⸻

3. High-Level Architecture

[ Browser Chat UI ]
     |
     | WebSocket (OpenAI Realtime)
     |
[ Backend Chat Session Service ]
     |
     | Supabase RPC / DB 
     |
[ Agent Presets / Tools / Policies ]

Key Components
	1.	Frontend Chat Interface (React/Next.js)
	2.	Backend Chat Session Controller
	3.	Session State Store (Supabase)
	4.	Agent Preset Manager
	5.	OpenAI Realtime Client Wrapper
	6.	Website Embeddable SDK (JS snippet)
	7.	Widget Server Endpoint
	8.	MCP Tool Router

⸻

4. Functional Requirements

4.1 Agent Preset Selection
	•	User sees a dropdown list of:
	•	Agent name
	•	Description
	•	Tags (e.g., “Customer Support”, “Claims”, “Salesbot”)
	•	Each preset contains:
	•	id
	•	system_prompt
	•	instructions
	•	tools_enabled: []
	•	model: "gpt-4.1" | "realtime"
	•	agent_avatar_url

4.2 Chat Session Creation

Each chat session includes:

Field	Description
session_id	UUID
user_id	Authenticated user
agent_preset_id	Mapping
started_at	Timestamp
metadata	Website params, custom fields

4.3 Sending Messages
	•	User types → frontend sends message.user.append
	•	System maps to OpenAI Realtime WS:

{
  "type": "input_text",
  "text": "Hello! I need help with my claim."
}

4.4 Receiving Messages
	•	Streamed tokens
	•	Tool calls
	•	Final responses
	•	Error events

Must display:
	•	Token-by-token rendering
	•	A “tool execution” bubble when tools are invoked

4.5 Tool Support

Tools supported:
	1.	Supabase queries (through MCP)
	2.	Custom HTTP tools
	3.	Business workflow tools (e.g., “lookup-claim-status”)
	4.	N8N workflows (future)

4.6 Memory & Context
	•	Load last N messages (configurable)
	•	Auto-trim long sessions
	•	Context size warning for large tool logs

4.7 Conversation Storage

Tables required:
	•	va_chat_sessions
	•	va_chat_messages
	•	va_chat_tool_events

4.8 Embeddable Widget

Widget includes:

4.8.1 JS Snippet

<script src="https://yourdomain.com/agentic-chat.js"
        data-agent-id="XXXX"
        data-user-jwt=""
        data-theme="light">
</script>

4.8.2 Features
	•	Popup or inline mode
	•	Customizable theme
	•	Custom branding
	•	Automatic session creation
	•	JWT verification
	•	Domain allow-list check

4.8.3 Widget UI
	•	Minimal chat window
	•	Floating launcher button
	•	Agent avatar
	•	Streaming output

4.9 Authentication
	•	Application users → Supabase Auth
	•	Website widget users → Ephemeral JWTs
	•	Rate limiting per session

⸻

5. Non-Functional Requirements

5.1 Performance
	•	Use OpenAI realtime streaming
	•	Persistent WS connection
	•	Reconnect logic

5.2 Security
	•	Domain allow-list for widgets
	•	JWT validation
	•	No PII stored unless user consents
	•	RLS enabled for chat tables

5.3 Compliance
	•	HIPAA-ready structure
	•	Optional PHI masking
	•	Audit logs for tool calls

⸻

6. Detailed UI/UX Requirements

6.1 Main Chat Root Page
	•	Full-height container
	•	Left sidebar (agent presets)
	•	Right chat pane (messages)
	•	Tool-call visual modules

6.2 Chat Message Types
	1.	User (bubble right)
	2.	Assistant (streaming bubble left)
	3.	Tool call event (expandable card)
	4.	Errors (red badge)

6.3 Typing Indicators
	•	Three animated dots
	•	“Agent is thinking…” when tool calls occur

6.4 Message Composer
	•	Multi-line textarea
	•	Send on Enter
	•	Tool shortcut icons (future)

⸻

7. APIs & Endpoints

7.1 GET /agent-presets

Returns list of user-configured agents.

7.2 POST /chat/session

Creates new chat session.

7.3 WS /chat/stream

Manages real-time connection to OpenAI.

7.4 POST /widget/session

Website widget session creation.

⸻

8. Database Schema

8.1 va_chat_sessions

id uuid PK
user_id uuid
agent_preset_id uuid
source enum('app','widget')
metadata jsonb
created_at timestamptz
updated_at timestamptz

8.2 va_chat_messages

id uuid PK
session_id uuid FK
sender enum('user','assistant','system','tool')
message text
tool_name text NULL
raw jsonb
created_at timestamptz

8.3 va_chat_tool_events

id uuid PK
session_id uuid FK
tool_name text
request jsonb
response jsonb
created_at timestamptz


⸻

9. Website Embeddable SDK Requirements

9.1 Build Format
	•	ES Modules
	•	Single bundled JS file (<150KB)
	•	No React (native DOM)

9.2 SDK Responsibilities
	•	Render widget UI
	•	Open/close chat
	•	Manage WS connection
	•	Store user state in localStorage
	•	Provide callback hooks:
	•	onMessage
	•	onToolCalled
	•	onSessionCreated

⸻

10. Error Handling Requirements
	•	Connection lost → auto reconnect
	•	Tool failure → message with retry option
	•	Rate limit reached → cooldown timer
	•	Model error → fallback message

⸻

11. Telemetry & Analytics

Track:
	•	Session start
	•	First token time
	•	Tool call latency
	•	User satisfaction (thumbs up/down)
	•	Drop-off points

⸻

12. Future Enhancements (Not in v1)
	•	File uploads
	•	Chat with image input
	•	Multi-agent routing
	•	Agent handoff to human
	•	Knowledge base integration
	•	Widget branding marketplace

⸻

13. Acceptance Criteria

Functional

✔ User can start chat with any agent preset
✔ Realtime streaming works
✔ Tool calls work reliably
✔ Conversation is stored in DB
✔ Embeddable widget works on external domains
✔ JWT + CORS passes correctly

UX

✔ Modern clean chat UI
✔ Smooth streaming
✔ Tool visualization
✔ Error messages readable
