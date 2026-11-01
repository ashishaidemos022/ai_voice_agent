// Vercel WebSocket proxy for ElevenLabs Realtime Translation (/v1/translation/realtime).
//
// Browser ──(gateway token)──▶ this proxy ──(xi-api-key header)──▶ ElevenLabs
//
// The proxy holds no long-lived credentials of its own: it exchanges the browser's short-lived
// gateway token for the user's ElevenLabs key + upstream URL by calling the
// `elevenlabs-translation` edge function with a shared gateway secret.
// Only input_audio_chunk / end_of_stream are forwarded upstream; every upstream JSON
// message is forwarded to the browser unchanged. Transcripts are never logged.
import express from 'express';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const RELAY_URL = process.env.ELEVENLABS_TRANSLATION_RELAY_URL ||
  'https://mnrseaapxpofdznnqrsv.supabase.co/functions/v1/elevenlabs-translation';
const GATEWAY_SECRET = process.env.ELEVENLABS_TRANSLATION_GATEWAY_SECRET || '';
const RELAY_TIMEOUT_MS = Number(process.env.ELEVENLABS_TRANSLATION_RELAY_TIMEOUT_MS || 10000);
const UPSTREAM_CONNECT_TIMEOUT_MS = Number(process.env.ELEVENLABS_TRANSLATION_CONNECT_TIMEOUT_MS || 10000);
const MAX_PENDING_CHUNKS = 60; // ~6 s of 100 ms chunks while the upstream is connecting
const MAX_CHUNK_BASE64_LENGTH = 256 * 1024;

const app = express();
app.use((_req, res) => {
  res.status(200).json({ status: 'ready', service: 'elevenlabs-translation-gateway', configured: Boolean(GATEWAY_SECRET) });
});

const server = createServer(app);

const wss = new WebSocketServer({
  server,
  perMessageDeflate: false,
  maxPayload: 512 * 1024,
  verifyClient(info, done) {
    const url = new URL(info.req.url || '/', `https://${info.req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');
    const origin = info.origin || info.req.headers.origin || '';
    if (!token || !origin) {
      done(false, 401, 'Incomplete gateway request');
      return;
    }
    info.req.translationContext = { token, origin };
    done(true);
  }
});

const sendJson = (socket, message) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};

// 1005/1006/1015 are reserved and cannot be sent in a close frame.
const safeCloseCode = (code) => (Number.isInteger(code) && code >= 1000 && code < 5000 && ![1005, 1006, 1015].includes(code) ? code : 1011);
const safeReason = (reason) => `${reason || ''}`.slice(0, 120);

const resolveSession = async (context) => {
  if (!GATEWAY_SECRET) throw new Error('ELEVENLABS_TRANSLATION_GATEWAY_SECRET is not configured on the gateway');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);
  try {
    const response = await fetch(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-viaana-gateway-secret': GATEWAY_SECRET },
      body: JSON.stringify({ action: 'resolve', token: context.token, origin: context.origin }),
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.api_key || !body.upstream_url) {
      throw new Error(body.error || `Translation token rejected (${response.status})`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
};

wss.on('connection', async (client, req) => {
  const context = req.translationContext || {};
  const startedAt = Date.now();
  const pending = [];
  let upstream = null;
  let chunksIn = 0;
  let audioOut = 0;
  let sessionId = null;
  let clientClosed = false;

  const forwardToUpstream = (text) => {
    if (upstream?.readyState === WebSocket.OPEN) {
      upstream.send(text);
    } else if (pending.length < MAX_PENDING_CHUNKS) {
      pending.push(text);
    }
  };

  client.on('message', (data, isBinary) => {
    if (isBinary) {
      sendJson(client, { message_type: 'gateway_error', error: 'Binary frames are not supported; send input_audio_chunk JSON' });
      return;
    }
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      sendJson(client, { message_type: 'gateway_error', error: 'invalid-json' });
      return;
    }
    if (message?.message_type === 'input_audio_chunk') {
      if (typeof message.audio_base_64 !== 'string' || message.audio_base_64.length > MAX_CHUNK_BASE64_LENGTH) {
        sendJson(client, { message_type: 'gateway_error', error: 'invalid input_audio_chunk' });
        return;
      }
      chunksIn += 1;
      forwardToUpstream(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: message.audio_base_64 }));
      return;
    }
    if (message?.message_type === 'end_of_stream') {
      forwardToUpstream(JSON.stringify({ message_type: 'end_of_stream' }));
      return;
    }
    sendJson(client, { message_type: 'gateway_error', error: 'unsupported-message-type' });
  });

  client.on('close', () => {
    clientClosed = true;
    if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
      try { upstream.close(1000, 'client-closed'); } catch { /* ignore */ }
    }
    console.log(JSON.stringify({
      event: 'translation_gateway_session_end',
      session_id: sessionId,
      duration_ms: Date.now() - startedAt,
      input_chunks: chunksIn,
      audio_messages_out: audioOut
    }));
  });

  let session;
  try {
    session = await resolveSession(context);
  } catch (error) {
    console.error('[translation-gateway] resolve failed', error?.message || error);
    sendJson(client, { message_type: 'gateway_error', error: error?.message || 'Unable to authorize translation session' });
    client.close(1008, 'translation-auth-failed');
    return;
  }
  if (clientClosed) return;
  sessionId = session.session_id || null;

  const ws = new WebSocket(session.upstream_url, {
    headers: { 'xi-api-key': session.api_key },
    perMessageDeflate: false
  });
  upstream = ws;

  const connectTimeout = setTimeout(() => {
    if (ws.readyState === WebSocket.CONNECTING) {
      sendJson(client, { message_type: 'gateway_error', error: 'ElevenLabs Realtime Translation did not respond in time' });
      ws.terminate();
    }
  }, UPSTREAM_CONNECT_TIMEOUT_MS);

  ws.on('unexpected-response', (_request, response) => {
    clearTimeout(connectTimeout);
    let body = '';
    response.on('data', (chunk) => { if (body.length < 2000) body += chunk.toString(); });
    response.on('end', () => {
      let detail = body;
      try {
        const parsed = JSON.parse(body);
        detail = parsed?.detail?.message || parsed?.detail?.status || parsed?.detail || parsed?.error || body;
      } catch { /* keep raw body */ }
      const hint = response.statusCode === 401 || response.statusCode === 403
        ? ' — Realtime Translation is currently limited to ElevenLabs enterprise workspaces.'
        : '';
      sendJson(client, {
        message_type: 'gateway_error',
        error: `ElevenLabs rejected the connection (${response.statusCode})${detail ? `: ${`${typeof detail === 'string' ? detail : JSON.stringify(detail)}`.slice(0, 300)}` : ''}${hint}`
      });
      if (client.readyState === WebSocket.OPEN) client.close(1011, 'upstream-rejected');
      try { ws.terminate(); } catch { /* ignore */ }
    });
  });

  ws.on('open', () => {
    clearTimeout(connectTimeout);
    sendJson(client, { message_type: 'gateway_ready' });
    while (pending.length && ws.readyState === WebSocket.OPEN) ws.send(pending.shift());
  });

  ws.on('message', (data, isBinary) => {
    if (client.readyState !== WebSocket.OPEN) return;
    const text = isBinary ? null : data.toString();
    if (text === null) return; // the API only speaks JSON text frames
    if (text.includes('"message_type":"audio"') || text.includes('"message_type": "audio"')) audioOut += 1;
    client.send(text);
  });

  ws.on('error', (error) => {
    console.error('[translation-gateway] upstream error', error?.message || error);
  });

  ws.on('close', (code, reason) => {
    clearTimeout(connectTimeout);
    if (client.readyState === WebSocket.OPEN) client.close(safeCloseCode(code), safeReason(reason?.toString()));
  });
});

export default server;
