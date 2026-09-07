# Routed workspace voice

Choose **Live voice + memory** from the Voice workspace after ending any native call. Select the agent, customer profile, and Auto routing or a fixed model, then **Start voice session**. The microphone connects automatically. Speak normally; there is no Record, Transcribe, or Send step.

The existing OpenAI WebRTC transport continuously streams microphone audio, emits speech/transcription events, and plays generated audio as it arrives. Server VAD detects a completed utterance after a short pause. Speech interruption mutes and clears output immediately, including audio buffered after response completion. The microphone stays live while the agent reasons and speaks. Stop microphone, navigation, session end, and hiding the tab release the connection. Reconnect microphone opens a fresh audio connection while keeping the workspace conversation.

The shared chat reasoning pipeline receives final speech transcripts automatically and retains its memory, routing, RAG, SQL, and receipts. Realtime is the speech layer; its automatic answers and tools are disabled at call creation and session update. It reads supplied answers in isolated responses, preventing a competing answer from the audio model. Reasoning/tool latency still exists: speech begins once the shared runtime has produced the answer, then streams over WebRTC. This does not stream partial reasoning text. Long answers use consecutive speech segments.

Speaking during an active tool turn interrupts audio and queues the next question until the existing business action settles. Stale answers are not spoken. Interruption cannot undo a completed memory write or business action. Duplicate transcription events are deduplicated.

**Use optional recording & transcript review** exposes the earlier recording controls for users who want to check text before sending. That mode continues to use `voice-audio`; it is not the default conversation experience.

Live transport uses OpenAI Realtime with the shared configured default model and coral voice. Other native provider paths remain available in the existing Voice workspace. Realtime audio/transcription costs are additional to the routing receipt; the recording audio ledger described below applies to the optional file-based mode only.

## Live deployment and verification

Deploy the updated `realtime-session` function and frontend together. No additional migration is required for live audio. The function validates `routed_session_id` against the signed-in user, agent, active status, and routed channel. Native calls without this parameter keep their existing configuration. Routed calls cannot request benchmark overrides or WebSocket secrets.

Run `npm run test:voice`. Added tests cover continuous microphone capture during reasoning/playback, natural interruption events, queued questions, duplicate/late transcripts, stale answer suppression, buffered playback cancellation, response-creation races, and endpoint isolation. These use mocked transport/provider boundaries; a real microphone and speaker rehearsal is still required to measure latency and echo behavior.

References: [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations), [voice activity detection](https://developers.openai.com/api/docs/guides/realtime-vad).

## Shared reasoning and memory

Routed voice uses the existing `useChatAgent` → `responses-chat` path for instructions, memory tools, playbooks, Auto routing, RAG, SQL, and source highlighting. Chat retains its default configuration. Native realtime adapters, provider settings, Voice Lab, and public embeds remain separate.

Voice sessions use `va_chat_sessions.metadata.channel = routed_voice`; transcripts and source receipts use `va_chat_messages`. History labels these sessions Voice and shows their audio usage. Long-term memory is shared by owner + agent + customer profile. New sessions do not automatically inherit another session's short-term conversation. Existing agent instructions and RAG query behavior remain unchanged.

## Optional recording speech and usage

The authenticated `voice-audio` Edge Function verifies user, session ownership, agent binding, active status, and channel before invoking OpenAI. Transcription uses `gpt-4o-mini-transcribe`; speech uses `gpt-4o-mini-tts` with coral/alloy/sage. Audio files are not stored. Speech text is always read from an owned, saved assistant answer, never accepted from caller input. Long answers are split at sentence/word boundaries into segments no longer than 3,800 characters. Playback starts after text generation and the first audio segment; later segments are generated sequentially. This is not token-streamed realtime audio.

`va_voice_audio_events` stores each successful provider request's session, operation, model, turn/segment, latency, input size, provider request ID, raw transcription usage when returned, and nullable estimated cost. Owners can read their records; only the service role writes. No transcript/audio content is duplicated in this ledger. A replay generates another billable request and another event.

Transcription estimates use browser-measured recording duration at $0.003/minute, checked against [OpenAI pricing](https://developers.openai.com/api/docs/pricing) on September 7, 2026. Duration is bounded but is client-reported; estimates are not invoices. TTS estimates remain unknown unless `VOICE_TTS_USD_PER_MILLION_CHARACTERS` is set to an account-specific estimate. This is an administrator-supplied character-based approximation, not OpenAI's token billing formula. Missing values display as unpriced rather than free. Audio estimates are separate from the existing routing/RAG receipt; the UI does not label their sum a complete bill. Interrupted, failed, or timed-out provider requests can still incur costs that are unavailable to this ledger.

API references: [transcription](https://developers.openai.com/api/docs/guides/speech-to-text), [speech generation](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create).

## Optional recording deployment

1. Apply `supabase/migrations/20260907120000_routed_voice_usage.sql` using the project's migration process. Do not push unrelated divergent migrations.
2. Deploy `voice-audio` with JWT verification enabled and the existing server-side `OPENAI_API_KEY`.
3. Deploy the frontend. No changes to `responses-chat`, memory tables, or existing realtime functions are required.

## Validation and demo rehearsal

Automated checks cover endpoint ownership, invalid segments/formats, server-owned speech input, long-answer preservation, silence/noise endpointing, and PostgreSQL row-level security. Run the existing chat context, memory, RAG, routing, source activity, and native gateway tests as regressions; run frontend typecheck/build and Deno check for the new function.

Browser layout verification is separate from a live microphone rehearsal. After deployment:

1. In Shopify chat, save a preference for Alex. Start routed voice with the same agent/profile; ask what budget it remembers. Verify the semantic source receipt and spoken answer.
2. Ask about a past footwear experience, document knowledge, and live inventory. Verify episodic, RAG, and SQL source blocks and routing receipts.
3. Speak an explicit preference correction; confirm one memory version, then retrieve it from a new regular chat.
4. Test automatic silence detection, long answers, playback interruption, queue/discard during a slow tool, and fixed versus Auto routing.
5. Deny microphone access, pause during transcription, end a session during playback, and hide the tab. Confirm the microphone indicator clears and no stale transcript enters another session.
6. Check Voice history and audio usage, then confirm regular chat and a native realtime call work as before.
