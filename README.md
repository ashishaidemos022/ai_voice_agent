# AI Voice Agent

## Grok Voice 3.0

In Settings, select **Grok Voice (direct)**, choose your xAI API key, then select **Grok Voice 3.0 · pinned** (or **latest · currently 3.0**) and a voice. The picker includes all 28 built-in voices, with descriptions to help choose a style. Save the preset and start a new call. See [Grok V3 integration and verification](docs/grok-voice-v3.md).

## IRS notice and refund agent

The **IRS Notice & Refund Concierge · Jev + Eleven Max** preset combines the existing `irs_*` demo tables, identity-gated account lookup, Jev decisions on every substantive turn, and expressive ElevenLabs Realtime Max voice. See [setup, connected tables, behavior, and tests](docs/irs-notice-resolution.md).

## ElevenLabs Realtime models

In Settings, select **ElevenLabs Agent** as the voice provider, select your ElevenLabs API key, and choose **App-managed profile**. Under **Voice mode / model**, choose **Eleven Realtime v1 Mini** or **Eleven Realtime v1 Max**, select a voice, save the preset, then **Create & publish** (or **Publish changes**). Start a Native voice session or use the preset's voice embed; both use the published ElevenLabs agent through the existing signed-session connection.

The server sends `conversation_config.realtime_model` when creating or updating the remote agent. Realtime manages the LLM, TTS model, expressive mode, and ASR. The preset's prompt, voice, tools, language, and turn settings still apply. Selecting **Custom** and publishing sends `null` and restores the stored LLM/TTS choices. Existing presets remain in Custom mode until changed. ElevenLabs-managed profiles continue to use the mode configured in ElevenLabs.

Max requires at least 1,024 response tokens (or `-1` for unlimited). Selecting Max raises a lower local limit to 1,024; the server also validates the limit before provider writes. Mini is unavailable with HIPAA or Zero Retention Mode; Max supports those configurations in US/EU and is unavailable in India/Singapore. Transfers must remain between Realtime agents, and workflow overrides of managed settings are unsupported. Provider validation errors appear in the publish panel, including workspace rollout restrictions. See [ElevenLabs Realtime documentation](https://elevenlabs.io/docs/eleven-agents/customization/realtime-models).

Deploy the updated `elevenlabs-agent-session` Supabase function and frontend together. No database migration or additional provider key is required. Run `npm run test:elevenlabs-realtime` for mocked provider create/update, mode switching, and rejection coverage. A live voice check still requires an authenticated preset and Realtime-enabled ElevenLabs workspace.

## GPT-Live smoke test

The workspace voice client supports `gpt-live-1` through the deployed `realtime-session` function. To verify a real authenticated WebRTC handshake, save a browser-generated audio SDP offer and run:

```bash
VOICE_AGENT_USER_JWT='…' \
VOICE_AGENT_ID='…' \
VOICE_AGENT_SDP_FILE='/absolute/path/to/offer.sdp' \
npm run smoke:gpt-live
```

The script reads the Supabase URL and anon key from `.env`, submits the offer to the deployed function, and validates that OpenAI returned a WebRTC answer. It never reads or prints the user JWT.

## A2UI Testing Notes

### Workspace (Chat + Voice)
1) Open an agent preset in Settings and toggle **Enable A2UI (agent-generated UI)** on.
2) Start a chat or voice session with that preset.
3) Ask the agent to return A2UI (example: "Show a simple form with a submit button").
4) Verify the UI renders in the assistant bubble and button/form clicks send an `A2UI_EVENT` user message.

### Embeds (Chat + Voice)
1) Create or enable an embed for the same preset.
2) Load the chat embed `.../embed/chat/<public_id>` and confirm A2UI renders only when enabled.
3) Load the voice embed `.../embed/voice/<public_id>` and confirm A2UI renders in the conversation log.
4) Toggle A2UI off in the preset and refresh embeds; UI should stop rendering and fallback text should display.

### Regression Checks
- With A2UI off, responses must remain plain text (no UI rendering).
- Verify existing realtime behavior is unchanged when A2UI is disabled.
