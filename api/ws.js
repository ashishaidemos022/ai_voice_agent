import express from 'express';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const ELEVENLABS_RELAY_URL = process.env.ELEVENLABS_RELAY_URL ||
  'https://mnrseaapxpofdznnqrsv.supabase.co/functions/v1/elevenlabs-speech';
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
  let isBusy = false;

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

    if (message?.type === 'cancel') return;
    if (message?.type !== 'speak') {
      sendJson(client, { type: 'error', error: 'unsupported-message-type' });
      return;
    }

    const text = `${message.text || ''}`.trim();
    if (!text || isBusy) return;
    isBusy = true;
    try {
      const response = await callRelay({
        action: 'speak',
        relay_token: relayToken,
        agent_id: context.agentId,
        session_id: context.sessionId,
        origin: context.origin,
        text
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `ElevenLabs relay failed (${response.status})`);
      }

      const pcm = Buffer.from(await response.arrayBuffer());
      for (let offset = 0; offset < pcm.length; offset += 8192) {
        sendJson(client, {
          type: 'audio.delta',
          delta: pcm.subarray(offset, offset + 8192).toString('base64')
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
});

export default server;
