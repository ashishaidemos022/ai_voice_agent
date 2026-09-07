# Routed workspace voice

Choose **Routed voice + memory** from the Voice workspace after ending any native call. Select the agent, customer profile, and Auto routing or a fixed model, then start a voice session.

**Start conversation** enables automatic sending: speak, pause for one second, and hear the answer. The microphone closes while transcription, reasoning, and playback run, then opens for the next turn. **Pause conversation** closes the microphone and stops playback. A minute without a completed utterance pauses capture; hiding the browser tab, leaving the workspace, or ending the session also releases capture and playback.

**Record question** remains available for transcript review before Send. **Interrupt & speak** stops the current audio and records a new question. During continuous mode, a question recorded while a tool is running is queued and sent once that turn finishes; its text is visible and can be discarded. This preserves completed tool results and avoids overlapping memory writes. Interruption does not undo business actions or memory changes. This implementation uses button interruption, not acoustic barge-in during playback.

## Shared reasoning and memory

Routed voice uses the existing `useChatAgent` → `responses-chat` path for instructions, memory tools, playbooks, Auto routing, RAG, SQL, and source highlighting. Chat retains its default configuration. Native realtime adapters, provider settings, Voice Lab, and public embeds remain separate.

Voice sessions use `va_chat_sessions.metadata.channel = routed_voice`; transcripts and source receipts use `va_chat_messages`. History labels these sessions Voice and shows their audio usage. Long-term memory is shared by owner + agent + customer profile. New sessions do not automatically inherit another session's short-term conversation. Existing agent instructions and RAG query behavior remain unchanged.

## Speech and usage

The authenticated `voice-audio` Edge Function verifies user, session ownership, agent binding, active status, and channel before invoking OpenAI. Transcription uses `gpt-4o-mini-transcribe`; speech uses `gpt-4o-mini-tts` with coral/alloy/sage. Audio files are not stored. Speech text is always read from an owned, saved assistant answer, never accepted from caller input. Long answers are split at sentence/word boundaries into segments no longer than 3,800 characters. Playback starts after text generation and the first audio segment; later segments are generated sequentially. This is not token-streamed realtime audio.

`va_voice_audio_events` stores each successful provider request's session, operation, model, turn/segment, latency, input size, provider request ID, raw transcription usage when returned, and nullable estimated cost. Owners can read their records; only the service role writes. No transcript/audio content is duplicated in this ledger. A replay generates another billable request and another event.

Transcription estimates use browser-measured recording duration at $0.003/minute, checked against [OpenAI pricing](https://developers.openai.com/api/docs/pricing) on September 7, 2026. Duration is bounded but is client-reported; estimates are not invoices. TTS estimates remain unknown unless `VOICE_TTS_USD_PER_MILLION_CHARACTERS` is set to an account-specific estimate. This is an administrator-supplied character-based approximation, not OpenAI's token billing formula. Missing values display as unpriced rather than free. Audio estimates are separate from the existing routing/RAG receipt; the UI does not label their sum a complete bill. Interrupted, failed, or timed-out provider requests can still incur costs that are unavailable to this ledger.

API references: [transcription](https://developers.openai.com/api/docs/guides/speech-to-text), [speech generation](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create).

## Deployment

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
