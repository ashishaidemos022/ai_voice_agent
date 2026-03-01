# PersonaPlex Gateway

WebSocket proxy for PersonaPlex. It validates short-lived JWTs, enforces origin allowlists, and forwards framed binary messages to/from PersonaPlex.

## Deploying to Fly.io

From the `gateway/` folder:

1) Launch (first time only):
```
fly launch
```

2) Set secrets:
```
fly secrets set PERSONAPLEX_GATEWAY_JWT_SECRET=... \
  ELEVENLABS_GATEWAY_JWT_SECRET=... \
  PERSONAPLEX_WS_URL=... \
  SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=...
```

Notes:
- `PERSONAPLEX_WS_URL` must include `/api/chat`.
- `ELEVENLABS_GATEWAY_JWT_SECRET` is required for ElevenLabs gateway tokens.
- Optional ElevenLabs runtime vars: `ELEVENLABS_BASE_URL`, `ELEVENLABS_UPSTREAM_TIMEOUT_MS`.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are optional (used for health reporting).

3) Deploy:
```
fly deploy
```

4) Logs:
```
fly logs
```

## Health checks
- `GET /healthz` → `{ "status": "ok" }`
- `GET /readyz` → `{ "status": "ready" }` if required env vars are present.
