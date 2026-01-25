import http from 'http';
import { randomUUID } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.PERSONAPLEX_GATEWAY_JWT_SECRET;
const PERSONAPLEX_WS_URL = process.env.PERSONAPLEX_WS_URL;
const HEALTH_INTERVAL_MS = Number(process.env.PERSONAPLEX_HEALTH_INTERVAL_MS || 60000);
const HEALTH_VOICE_PROMPT = process.env.PERSONAPLEX_HEALTH_VOICE_PROMPT || 'NATF0.pt';
const HEALTH_TEXT_PROMPT = process.env.PERSONAPLEX_HEALTH_TEXT_PROMPT || '';
const UPSTREAM_TIMEOUT_MS = Number(process.env.PERSONAPLEX_UPSTREAM_TIMEOUT_MS || 15000);

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

if (!JWT_SECRET) {
  console.warn('[personaplex-gateway] PERSONAPLEX_GATEWAY_JWT_SECRET is missing');
}
if (!PERSONAPLEX_WS_URL) {
  console.warn('[personaplex-gateway] PERSONAPLEX_WS_URL is missing');
}

const normalizeOrigin = (value) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
  } catch {
    return value;
  }
};

const isOriginAllowed = (origin, allowed) => {
  if (!allowed || allowed.length === 0) return true;
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return allowed.some((stored) => {
    if (stored === '*') return true;
    const normalizedStored = normalizeOrigin(stored);
    if (!normalizedStored) return false;
    if (normalizedStored === normalized) return true;
    try {
      const incomingHost = new URL(normalized).hostname;
      const storedHost = new URL(normalizedStored).hostname;
      return incomingHost === storedHost;
    } catch {
      return normalizedStored === normalized;
    }
  });
};

const buildPersonaPlexUrl = (tokenPayload) => {
  if (!PERSONAPLEX_WS_URL) {
    throw new Error('PERSONAPLEX_WS_URL not configured');
  }
  const url = new URL(PERSONAPLEX_WS_URL);
  const textPrompt = tokenPayload?.text_prompt ?? '';
  const voicePrompt = tokenPayload?.voice_prompt ?? HEALTH_VOICE_PROMPT;
  url.searchParams.set('text_prompt', textPrompt);
  url.searchParams.set('voice_prompt', voicePrompt);
  return url;
};

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: 'Missing URL' }));
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/readyz') {
    const missing = [];
    if (!JWT_SECRET) missing.push('PERSONAPLEX_GATEWAY_JWT_SECRET');
    if (!PERSONAPLEX_WS_URL) missing.push('PERSONAPLEX_WS_URL');
    if (missing.length > 0) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'not_ready', missing }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ready' }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'not_found' }));
});
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const token = url.searchParams.get('token');
  const agent = url.searchParams.get('agent');
  const session = url.searchParams.get('session');

  if (!token || !JWT_SECRET) {
    socket.destroy();
    return;
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    socket.destroy();
    return;
  }

  if (payload?.agent_id && agent && payload.agent_id !== agent) {
    socket.destroy();
    return;
  }
  if (payload?.session_id && session && payload.session_id !== session) {
    socket.destroy();
    return;
  }

  const originHeader = req.headers.origin || req.headers.referer || '';
  if (payload?.allowed_origins && !isOriginAllowed(originHeader, payload.allowed_origins)) {
    socket.destroy();
    return;
  }

  req.gatewayPayload = payload;
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (client, req) => {
  const payload = req.gatewayPayload || {};
  const startTime = Date.now();
  let bytesIn = 0;
  let bytesOut = 0;
  const connectionId = randomUUID();

  console.log(JSON.stringify({
    event: 'gateway_session_start',
    connection_id: connectionId,
    agent_id: payload.agent_id,
    session_id: payload.session_id,
    sub: payload.sub
  }));

  let upstream;
  let upstreamTimeout;
  let upstreamTimedOut = false;
  try {
    const upstreamUrl = buildPersonaPlexUrl(payload);
    upstream = new WebSocket(upstreamUrl.toString(), { perMessageDeflate: false });
    upstream.binaryType = 'arraybuffer';
    upstreamTimeout = setTimeout(() => {
      upstreamTimedOut = true;
      closeAll(1011, 'upstream-timeout');
    }, UPSTREAM_TIMEOUT_MS);
  } catch (err) {
    client.close(1011, 'PersonaPlex URL error');
    return;
  }

  const closeAll = (code, reason) => {
    if (client.readyState === WebSocket.OPEN) {
      client.close(code, reason);
    }
    if (upstream && upstream.readyState === WebSocket.OPEN) {
      upstream.close(code, reason);
    }
  };

  upstream.on('open', () => {
    // Ready to proxy
    if (upstreamTimeout) {
      clearTimeout(upstreamTimeout);
      upstreamTimeout = null;
    }
  });

  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      bytesIn += data.byteLength || data.length || 0;
      const isBinaryPayload = isBinary || Buffer.isBuffer(data) || data instanceof ArrayBuffer || ArrayBuffer.isView(data);
      if (isBinaryPayload) {
        const len = data.byteLength || data.length || 0;
        if (len % 2 !== 0) {
          console.warn('[personaplex-gateway] upstream odd byte length', len);
        }
      }
      client.send(data, { binary: isBinaryPayload });
    }
  });

  upstream.on('close', (code, reason) => {
    if (upstreamTimeout) {
      clearTimeout(upstreamTimeout);
      upstreamTimeout = null;
    }
    closeAll(code, reason?.toString());
  });

  upstream.on('error', () => {
    if (upstreamTimeout) {
      clearTimeout(upstreamTimeout);
      upstreamTimeout = null;
    }
    if (upstreamTimedOut) return;
    closeAll(1011, 'PersonaPlex error');
  });

  client.on('message', (data, isBinary) => {
    if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
    bytesOut += data.byteLength || data.length || 0;
    const isBinaryPayload = isBinary || Buffer.isBuffer(data) || data instanceof ArrayBuffer || ArrayBuffer.isView(data);
    if (isBinaryPayload) {
      const len = data.byteLength || data.length || 0;
      if (len % 2 !== 0) {
        console.warn('[personaplex-gateway] client odd byte length', len);
      }
    }
    upstream.send(data, { binary: isBinaryPayload });
  });

  client.on('close', () => {
    if (upstreamTimeout) {
      clearTimeout(upstreamTimeout);
      upstreamTimeout = null;
    }
    closeAll(1000, 'client-closed');
    const durationMs = Date.now() - startTime;
    console.log(JSON.stringify({
      event: 'gateway_session_end',
      connection_id: connectionId,
      agent_id: payload.agent_id,
      session_id: payload.session_id,
      duration_ms: durationMs,
      bytes_in: bytesIn,
      bytes_out: bytesOut
    }));
  });
});

server.listen(PORT, () => {
  console.log(`[personaplex-gateway] listening on ${PORT}`);
});

const reportHealth = async (status, latencyMs, errorMessage) => {
  if (!supabase) return;
  try {
    const now = new Date().toISOString();
    const { data: existing } = await supabase
      .from('va_voice_provider_health')
      .select('id')
      .eq('provider', 'personaplex')
      .eq('endpoint_url', PERSONAPLEX_WS_URL)
      .maybeSingle();
    if (existing?.id) {
      await supabase
        .from('va_voice_provider_health')
        .update({
          status,
          last_checked_at: now,
          latency_ms: latencyMs,
          error_message: errorMessage || null
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('va_voice_provider_health')
        .insert({
          provider: 'personaplex',
          endpoint_url: PERSONAPLEX_WS_URL,
          status,
          last_checked_at: now,
          latency_ms: latencyMs,
          error_message: errorMessage || null
        });
    }
  } catch (err) {
    console.warn('[personaplex-gateway] failed to report health', err);
  }
};

const checkHealth = async () => {
  if (!PERSONAPLEX_WS_URL) return;
  const start = Date.now();
  const url = new URL(PERSONAPLEX_WS_URL);
  url.searchParams.set('text_prompt', HEALTH_TEXT_PROMPT);
  url.searchParams.set('voice_prompt', HEALTH_VOICE_PROMPT);
  return new Promise((resolve) => {
    const ws = new WebSocket(url.toString());
    let done = false;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      ws.close();
      reportHealth('down', null, 'health-check-timeout');
      resolve();
    }, UPSTREAM_TIMEOUT_MS);

    ws.on('message', (data) => {
      const bytes = new Uint8Array(data);
      if (bytes[0] === 0x00 && !done) {
        done = true;
        clearTimeout(timeout);
        ws.close();
        const latency = Date.now() - start;
        reportHealth('ok', latency, null);
        resolve();
      }
    });

    ws.on('error', () => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      reportHealth('down', null, 'health-check-error');
      resolve();
    });
  });
};

if (PERSONAPLEX_WS_URL && supabase) {
  setInterval(() => {
    checkHealth();
  }, HEALTH_INTERVAL_MS);
}
