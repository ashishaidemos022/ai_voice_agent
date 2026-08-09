import express from 'express';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const ELEVENLABS_RELAY_URL = process.env.ELEVENLABS_RELAY_URL ||
  'https://mnrseaapxpofdznnqrsv.supabase.co/functions/v1/elevenlabs-speech';
const ELEVENLABS_WS_BASE_URL = process.env.ELEVENLABS_WS_BASE_URL || 'wss://api.elevenlabs.io';
const RELAY_TIMEOUT_MS = Number(process.env.ELEVENLABS_RELAY_TIMEOUT_MS || 65000);

const app = express();
app.use((_req, res) => {
  res.status(200).json({ status: 'ready', relay: 'supabase' });
});

const server = createServer(app);

const wss = new WebSocketServer({
  server,
  perMessageDeflate: false,
  verifyClient(info, done) {
    const url = new URL(info.req.url || '/', `https://${info.req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');
    const agentId = url.searchParams.get('agent');
    const sessionId = url.searchParams.get('session');
    const origin = info.origin || info.req.headers.origin || '';

    if (!token || !agentId || !sessionId || !origin) {
      done(false, 401, 'Incomplete gateway request');
      return;
    }

    info.req.gatewayContext = { token, agentId, sessionId, origin };
    done(true);
  }
});

const sendJson = (client, message) => {
  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
};

const callRelay = async (body) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);
  try {
    return await fetch(ELEVENLABS_RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
};

wss.on('connection', async (client, req) => {
  const context = req.gatewayContext || {};
  let relayToken = '';
  let transport = 'http';
  let upstream = null;
  let upstreamGeneration = 0;
  let keepaliveTimer = null;
  const pendingMessages = [];
  let legacyTextBuffer = '';
  let isBusy = false;

  const closeUpstream = () => {
    upstreamGeneration += 1;
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    keepaliveTimer = null;
    if (upstream) {
      try { upstream.close(); } catch { /* ignore */ }
    }
    upstream = null;
  };

  const connectUpstream = async (config) => {
    if (!config?.tts_websocket_token || !config?.voice_id) {
      throw new Error('Incomplete ElevenLabs WebSocket session');
    }

    closeUpstream();
    const generation = upstreamGeneration;
    const url = new URL(
      `/v1/text-to-speech/${encodeURIComponent(config.voice_id)}/stream-input`,
      ELEVENLABS_WS_BASE_URL
    );
    url.searchParams.set('single_use_token', config.tts_websocket_token);
    url.searchParams.set('model_id', config.model_id || 'eleven_flash_v2_5');
    url.searchParams.set('output_format', config.output_format || 'pcm_24000');

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      upstream = ws;
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.close();
        reject(new Error('ElevenLabs upstream WebSocket timed out'));
      }, 10000);

      ws.on('open', () => {
        if (generation !== upstreamGeneration) return;
        ws.send(JSON.stringify({
          text: ' ',
          voice_settings: config.voice_settings || {
            stability: 0.5,
            similarity_boost: 0.75,
            use_speaker_boost: false
          },
          generation_config: { chunk_length_schedule: [50, 120, 160, 290] }
        }));
        settled = true;
        clearTimeout(timeout);
        resolve();
      });

      ws.on('message', (data) => {
        if (generation !== upstreamGeneration) return;
        try {
          const message = JSON.parse(data.toString());
          if (message.audio) {
            sendJson(client, { type: 'audio.delta', delta: message.audio });
          }
          if (message.is_final || message.isFinal) {
            sendJson(client, { type: 'audio.done' });
          }
          if (message.error) {
            sendJson(client, { type: 'error', error: `elevenlabs-upstream: ${message.error}` });
          }
        } catch {
          sendJson(client, { type: 'error', error: 'invalid-elevenlabs-response' });
        }
      });

      ws.on('error', (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        if (generation === upstreamGeneration && client.readyState === WebSocket.OPEN) {
          upstream = null;
        }
      });
    });

    while (pendingMessages.length && upstream?.readyState === WebSocket.OPEN) {
      upstream.send(JSON.stringify(pendingMessages.shift()));
    }
    keepaliveTimer = setInterval(() => {
      if (upstream?.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ text: ' ' }));
    }, 15000);
  };

  const refreshUpstream = async () => {
    const response = await callRelay({
      action: 'tts-token',
      relay_token: relayToken,
      agent_id: context.agentId,
      session_id: context.sessionId,
      origin: context.origin
    });
    const config = await response.json().catch(() => ({}));
    if (!response.ok || config.transport !== 'websocket') {
      throw new Error(config.error || `ElevenLabs token refresh failed (${response.status})`);
    }
    await connectUpstream(config);
  };

  try {
    const validationResponse = await callRelay({
      action: 'validate',
      token: context.token,
      agent_id: context.agentId,
      session_id: context.sessionId,
      origin: context.origin
    });
    const validation = await validationResponse.json().catch(() => ({}));
    if (!validationResponse.ok || !validation.relay_token) {
      throw new Error(validation.error || `Relay validation failed (${validationResponse.status})`);
    }
    relayToken = validation.relay_token;
    transport = validation.transport || 'http';
    if (transport === 'websocket') await connectUpstream(validation);
    sendJson(client, { type: 'ready' });
  } catch (error) {
    console.error('[elevenlabs-gateway] initialization failed', error?.message || error);
    client.close(1008, 'elevenlabs-auth-failed');
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

    if (message?.type === 'cancel') {
      pendingMessages.length = 0;
      legacyTextBuffer = '';
      if (transport === 'websocket') {
        closeUpstream();
        refreshUpstream().catch((error) => {
          console.error('[elevenlabs-gateway] upstream restart failed', error?.message || error);
          sendJson(client, { type: 'error', error: 'elevenlabs-upstream-restart-failed' });
        });
      }
      return;
    }
    if (message?.type !== 'speak') {
      sendJson(client, { type: 'error', error: 'unsupported-message-type' });
      return;
    }

    const text = `${message.text || ''}`;
    if (transport === 'websocket') {
      if (!text && !message.flush) return;
      const upstreamMessage = { text: text || ' ', ...(message.flush ? { flush: true } : {}) };
      if (upstream?.readyState === WebSocket.OPEN) upstream.send(JSON.stringify(upstreamMessage));
      else pendingMessages.push(upstreamMessage);
      return;
    }

    legacyTextBuffer += text;
    if (!message.flush) return;
    const normalizedText = legacyTextBuffer.trim();
    legacyTextBuffer = '';
    if (!normalizedText || isBusy) return;
    isBusy = true;
    try {
      const response = await callRelay({
        action: 'speak',
        relay_token: relayToken,
        agent_id: context.agentId,
        session_id: context.sessionId,
        origin: context.origin,
        text: normalizedText
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `ElevenLabs relay failed (${response.status})`);
      }

      if (!response.body) throw new Error('ElevenLabs relay returned no audio stream');
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        sendJson(client, {
          type: 'audio.delta',
          delta: Buffer.from(value).toString('base64')
        });
      }
      sendJson(client, { type: 'audio.done' });
    } catch (error) {
      console.error('[elevenlabs-gateway] synthesis failed', error?.message || error);
      sendJson(client, {
        type: 'error',
        error: `elevenlabs-synthesis-failed: ${error?.message || 'unknown'}`
      });
    } finally {
      isBusy = false;
    }
  });

  client.on('close', closeUpstream);
});

export default server;
