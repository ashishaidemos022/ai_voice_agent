import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';

const waitForMessage = (ws, predicate) => new Promise((resolve, reject) => {
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

test('streams OpenAI text through ElevenLabs and forwards audio immediately', async (t) => {
  const upstreamServer = createServer();
  const upstreamWss = new WebSocketServer({ server: upstreamServer });
  await new Promise((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstreamServer.address().port;
  t.after(() => upstreamServer.close());

  const upstreamMessages = [];
  upstreamWss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      upstreamMessages.push(message);
      if (message.flush) {
        ws.send(JSON.stringify({ audio: Buffer.from('pcm').toString('base64'), is_final: false }));
        ws.send(JSON.stringify({ is_final: true }));
      }
    });
  });

  const relayServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(request.action, 'validate');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      relay_token: 'relay-token',
      transport: 'websocket',
      tts_websocket_token: 'single-use-token',
      voice_id: 'voice-id',
      model_id: 'eleven_flash_v2_5',
      output_format: 'pcm_24000',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: false }
    }));
  });
  await new Promise((resolve) => relayServer.listen(0, '127.0.0.1', resolve));
  const relayPort = relayServer.address().port;
  t.after(() => relayServer.close());

  process.env.ELEVENLABS_RELAY_URL = `http://127.0.0.1:${relayPort}`;
  process.env.ELEVENLABS_WS_BASE_URL = `ws://127.0.0.1:${upstreamPort}`;
  const { default: gatewayServer } = await import(`../api/ws.js?test=${Date.now()}`);
  await new Promise((resolve) => gatewayServer.listen(0, '127.0.0.1', resolve));
  const gatewayPort = gatewayServer.address().port;
  t.after(() => gatewayServer.close());

  const client = new WebSocket(
    `ws://127.0.0.1:${gatewayPort}/api/ws?token=gateway-token&agent=agent-id&session=session-id`,
    { origin: 'https://example.test' }
  );
  t.after(() => client.close());

  await waitForMessage(client, (message) => message.type === 'ready');
  const audioPromise = waitForMessage(client, (message) => message.type === 'audio.delta');
  const donePromise = waitForMessage(client, (message) => message.type === 'audio.done');
  client.send(JSON.stringify({ type: 'speak', text: 'Hello ' }));
  client.send(JSON.stringify({ type: 'speak', text: 'world.', flush: true }));

  const [audio, done] = await Promise.all([audioPromise, donePromise]);

  assert.equal(Buffer.from(audio.delta, 'base64').toString(), 'pcm');
  assert.equal(done.type, 'audio.done');
  assert.equal(upstreamMessages[0].text, ' ');
  assert.deepEqual(upstreamMessages[0].generation_config.chunk_length_schedule, [50, 120, 160, 290]);
  assert.equal(upstreamMessages[1].text, 'Hello ');
  assert.equal(upstreamMessages[2].text, 'world.');
  assert.equal(upstreamMessages[2].flush, true);
});
