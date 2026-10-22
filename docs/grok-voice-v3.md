# Grok Voice 3.0 integration

The existing `xai_realtime` provider supports the pinned `grok-voice-3.0` model and `grok-voice-latest` alias. xAI currently resolves the alias to 3.0. This uses the existing realtime WebSocket endpoint, browser-safe ephemeral credentials, and session configuration. See the [official Speech to Speech documentation](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech).

## Selecting a model and voice

Open Settings and choose **Grok Voice (direct)** as the voice provider. Select a saved xAI key, choose **Grok Voice 3.0 · pinned**, and select a voice. Save and start a new conversation. The latest alias remains available for users who prefer automatic provider upgrades.

The picker includes all 28 built-in voices confirmed against the live `GET /v1/tts/voices` catalog: Altair, Ara, Atlas, Aurora, Carina, Castor, Celeste, Cosmo, Eve, Helios, Helix, Iris, Kepler, Leo, Liora, Lumen, Luna, Lux, Naksh, Orion, Perseus, Rex, Rigel, Sal, Sirius, Ursa, Zagan, and Zenith. Every voice supports multiple languages. Each picker option includes a short description. The [official voice catalog](https://docs.x.ai/developers/model-capabilities/audio/voice#voices) describes their styles.

## Compatibility

- Changing the Grok model preserves the selected voice. The model selector previously reset it to an OpenAI voice.
- Existing built-in names such as `Rex` are sent as canonical lowercase IDs such as `rex`. Saved custom voice IDs retain their exact case.
- Saved `grok-voice-2.0` and older `grok-voice-think-fast-1.0` / `grok-voice-think-fast-2.0` selections resolve to 3.0 when loaded or connected. There is no bulk database rewrite.
- Native and routed sessions use the same model/voice normalization. Embed session responses also report the normalized model and voice.
- Existing language, reasoning, tools, PCM audio, and interruption handling remain available. No database migration or new provider key is needed.
- Integrating these options does not switch another preset's provider. Choose Grok on a preset when you want to use it.

## Validation and deployment

`npm run test:xai-voice` checks model compatibility and actual client WebSocket/session payloads for new voices in native and routed modes. `npm run test:voice` covers the existing voice lifecycle, routing, and receipts.

Deploy the updated embed-session function with:

```sh
supabase functions deploy voice-ephemeral-key --project-ref YOUR_PROJECT_REF --use-api
```

Deploy the frontend from `main` as usual. The authenticated `realtime-session` credential endpoint requires no change because model selection happens in the WebSocket URL.

To verify a real provider handshake and audio response:

```sh
node scripts/xai-voice-smoke.mjs --project-ref YOUR_PROJECT_REF --owner-id YOUR_VA_USER_ID --voice iris
```

The script reads the owner's existing xAI key using the authenticated Supabase CLI, checks all configured built-in voice IDs against the live catalog, creates a short-lived credential, connects using the browser's WebSocket subprotocol, configures the requested voice, and asks for a short greeting. It succeeds after receiving PCM audio. Credentials are kept in memory and never printed. xAI may omit the voice from its session echo; the report distinguishes the requested voice from an echoed voice rather than claiming an absent echo was verified.

Verified on October 22, 2026: provider model `grok-voice-3.0`, requested voice `iris`, 28 configured voice IDs available, ephemeral authentication accepted, and first PCM audio received. This smoke check exercises provider authentication and speech generation, rather than microphone capture or playback through the product UI.
