# Live Translation (ElevenLabs Realtime Translation)

Two people talk, each speaking their own language and hearing the other in theirs. The translation plays in a natural ElevenLabs voice. The feature is built on the
[Realtime Translation WebSocket](https://elevenlabs.io/docs/api-reference/realtime-translation/v-1-translation-realtime)
(`GET /v1/translation/realtime`). That API is in **alpha and only open to ElevenLabs enterprise workspaces**.

Open it from **Live Translation** in the workspace sidebar.

## How a conversation works

- One conversation opens **two translation streams**, one per direction:
  - A's mic audio goes to the A→B stream (target = B's language, voice = A's chosen voice).
  - B's audio goes to the B→A stream the same way.
- Both people share one device and take turns. To speak, tap your side or press `1` / `2`. `Esc` mutes both.
  - Translation starts while the speaker is still talking. How soon is set by **eagerness**.
  - When the floor changes hands, the previous stream gets about 800 ms of silence so its last phrase finishes.
- Mic audio is captured at 16 kHz PCM16 and sent as `input_audio_chunk` messages of about 100 ms (the size ElevenLabs recommends).
  - Translated audio comes back as `pcm_24000`. It is played at the `sample_rate` that each `audio` message reports.
- Captions show the live source transcript (`partial_transcript` / `final_transcript`) and the `translation` text.
  - Each turn records two latencies, measured from speech onset: first translated text and first translated voice.
- Settings:
  - **Voice model**: `eleven_v4_turbo` (default), `eleven_flash_v2_5` or `eleven_v3`.
  - **Eagerness**: `high`, `medium` or `low`.
  - **Zero Retention Mode** (`enable_zrm`).
  - **Echo guard**: mutes the mic while a translation is playing. Use it on laptop speakers if translations start repeating. Headphones work best.
- Transcripts stay in the browser. Nothing is stored, and the gateway never logs transcript text.

## Architecture

```
Browser ──1. action=token (Supabase user JWT)──▶ edge fn `elevenlabs-translation`
        ◀── 90 s gateway token (user, origin, direction config) ──
Browser ──2. wss …/api/translate-ws?token=…──▶ Vercel `api/translate-ws.js`
                     └─3. action=resolve (x-viaana-gateway-secret)──▶ edge fn → { api_key, upstream_url }
                     └─4. wss api.elevenlabs.io/v1/translation/realtime (xi-api-key header)
```

ElevenLabs has no single-use browser token for this endpoint, so the user's API key has to stay server-side:

- The browser only ever holds a short-lived gateway token. That token is signed with `ELEVENLABS_GATEWAY_JWT_SECRET` and scoped to the user, their origin and one translation direction.
- The edge function hands the decrypted key only to the gateway, and only when the gateway presents `ELEVENLABS_TRANSLATION_GATEWAY_SECRET`.
- The gateway forwards only `input_audio_chunk` and `end_of_stream` upstream. It relays every upstream message back unchanged.
- If ElevenLabs refuses the upgrade (for example 401/403 for a non-enterprise workspace), the gateway shows that status to the user with a hint.

| File | Role |
| --- | --- |
| `shared/realtime-translation.ts` | Languages, config validation, upstream URL, message parsing, PCM helpers |
| `supabase/functions/elevenlabs-translation/index.ts` | `token` and `resolve` actions |
| `api/translate-ws.js` | Vercel WebSocket proxy |
| `src/lib/realtime-translation-client.ts` | Token request, `TranslationStream`, `TranslationMic`, `PcmPlayer` |
| `src/components/translation/LiveTranslation.tsx` | The Live Translation page |

## Deploy

1. Generate a shared secret, then set it in **both** Supabase and Vercel:
   ```sh
   SECRET=$(openssl rand -hex 32)
   supabase secrets set ELEVENLABS_TRANSLATION_GATEWAY_SECRET=$SECRET
   vercel env add ELEVENLABS_TRANSLATION_GATEWAY_SECRET production   # paste $SECRET (repeat for preview)
   ```
   The function reuses the existing `ELEVENLABS_GATEWAY_JWT_SECRET` to sign tokens.
2. Deploy the edge function **without platform JWT verification**:
   ```sh
   supabase functions deploy elevenlabs-translation --no-verify-jwt
   ```
   The gateway calls it server-to-server, the same way `api/ws.js` calls `elevenlabs-speech`. The function checks auth itself for each action: a user JWT for `token`, the gateway secret for `resolve`.
3. Deploy the Vercel app. Pushing `main` does this. The proxy is served at `/api/translate-ws`.

Optional env vars:

| Where | Variable | Default |
| --- | --- | --- |
| Supabase | `ELEVENLABS_TRANSLATION_GATEWAY_WS_URL` | `wss://ai-voice-agent-sage.vercel.app/api/translate-ws` (used for localhost and other origins) |
| Supabase | `ELEVENLABS_TRANSLATION_WS_BASE_URL` | `wss://api.elevenlabs.io` (set to `wss://api.eu.residency.elevenlabs.io` etc. for data residency) |
| Supabase | `ELEVENLABS_TRANSLATION_TOKEN_TTL_SECONDS` | `90` |
| Vercel | `ELEVENLABS_TRANSLATION_RELAY_URL` | the project's `functions/v1/elevenlabs-translation` URL |

Tests: `npm run test:translation`. They cover the shared helpers, plus the gateway running against a mock ElevenLabs upstream and a mock relay.

## Known limits

- One device, turn-taking. Two people on separate devices would need a room and audio relay; that is a natural next step.
- ElevenLabs documents `input_format` / `output_format` only as free-form values. `pcm_16000` / `pcm_24000` follow the other ElevenLabs realtime APIs.
