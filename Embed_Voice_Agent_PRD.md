

📄 Product Requirements Document (PRD)

Embeddable Voice Agent Widget for External Websites

Author: Ashish Bhatia
Product: Voice Agent Embed SDK
Version: 1.0
Date: 2025-12-09

⸻

1. Overview

The purpose of this PRD is to define the design, API requirements, UX behavior, and technical implementation for embedding a Voice AI Agent (powered by OpenAI Realtime API + Supabase Edge Functions + your MCP tools) on any external website through:
	1.	A Javascript bootstrap loader (single <script> tag)
	2.	A fully isolated Iframe UI hosting the Voice Agent client
	3.	Secure ephemeral token retrieval from a backend function
	4.	WebRTC/WebSocket audio streaming between browser ↔ OpenAI Realtime model
	5.	Optional text-based fallback UI (like your chat widget)
	6.	The ability to support call-center style workflows, including authentication, claim lookup, FNOL, scheduling, and more.

This feature allows partners, customers, or BPOs to embed your AI voice agent on their own sites without exposing sensitive keys or architectural complexity.

⸻

2. Goals & Non-Goals

2.1 Goals
	•	Provide a simple 1-line embed script for any website:

<script src="https://yourdomain.com/voiceLoader.js"
        data-agent="voice-demo-001"
        data-theme="dark"
        async></script>


	•	Deliver a consistent, high-quality voice assistant interface inside an iframe.
	•	Support WebRTC (preferred) or WebSocket for streaming audio.
	•	Support TTS playback (16k PCM or Opus).
	•	Support speech-to-text (capture microphone continuously).
	•	Integrate tightly with existing MCP tools (member verification, claim lookup, etc.).
	•	Maintain session state via:
	•	LocalStorage (optional)
	•	Supabase sessions table (server-side)
	•	Support widget mode and expanded mode.
	•	Full compatibility with Vercel hosting and Supabase Edge Functions.
	•	Full isolation (JS sandbox) so the host website cannot interfere.

2.2 Non-Goals
	•	This PRD does not cover the training of models.
	•	Does not define design for telephony-based voice (Twilio integrations).
	•	Does not include analytics dashboards (future release).
	•	Does not include agent handoff to human voice agents.

⸻

3. User Experience (UX)

3.1 Embed Experience

User loads a single script:

<script src="https://app.com/voiceLoader.js"
        data-agent="abc123"
        data-theme="dark"
        data-autostart="0"
        async></script>

The loader inserts a floating Voice Bubble Button in the bottom-right.

When clicked:
	•	Expands into a card-style “Voice Assistant Panel”
	•	Agent avatar pulses when speaking
	•	Live transcription temporarily appears
	•	Button toggles between Start, Listening, Stop states

3.2 Voice Agent UI States

State	Description
Idle	Waiting for user interaction
Listening	Mic active, capturing user speech
Processing	Sending STT + awaiting model response
Speaking	TTS output playing
Error	Connectivity or permission issues

Visual indicators must be minimal and non-intrusive:
	•	Mic glowing during listening
	•	Waveform animation during output
	•	Red badge on mic if browser mic permissions fail

3.3 Fallback Mode

If:
	•	Mic blocked
	•	Realtime audio fails
	•	Browser unsupported

→ Automatically fallback into text-chat mode (using your existing widget UI).

⸻

4. Technical Architecture

4.1 High-Level Flow

Website → voiceLoader.js → iframe
iframe → /functions/v1/voice-ephemeral-key (Supabase)
iframe → OpenAI Realtime API (WebRTC or WS)
OpenAI → TTS/STT + agent runtime
iframe → UI output + waveform + transcripts

4.2 Components
	•	public/voiceLoader.js → bootstrap script
	•	/voice/embed/:agentId → voice agent iframe React app
	•	src/voice/VoiceAgentApp.tsx → core UI
	•	src/voice/useVoiceAgent.ts → streaming + token logic
	•	agent-voice Edge Function:
	•	Retrieves agent config from Supabase
	•	Generates ephemeral OpenAI Realtime token
	•	Enforces domain origin rules
	•	Audio pipeline:
	•	getUserMedia → microphone → Realtime client
	•	Realtime API → TTS stream → AudioWorklets or WebAudio

⸻

5. API Requirements

5.1 Ephemeral Token Endpoint

Route:
POST /functions/v1/voice-ephemeral-key

Payload:

{
  "agent_id": "voice-demo-001",
  "origin": "https://embedding-site.com"
}

Response:

{
  "token": "realtime_ephemeral_key_abc...",
  "expires_at": 1700000000,
  "agent": {
     "name": "BlueCare Voice Assistant",
     "instructions": "... system prompt ...",
     "model": "gpt-4o-realtime",
     "voice": "nova",
     "allowed_origins": ["*"]
  }
}

5.2 Realtime API Connection

The iframe establishes:

WebRTC:
	•	RTCPeerConnection
	•	Send microphone audio using MediaStreamTrack
	•	Receive TTS audio (Opus)

or

WebSocket:

wss://api.openai.com/v1/realtime?model=gpt-4o-realtime
Authorization: Bearer <ephemeral-key>

5.3 Message Protocol

Iframe sends:

{
  "type": "input_audio_buffer.append",
  "audio": "<binary>"
}

OpenAI streams:

{
  "type": "output_audio_buffer.append",
  "audio": "<binary>"
}

STT samples:

{
  "type": "transcript.delta",
  "text": "…partial…"
}

Assistant response:

{
  "type": "response.completed",
  "content": "…final text…"
}


⸻

6. Security Requirements

6.1 Ephemeral-Key Security
	•	Must only be generated server-side
	•	Stored nowhere client-side
	•	Duration: ≤ 10 minutes
	•	IP/domain validation required

6.2 Allowed Origins

Each agent_id has allowed origins defined in Supabase:

mybank.com
accountingportal.com
*.insurance.gov

If origin mismatch → reject.

6.3 No API Keys in Browser
	•	All calls use ephemeral tokens
	•	No access to Supabase service role keys
	•	No direct OpenAI API calls from external websites

⸻

7. Performance Requirements

Metric	Goal
Initial loader load	< 200ms
Ephemeral token generation	< 150ms
Real-time audio roundtrip latency	< 500ms
Widget open animation	< 200ms
Memory footprint	< 50MB

Audio playback must stream progressively with minimal buffering.

⸻

8. Browser Support

Supported
	•	Chrome (latest)
	•	Edge (latest)
	•	Safari (latest)
	•	Firefox (WS-only; fallback if WebRTC unsupported)

Fallback Mode
	•	If browser lacks WebAudio/WASM:
→ auto-switch to text mode

⸻

9. Detailed UI Spec

9.1 Floating Button
	•	Position: bottom-right
	•	Dark theme:
	•	bg-slate-900
	•	text-white
	•	Shows agent icon
	•	On click → expands panel

9.2 Agent Panel Layout

+--------------------------------------+
|  Header: agent name, status, reset   |
+--------------------------------------+
|  Live transcript + waveform          |
+--------------------------------------+
|  Assistant output text               |
+--------------------------------------+
|  Controls: Mic Start/Stop            |
+--------------------------------------+

Mic Button States:

State	Icon	Behavior
Idle	◉	Start listening
Listening	🔴	Stop listening
Speaking	🔊	Disabled
Error	⚠️	Retry


⸻

10. Loader Script Requirements (voiceLoader.js)

Behavior:
	1.	Reads script attributes:

data-agent
data-theme (dark/light)
data-autostart (0/1)
data-position (br/bl/tr/tl)


	2.	Injects iframe:

<iframe src="https://yourapp.com/voice/embed/<agent>?theme=dark&widget=1"/>


	3.	Handles resizing:
	•	Auto-height based on UI
	4.	Prevents host CSS from leaking into iframe
	5.	Prevents host script from accessing iframe JS (sandbox)

⸻

11. Supabase Schema Additions

va_voice_embeds

id                 uuid PK
public_id          text unique
agent_id           uuid FK
allowed_origins    text[]
tts_voice          text
rtc_enabled        boolean
is_enabled         boolean default true
created_at         timestamptz

va_voice_sessions

id uuid PK
agent_id uuid FK
user_id uuid FK
status text
session_metadata jsonb
created_at timestamptz


⸻

12. Edge Function Specs

/functions/v1/voice-ephemeral-key

Responsibilities:
	•	Validate origin
	•	Load agent config
	•	Check allowed_origins
	•	Generate ephemeral key via OpenAI API:

POST /v1/realtime/sessions


	•	Store session server-side
	•	Return token + config

Errors:
	•	403 Origin Not Allowed
	•	404 Agent Not Found
	•	500 Token Generation Failed

⸻

13. Testing Scenarios

13.1 Basic Web Embed
	•	Load voice widget on a static HTML page
	•	Speak → agent replies with TTS
	•	Verify STT correctness

13.2 Large Site Integration (SPA)
	•	Embed inside React/Next
	•	Test iframe resizing, z-index, overlapping components

13.3 Forbidden Origin
	•	Should block token creation
	•	UI shows “Origin not allowed”

13.4 Fallback Mode
	•	Block mic → should fall back to text-chat

13.5 Network Loss
	•	Simulate disconnect
	•	UI shows reconnect button

⸻

14. Release Plan

Phase 1: Foundations
	•	VoiceAgentApp UI
	•	Loader script
	•	Ephemeral key edge function
	•	Audio streaming working

Phase 2: Reliability
	•	Dynamic reconnection
	•	Whisper partial transcripts
	•	TTS buffering optimizations

Phase 3: Features
	•	Wake word (“Hey BlueCare”)
	•	Export audio transcript
	•	Human-agent failover
	•	Multi-language support

⸻

15. Open Questions
	•	Should we support custom voice skins?
	•	Do we need analytics on utterances and session length?
	•	Should we allow host websites to trigger the agent programmatically (JS API)?

⸻

End of Document

