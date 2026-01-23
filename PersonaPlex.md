Feature Requirements: Add NVIDIA PersonaPlex Voice Model Option (Voice Agents Only)

1. Goal

Add NVIDIA nvidia/personaplex-7b-v1 as an optional Voice Model Provider for Voice Agents only, while keeping Chat Agents unchanged (continue using the current chat model path). PersonaPlex is a real-time, full-duplex speech-to-speech model designed for low-latency, streaming conversations.  ￼

Your platform already supports realtime voice + chat, tool execution (client/MCP/n8n), embeds, and Supabase Edge Functions—this feature plugs into the voice session lifecycle only.  ￼

⸻

2. Scope

In scope
	•	Add a **Voice Provid ￼t least:
	•	OpenAI Realtime (existing)
	•	NVIDIA PersonaPlex (new)
	•	New backend integration path for:
	•	Realtime streaming audio in/out
	•	Persona text prompt
	•	Voice conditioning prompt (pre-packaged voice embeddings or uploaded sample—depending on supported method)
	•	Support for:
	•	Web UI Voice Agent sessions
	•	Embedded Voice sessions (if your current voice embed is a first-class feature)

Out of scope
	•	Any change to Chat Agent model/provider selection
	•	Rewriting the tool system (tools stay the same conceptually; only the voice runtime changes)

⸻

3. Product Behavior

3.1 Provider Choice Rules
	•	Voice Agents: user can select provider: OpenAI or PersonaPlex.
	•	Chat Agents: provider is fixed to current implementation (no UI changes beyond ensuring no regression).

3.2 PersonaPlex Overview Constraints to Respect
	•	PersonaPlex uses two prompts:
	•	Text prompt describing persona/role/context
	•	Voice prompt (audio token prompt / voice conditioning)  ￼
	•	Audio is expected at 24kHz.  ￼
	•	Model is gated and requires accepting license terms and authenticating with Hugging Face token (HF_TOKEN).  ￼
	•	NVIDIA indicates the model is optimized for NVIDIA GPU systems (A100/H100) and Linux.  ￼

⸻

4. UX Requirements

4.1 Agent Settings UI

Add a new section to the Voice Agent configuration UI:

Section: Voice Model Provider
	•	Radio / dropdown:
	•	OpenAI Realtime (current)
	•	NVIDIA PersonaPlex (speech-to-speech)
	•	Help text:
	•	“PersonaPlex is full-duplex speech-to-speech and runs at 24kHz. Requires hosted inference endpoint.”

When PersonaPlex selected, show additional fields:

Persona / Role Prompt
	•	Multiline input (max length enforced; recommend 200–500 tokens equivalent)
	•	Optional: “Prompt templates” dropdown (customer service, casual conversation, etc.) based on examples in repo docs.  ￼

Voice Conditioning
	•	Option A (MVP): Select from a fixed list of prepackaged voices:
	•	NATF0..NATF3, NATM0..NATM3, VARF0..VARF4, VARM0..VARM4  ￼
	•	Option B (Phase 2): Upload a short voice sample to derive a conditioning prompt (only if officially supported by NVIDIA pipeline you deploy).

Provider Endpoint (Admin / Workspace level)
	•	“PersonaPlex Endpoint URL”
	•	“Auth method” (API key / mTLS / none)
	•	“Health status” indicator

4.2 Session UI

In Voice session screen:
	•	Display active provider badge:
	•	Provider: OpenAI Realtime or Provider: PersonaPlex
	•	Add a warning banner if:
	•	PersonaPlex endpoint is unreachable
	•	Latency exceeds threshold
	•	Sample rate mismatch detected

4.3 Embed UI (Voice)

If voice embeds exist in your app (they do per your architecture doc):
	•	Voice embed config must include provider choice only if embed is tied to an agent config that uses PersonaPlex.
	•	If the agent uses PersonaPlex and the embed domain isn’t allowed, behavior stays consistent with existing embed security patterns.  ￼

⸻

5. Architecture & Integration Requirements

5.1 Deployment Model

PersonaPlex is run via NVIDIA’s provided code (Moshi-based) and can launch a server locally (example shows python -m moshi.server on port 8998 with SSL).  ￼

Requirement: Provide a production-friendly inference service that your app can call:
	•	Self-hosted container on GPU (recommended)
	•	Exposed via:
	•	WebSocket (preferred for bidirectional streami ￼nal)
	•	HTTP streaming (fallback, if supported)

5.2 Your App Integration Pattern (Recommended)

Add a new Voice Runtime Adapter layer:
	•	OpenAIRealtimeVoiceAdapter (existing behavior)
	•	PersonaPlexVoiceAdapter (new)

Both expose the same interface to the UI:
	•	connect()
	•	sendAudioFrame()
	•	receiveAudioFrame()
	•	interrupt()/bargeIn()
	•	disconnect()
	•	events: transcription updates (if available), state, latency

This minimizes UI change and keeps provider-specific logic isolated.

5.3 Server-Side Boundary (Security)

Do NOT call PersonaPlex directly from the browser if it requires secrets or is not internet-safe.

Add a new Supabase Edge Function (or equivalent backend API) to:
	•	Mint ephemeral session tokens for PersonaPlex (if you build it)
	•	Proxy and enforce:
	•	allowed origins
	•	agent ownership
	•	rate limits
	•	usage logging

This matches your current “voice ephemeral key” pattern for OpenAI realtime.  ￼

⸻

6. Data Model Requirements (Supabase)

6.1 Agent Config Extensions

Extend your va_agent_configs (or equivalent) for voice configuration with:
	•	voice_provider ENUM: openai_realtime | personaplex
	•	voice_persona_prompt TEXT (nullable)
	•	voice_id TEXT (e.g., NATF2)
	•	voice_sample_rate_hz INT default 24000 when PersonaPlex selected  ￼

6.2 Workspace / Provider Settings

Add a table like va_voice_provider_settings:
	•	id
	•	user_id /  [oai_citation:14‡Architecture.md](sediment://file_00000000e46c71f593b2966bf7db1e1f)ider (personaplex)
	•	endpoint_url
	•	auth_type (none | api_key | bearer | mtls)
	•	encrypted_secret (if needed)
	•	is_enabled
	•	created_at, updated_at

6.3 Health & Observability

Add va_voice_provider_health:
	•	provider
	•	endpoint_url
	•	status (ok | degraded | down)
	•	last_checked_at
	•	latency_ms
	•	error_message

(You already track MCP connection health—reuse the same pattern.)

⸻

7. Audio / Streaming Requirements

7.1 Audio Format
	•	PersonaPlex path MUST enforce 24kHz capture/playback resampling as needed.  ￼
	•	Define canonical internal audio frame format:
	•	PCM16 mono recommended (or float32 if your stack uses it)
	•	Implement resampler:
	•	UI microphone capture → resample → send frames
	•	received frames → resample (if needed) → output

7.2 Full-Duplex Behavior

PersonaPlex supports overlapping listen/speak behavior.  ￼
Requirements:
	•	Allow user barge-in:
	•	user speaking should reduce/duck agent audio or trigger interruption semantics
	•	UI state machine must support:
	•	simultaneous send/receive streams
	•	partial generation
	•	adaptive turn-taking indicators

7.3 Text Output (Optional)

PersonaPlex can output text tokens along with audio (per model description).  ￼
If your UI displays transcripts:
	•	Display incremental transcript if available
	•	Store transcript in session logs if enabled

⸻

8. Prompting & Persona Requirements

8.1 Prompt Sources

Persona prompt should be constructed from:
	•	Agent name + role
	•	Business context (optional)
	•	Knowledge base guidance (optional)
	•	Tool policy guidance (optional)

8.2 Guardrails

For PersonaPlex sessions:
	•	Apply the same tool-safety constraints as your existing voice runtime:
	•	tool allowlist
	•	schema validation
	•	origin checks
	•	logging

Even though PersonaPlex is speech-to-speech, your “agent brain” still needs deterministic constraints (especially if tool calling is involved).

⸻

9. Tool Execution Compatibility

MVP Option A (Simplest)

PersonaPlex handles only conversation (speech-to-speech), and tool execution remains:
	•	Disabled for PersonaPlex voice sessions OR
	•	Only triggered via explicit “tool intent phrases” detected by a lightweight text layer

Option B (Full Feature Parity)

Introduce a parallel “intent + tools” path:
	•	Extract partial text tokens (or run a lightweight ASR in parallel) → determine tool calls
	•	Execute tools (MCP/n8n/DB) → inject results back into persona prompt context
	•	Continue streaming conversation

Requirement: Decide A vs B explicitly in implementation; default to A for MVP to reduce complexity.

⸻

10. Security & Compliance Requirements

10.1 Licensing / Gating
	•	PersonaPlex HF model is governed by NVIDIA Open Model License and requires accepting the model license and using HF_TOKEN.  ￼
	•	Store any tokens/secrets server-side only (vault / encrypted columns).

10.2 Network Controls
	•	PersonaPlex endpoint must be behind:
	•	authentication
	•	allowlisted origins / IP allowlisting
	•	DDoS protection if public

10.3 Data Handling
	•	Support per-workspace toggles:
	•	store audio? (default off)
	•	store transcript? (default on/off configurable)
	•	retention windows

⸻

11. Non-Functional Requirements

Performance
	•	Voice roundtrip latency targets:
	•	P50 < 400ms
	•	P95 < 900ms
	•	Recovery:
	•	automatic reconnect with exponential backoff (max 3 attempts)
	•	failover to OpenAI voice provider if configured

Hardware
	•	PersonaPlex is optimized for NVIDIA GPUs (A100/H100) and Linux.  ￼
Your deployment checklist should include:
	•	GPU node sizing guidance
	•	VRAM requirement benchmark (to be validated)

⸻

12. Telemetry & Usage Tracking

Add usage dimensions for PersonaPlex sessions:
	•	audio input seconds
	•	audio output seconds
	•	session duration
	•	dropped frames
	•	reconnect count
	•	provider latency

These should plug into your existing usage dashboards (you already have usage tracking components/functions).  ￼

⸻

13. Testing Requirements

Unit Tests
	•	Resampler correctness (48k → 24k, etc.)
	•	Provider adapter interface tests

Integration Tests
	•	PersonaPlex endpoint connectivity + auth
	•	End-to-end voice session:
	•	connect → speak → receive speech → barge-in → disconnect
	•	Error scenarios:
	•	endpoint down
	•	slow responses
	•	invalid audio frames
	•	auth rejected

UX Tests
	•	Provider switching persists correctly per agent
	•	Chat remains unchanged

⸻

14. Rollout Plan

Phase 1 (MVP)
	•	Provider selector + Persona prompt + fixed voice list (NAT/VAR IDs)
	•	Self-hosted PersonaPlex endpoint
	•	Basic streaming audio in/out
	•	Usage tracking + health checks
	•	No tool execution (or limited)

Phase 2
	•	Embed support parity
	•	Tool execution parity (if desired)
	•	Voice sample upload (only if supported cleanly)
	•	Failover + autoscaling

⸻

15. Acceptance Criteria
	•	✅ A user can select PersonaPlex for Voice agents only
	•	✅ Voice sessions stre ￼uccessfully with 24kHz compliance  ￼
	•	✅ Persona prompt affects behavior (noticeably different persona)
	•	✅ Voice selection works from the supported voice list (NAT/VAR)  ￼
	•	✅ Chat agents behave exactly as before (no regression)
	•	✅ Secrets are not exposed client-side
	•	✅ Usage & health are visible in dashboard/telemetry

