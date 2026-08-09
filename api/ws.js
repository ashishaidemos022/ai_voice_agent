import express from 'express';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { WebSocket, WebSocketServer } from 'ws';

const JWT_SECRET = process.env.ELEVENLABS_GATEWAY_JWT_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ELEVENLABS_BASE_URL = process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io';
const ELEVENLABS_UPSTREAM_TIMEOUT_MS = Number(process.env.ELEVENLABS_UPSTREAM_TIMEOUT_MS || 15000);
const ELEVENLABS_EXPRESSIVE_TIMEOUT_MS = Number(process.env.ELEVENLABS_EXPRESSIVE_TIMEOUT_MS || 60000);

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

const app = express();
app.use((_req, res) => {
  const missing = [];
  if (!JWT_SECRET) missing.push('ELEVENLABS_GATEWAY_JWT_SECRET');
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  res.status(missing.length ? 503 : 200).json({
    status: missing.length ? 'not_ready' : 'ready',
    missing
  });
});

const server = createServer(app);

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
  return allowed.some((stored) => stored === '*' || normalizeOrigin(stored) === normalized);
};

const verifyGatewayRequest = (info, done) => {
  if (!JWT_SECRET) {
    console.error('[elevenlabs-gateway] signing secret is not configured');
    done(false, 503, 'Gateway not configured');
    return;
  }

  const url = new URL(info.req.url || '/', `https://${info.req.headers.host || 'localhost'}`);
  const token = url.searchParams.get('token');
  const agentId = url.searchParams.get('agent');
  const sessionId = url.searchParams.get('session');
  if (!token) {
    done(false, 401, 'Missing token');
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (!payload || typeof payload !== 'object' || payload.voice_provider !== 'elevenlabs_tts') {
      throw new Error('Invalid provider');
    }
    if ((payload.agent_id && payload.agent_id !== agentId) ||
        (payload.session_id && payload.session_id !== sessionId)) {
      throw new Error('Token scope mismatch');
    }
    if (!isOriginAllowed(info.origin || info.req.headers.origin, payload.allowed_origins)) {
      throw new Error('Origin not allowed');
    }
    info.req.gatewayPayload = payload;
    done(true);
  } catch (error) {
    console.warn('[elevenlabs-gateway] rejected connection', error?.message || 'invalid token');
    done(false, 401, 'Invalid gateway token');
  }
};

const wss = new WebSocketServer({ server, perMessageDeflate: false, verifyClient: verifyGatewayRequest });

const decodeStoredKey = (value) => {
  if (!value) return '';
  try {
    return Buffer.from(value, 'base64').toString('utf8').trim();
  } catch {
    return '';
  }
};

const buildElevenLabsBase = () => {
  const parsed = new URL(ELEVENLABS_BASE_URL);
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = cleanPath.endsWith('/v1') ? cleanPath.slice(0, -3) || '/' : cleanPath || '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed;
};

const synthesizeElevenLabsPcm = async ({ apiKey, voiceId, modelId, voiceSettings, outputFormat, text, expressiveMode }) => {
  const controller = new AbortController();
  const timeoutMs = expressiveMode || /(^|_)v3$/i.test(`${modelId || ''}`)
    ? ELEVENLABS_EXPRESSIVE_TIMEOUT_MS
    : ELEVENLABS_UPSTREAM_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const base = buildElevenLabsBase();
    const voiceIdEncoded = encodeURIComponent(voiceId);
    const candidatePaths = [
      `/v1/text-to-speech/${voiceIdEncoded}`,
      `/v1/text-to-speech/${voiceIdEncoded}/stream`
    ];
    let lastError = null;

    for (const path of candidatePaths) {
      const url = new URL(path, base);
      url.searchParams.set('output_format', outputFormat || 'pcm_24000');
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/octet-stream'
        },
        body: JSON.stringify({
          text,
          model_id: modelId || 'eleven_multilingual_v2',
          voice_settings: voiceSettings || undefined
        }),
        signal: controller.signal
      });

      if (response.ok) return Buffer.from(await response.arrayBuffer());

      const reason = (await response.text()).slice(0, 300) || response.statusText || 'unknown';
      lastError = new Error(`ElevenLabs request failed: ${response.status} ${reason}`);
      if (response.status !== 404) throw lastError;
    }

    throw lastError || new Error('ElevenLabs request failed');
  } finally {
    clearTimeout(timeout);
  }
};

const sendJson = (client, message) => {
  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
};

wss.on('connection', async (client, req) => {
  const payload = req.gatewayPayload || {};
  let apiKey = '';
  let isBusy = false;

  try {
    if (!supabase) throw new Error('Supabase service credentials are not configured');
    if (!payload.elevenlabs_key_id || !payload.voice_id) throw new Error('Incomplete ElevenLabs token');

    const { data: keyRow, error } = await supabase
      .from('va_provider_keys')
      .select('id, encrypted_key, provider')
      .eq('id', payload.elevenlabs_key_id)
      .single();

    if (error || !keyRow || keyRow.provider !== 'elevenlabs') {
      throw new Error('Unable to resolve ElevenLabs provider key');
    }
    apiKey = decodeStoredKey(keyRow.encrypted_key);
    if (!apiKey) throw new Error('Stored ElevenLabs API key is invalid');
    sendJson(client, { type: 'ready' });
  } catch (error) {
    console.error('[elevenlabs-gateway] initialization failed', error?.message || error);
    client.close(1011, 'elevenlabs-init-failed');
    return;
  }

  client.on('message', async (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      sendJson(client, { type: 'error', error: 'invalid-json' });
      return;
    }

    if (message?.type === 'cancel') return;
    if (message?.type !== 'speak') {
      sendJson(client, { type: 'error', error: 'unsupported-message-type' });
      return;
    }

    const text = `${message.text || ''}`.trim();
    if (!text || isBusy) return;
    isBusy = true;
    try {
      const pcm = await synthesizeElevenLabsPcm({
        apiKey,
        voiceId: payload.voice_id,
        modelId: payload.elevenlabs_model_id,
        voiceSettings: payload.elevenlabs_voice_settings,
        outputFormat: payload.elevenlabs_output_format,
        text,
        expressiveMode: payload.elevenlabs_expressive_mode
      });
      for (let offset = 0; offset < pcm.length; offset += 8192) {
        sendJson(client, { type: 'audio.delta', delta: pcm.subarray(offset, offset + 8192).toString('base64') });
      }
      sendJson(client, { type: 'audio.done' });
    } catch (error) {
      console.error('[elevenlabs-gateway] synthesis failed', error?.message || error);
      sendJson(client, { type: 'error', error: `elevenlabs-synthesis-failed: ${error?.message || 'unknown'}` });
    } finally {
      isBusy = false;
    }
  });
});

export default server;
