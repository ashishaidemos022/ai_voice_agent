import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';

const GATEWAY_SECRET = 'test-gateway-secret';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

const nextMessage = (ws, predicate = () => true) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), 3000);
  const onMessage = (data) => {
    const message = JSON.parse(data.toString());
    if (!predicate(message)) return;
    clearTimeout(timeout);
    ws.off('message', onMessage);
    resolve(message);
  };
  ws.on('message', onMessage);
});

const waitClose = (ws) => new Promise((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));

async function startHarness(t, { relay, upstream, upstreamStatus } = {}) {
  const upstreamServer = createServer((req, res) => {
    // Simulate an HTTP rejection of the WebSocket upgrade (e.g. non-enterprise workspace).
    res.writeHead(upstreamStatus || 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: { message: 'Realtime translation is not enabled for this workspace' } }));
  });
  const upgrades = [];
  if (!upstreamStatus) {
    const upstreamWss = new WebSocketServer({ server: upstreamServer });
    upstreamWss.on('connection', (ws, req) => {
      upgrades.push({ url: req.url, apiKey: req.headers['xi-api-key'] });
      upstream?.(ws);
    });
  } else {
    upstreamServer.on('upgrade', (req, socket) => {
      socket.end(`HTTP/1.1 ${upstreamStatus} Forbidden\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ detail: { message: 'Realtime translation requires an enterprise workspace' } })}`);
    });
  }
  const upstreamPort = await listen(upstreamServer);
  t.after(() => upstreamServer.close());

  const relayRequests = [];
  const relayServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    relayRequests.push({ body, secret: req.headers['x-viaana-gateway-secret'] });
    const result = relay ? relay(body, upstreamPort) : {
      status: 200,
      json: {
        api_key: 'xi-test-key',
        upstream_url: `ws://127.0.0.1:${upstreamPort}/v1/translation/realtime?target_language=es&voice_id=voice123&input_format=pcm_16000`,
        session_id: 'tr_session_a'
      }
    };
    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.json));
  });
  const relayPort = await listen(relayServer);
  t.after(() => relayServer.close());

  process.env.ELEVENLABS_TRANSLATION_RELAY_URL = `http://127.0.0.1:${relayPort}`;
  process.env.ELEVENLABS_TRANSLATION_GATEWAY_SECRET = GATEWAY_SECRET;
  const { default: gateway } = await import(`../api/translate-ws.js?test=${Date.now()}-${Math.random()}`);
  const gatewayPort = await listen(gateway);
  t.after(() => {
    gateway.closeAllConnections?.();
    gateway.close();
  });

  const connect = (query = 'token=gateway-token', origin = 'https://app.example.test') =>
    new WebSocket(`ws://127.0.0.1:${gatewayPort}/api/translate-ws?${query}`, origin ? { origin } : {});

  return { connect, upgrades, relayRequests };
}

test('proxies audio upstream with the server-side key and relays translation events back', async (t) => {
  const received = [];
  const { connect, upgrades, relayRequests } = await startHarness(t, {
    upstream: (ws) => {
      ws.send(JSON.stringify({ message_type: 'session_started', session_id: 'el_123' }));
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        received.push(message);
        if (message.message_type === 'input_audio_chunk') {
          ws.send(JSON.stringify({ message_type: 'partial_transcript', text: 'Hello' }));
          ws.send(JSON.stringify({ message_type: 'translation', text: 'Hola' }));
          ws.send(JSON.stringify({ message_type: 'audio', data: Buffer.from([1, 0, 2, 0]).toString('base64'), sample_rate: 24000 }));
        }
      });
    }
  });

  const client = connect();
  t.after(() => client.close());
  const ready = nextMessage(client, (message) => message.message_type === 'gateway_ready');
  const startedPromise = nextMessage(client, (message) => message.message_type === 'session_started');
  await ready;
  const started = await startedPromise;
  assert.equal(started.session_id, 'el_123');

  const translationPromise = nextMessage(client, (message) => message.message_type === 'translation');
  const audioPromise = nextMessage(client, (message) => message.message_type === 'audio');
  client.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: 'AAAA', extra: 'dropped' }));
  const translation = await translationPromise;
  assert.equal(translation.text, 'Hola');
  const audio = await audioPromise;
  assert.equal(audio.sample_rate, 24000);

  assert.equal(relayRequests.length, 1);
  assert.equal(relayRequests[0].secret, GATEWAY_SECRET);
  assert.deepEqual(relayRequests[0].body, { action: 'resolve', token: 'gateway-token', origin: 'https://app.example.test' });
  assert.equal(upgrades[0].apiKey, 'xi-test-key');
  assert.match(upgrades[0].url, /^\/v1\/translation\/realtime\?/);
  assert.doesNotMatch(upgrades[0].url, /xi-test-key/);
  assert.deepEqual(received[0], { message_type: 'input_audio_chunk', audio_base_64: 'AAAA' });
});

test('buffers audio sent before the upstream opens and forwards end_of_stream', async (t) => {
  const received = [];
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const { connect } = await startHarness(t, {
    upstream: (ws) => {
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        received.push(message.message_type);
        if (message.message_type === 'end_of_stream') resolveDone();
      });
    }
  });
  const client = connect();
  t.after(() => client.close());
  await new Promise((resolve) => client.once('open', resolve));
  client.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: 'AAAA' }));
  client.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: 'BBBB' }));
  client.send(JSON.stringify({ message_type: 'end_of_stream' }));
  await done;
  assert.deepEqual(received, ['input_audio_chunk', 'input_audio_chunk', 'end_of_stream']);
});

test('rejects unsupported client messages without forwarding them', async (t) => {
  const received = [];
  const { connect } = await startHarness(t, {
    upstream: (ws) => {
      ws.send(JSON.stringify({ message_type: 'session_started', session_id: 'el_1' }));
      ws.on('message', (data) => received.push(JSON.parse(data.toString())));
    }
  });
  const client = connect();
  t.after(() => client.close());
  await nextMessage(client, (message) => message.message_type === 'session_started');
  client.send(JSON.stringify({ message_type: 'config', voice_id: 'other' }));
  const error = await nextMessage(client, (message) => message.message_type === 'gateway_error');
  assert.equal(error.error, 'unsupported-message-type');
  client.send('not json');
  assert.equal((await nextMessage(client, (message) => message.message_type === 'gateway_error')).error, 'invalid-json');
  assert.equal(received.length, 0);
});

test('closes with a policy error when the relay rejects the token', async (t) => {
  const { connect } = await startHarness(t, {
    relay: () => ({ status: 401, json: { error: 'Invalid or expired translation token' } })
  });
  const client = connect();
  const errorPromise = nextMessage(client, (message) => message.message_type === 'gateway_error');
  const closed = waitClose(client);
  assert.match((await errorPromise).error, /expired translation token/);
  assert.equal((await closed).code, 1008);
});

test('surfaces an HTTP rejection from ElevenLabs with an enterprise hint', async (t) => {
  const { connect } = await startHarness(t, { upstreamStatus: 403 });
  const client = connect();
  const errorPromise = nextMessage(client, (message) => message.message_type === 'gateway_error');
  const closed = waitClose(client);
  const error = await errorPromise;
  assert.match(error.error, /rejected the connection \(403\)/);
  assert.match(error.error, /enterprise/);
  assert.equal((await closed).code, 1011);
});

test('refuses connections without a token or origin', async (t) => {
  const { connect } = await startHarness(t);
  for (const ws of [connect(''), connect('token=abc', null)]) {
    const result = await new Promise((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.on('error', () => resolve('error'));
    });
    assert.equal(result, 401);
  }
});

test('mirrors an upstream close to the browser', async (t) => {
  const { connect } = await startHarness(t, {
    upstream: (ws) => {
      ws.send(JSON.stringify({ message_type: 'quota_exceeded', error: 'Out of credits' }));
      setTimeout(() => ws.close(4001, 'quota'), 20);
    }
  });
  const client = connect();
  const error = await nextMessage(client, (message) => message.message_type === 'quota_exceeded');
  assert.equal(error.error, 'Out of credits');
  const closed = await waitClose(client);
  assert.equal(closed.code, 4001);
  assert.equal(closed.reason, 'quota');
});
