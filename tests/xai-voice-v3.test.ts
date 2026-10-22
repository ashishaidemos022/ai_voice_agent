import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { XAI_VOICES, XAI_VOICE_MODELS, normalizeXAIVoice, normalizeXAIVoiceModel } from '../shared/xai-voice-models.ts';

test('Grok Voice 3.0 catalog and legacy saved selections', () => {
  assert.equal(XAI_VOICE_MODELS.flagship, 'grok-voice-3.0');
  assert.equal(XAI_VOICES.length, 28);
  assert.equal(new Set(XAI_VOICES.map((voice) => voice.value)).size, 28);
  for (const id of ['iris', 'celeste', 'aurora', 'carina', 'naksh', 'rigel', 'eve']) assert.ok(XAI_VOICES.some((voice) => voice.value === id));
  assert.equal(normalizeXAIVoice('Rex'), 'rex');
  assert.equal(normalizeXAIVoice(' Iris '), 'iris');
  assert.equal(normalizeXAIVoice('custom-MixedCase-ID'), 'custom-MixedCase-ID');
  assert.equal(normalizeXAIVoice(null), 'eve');
  for (const retired of ['grok-voice-2.0', 'grok-voice-think-fast-2.0', 'grok-voice-think-fast-1.0']) assert.equal(normalizeXAIVoiceModel(retired), 'grok-voice-3.0');
  assert.equal(normalizeXAIVoiceModel('grok-voice-latest'), 'grok-voice-latest');
  assert.equal(normalizeXAIVoiceModel(null), 'grok-voice-latest');
});

test('native and routed sessions send the selected Grok V3 model and voice to xAI', async (t) => {
  t.mock.method(console, 'log', () => {});
  const runtime = globalThis as any;
  const original = { WebSocket: runtime.WebSocket, window: runtime.window };
  const sockets: any[] = [];
  class Socket {
    static OPEN = 1; static CONNECTING = 0;
    readyState = 1; sent: any[] = []; url: string; protocols: string[];
    onopen?: () => void;
    constructor(url: string, protocols: string[]) {
      this.url = url; this.protocols = protocols; sockets.push(this);
      queueMicrotask(() => this.onopen?.());
    }
    send(payload: string) { this.sent.push(JSON.parse(payload)); }
    close() { this.readyState = 3; }
  }
  runtime.WebSocket = Socket;
  runtime.window = { setTimeout, clearTimeout, setInterval, clearInterval };
  try {
    const bundle = await build({ entryPoints: ['src/lib/realtime-client.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'browser-boundaries', setup(builder) {
      builder.onResolve({ filter: /(?:tools-registry|audio-manager|benchmark-instrumentation|benchmark-audio-store)$/ }, args => ({ path: args.path, namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const getToolSchemas=()=>[{type:"function",name:"lookup_account",parameters:{type:"object",properties:{}}}]; export const getAudioManager=()=>({}); export const beginBenchmarkTurn=()=>{}; export const emitBenchmarkEvent=()=>{}; export const emitBenchmarkMilestone=()=>{}; export const getBenchmarkTrace=()=>null; export const recordBenchmarkWaveform=()=>{}; export const saveBenchmarkOutputAudio=async()=>{};' }));
    } }] });
    const { RealtimeAPIClient } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    for (const routed of [false, true]) for (const voice of ['iris', 'celeste', 'aurora', 'carina', 'Rex']) {
      const client = new RealtimeAPIClient({ model: 'grok-voice-3.0', voice, instructions: 'Help with account lookup.', voice_provider_config: { reasoning_effort: 'none', xai_language: 'es-MX' } }, { apiKey: 'ephemeral-test', provider: 'xai', routedVoice: routed });
      await client.connect();
      const socket = sockets.at(-1);
      assert.equal(socket.url, 'wss://api.x.ai/v1/realtime?model=grok-voice-3.0');
      assert.deepEqual(socket.protocols, ['xai-client-secret.ephemeral-test']);
      const session = socket.sent[0].session;
      assert.equal(session.voice, voice.toLowerCase());
      assert.equal(session.audio.output.format.rate, 24000);
      if (routed) {
        assert.equal(session.turn_detection, null); assert.equal(session.tools.length, 0);
      } else {
        assert.equal(session.reasoning.effort, 'none');
        assert.equal(session.audio.input.transcription.language_hint, 'es-MX');
        assert.equal(session.tools[0].name, 'lookup_account');
      }
      client.disconnect();
    }
    const legacy = new RealtimeAPIClient({ model: 'grok-voice-think-fast-2.0', voice: 'iris', instructions: 'Hello' }, { apiKey: 'ephemeral-test', provider: 'xai' });
    await legacy.connect();
    assert.equal(sockets.at(-1).url, 'wss://api.x.ai/v1/realtime?model=grok-voice-3.0');
    legacy.updateSessionConfig({ model: 'grok-voice-latest', voice: 'iris', instructions: 'Hello' });
    assert.equal(sockets.at(-1).sent.at(-1).session.voice, 'iris');
    legacy.disconnect();
  } finally { runtime.WebSocket = original.WebSocket; runtime.window = original.window; }
});
