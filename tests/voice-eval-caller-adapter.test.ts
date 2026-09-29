import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function loadClient() {
  const built = await build({
    entryPoints: ['src/lib/realtime-client.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'browser-boundaries', setup(builder) {
      builder.onResolve({ filter: /(?:tools-registry|audio-manager|benchmark-instrumentation|benchmark-audio-store|synthetic-input)$/ }, (args) => ({ path: args.path, namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const getToolSchemas=()=>[]; export const getAudioManager=()=>({}); export const beginBenchmarkTurn=()=>{}; export const emitBenchmarkEvent=()=>{}; export const emitBenchmarkMilestone=()=>{}; export const getBenchmarkTrace=()=>null; export const recordBenchmarkWaveform=()=>{}; export const saveBenchmarkOutputAudio=async()=>{}; export const startPcmPump=(...args)=>globalThis.syntheticPumpStart(...args);' }));
    } }]
  });
  (globalThis as any).window = { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) };
  const { RealtimeAPIClient } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  return RealtimeAPIClient;
}

test('WebRTC: attach replaces the audio sender track for the call and detach restores the mic', async () => {
  const RealtimeAPIClient = await loadClient();
  const client = new RealtimeAPIClient({ model: 'test', instructions: 'x', voice: 'marin' }, { webrtc: { sessionUrl: 'https://test.invalid' } });
  const mic = { kind: 'audio', id: 'mic' };
  const synthetic = { kind: 'audio', id: 'synthetic' };
  const sender = { track: mic as any, replaceTrack: async (t: any) => { sender.track = t; } };
  client.peerConnection = { getSenders: () => [sender] };
  client.mediaStream = { getAudioTracks: () => [mic], getTracks: () => [mic] };

  await client.attachSyntheticInput(synthetic);
  assert.equal(sender.track, synthetic);
  await assert.rejects(client.attachSyntheticInput(synthetic), /already attached/);
  await client.detachSyntheticInput();
  assert.equal(sender.track, mic);
  await client.detachSyntheticInput();

  const bare = new RealtimeAPIClient({ model: 'test', instructions: 'x', voice: 'marin' }, { webrtc: { sessionUrl: 'https://test.invalid' } });
  bare.peerConnection = { getSenders: () => [] };
  await assert.rejects(bare.attachSyntheticInput(synthetic), /No audio sender/);
});

test('WebSocket: attach pumps synthetic frames and gates real-mic frames until detach', async () => {
  const RealtimeAPIClient = await loadClient();
  const pump: { onFrame?: (pcm: Int16Array) => void; stopped: boolean } = { stopped: false };
  (globalThis as any).syntheticPumpStart = async (_track: unknown, onFrame: (pcm: Int16Array) => void) => {
    pump.onFrame = onFrame;
    return () => { pump.stopped = true; };
  };
  const client = new RealtimeAPIClient({ model: 'test', instructions: 'x', voice: 'marin' }, { apiKey: 'k' });
  const sent: any[] = [];
  client.ws = { readyState: WebSocket.OPEN, send: (text: string) => sent.push(JSON.parse(text)) };

  await client.attachSyntheticInput({ kind: 'audio' });
  client.sendAudio(new Int16Array(2400));
  assert.equal(sent.length, 0, 'real mic frames are ignored while synthetic input is attached');
  pump.onFrame?.(new Int16Array(2400));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'input_audio_buffer.append');

  await client.detachSyntheticInput();
  assert.equal(pump.stopped, true);
  client.sendAudio(new Int16Array(2400));
  assert.equal(sent.length, 2);
});
