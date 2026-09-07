import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('routed adapter respects saved voices and never substitutes for hosted providers', async () => {
  const runtime = globalThis as any;
  const saved = { fixture: runtime.providerFixture, window: runtime.window, AudioContext: runtime.AudioContext };
  const created: any[] = [], tokens: any[] = [];
  class Adapter {
    config: any; options: any; gateway: any; calls: string[] = []; handlers: any = {};
    constructor(config: any, gatewayOrOptions: any, options?: any) { this.config = config; this.options = options || gatewayOrOptions; this.gateway = options ? gatewayOrOptions : null; created.push(this); }
    on(type: string, handler: any) { (this.handlers[type] ||= []).push(handler); }
    async connect() { this.calls.push('connect'); }
    disconnect() { this.calls.push('disconnect'); }
    async startCapture() { this.calls.push('capture'); }
    speakAnswer(text: string) { this.calls.push(`speak:${text}`); }
    interruptSpeech() { this.calls.push('interrupt'); }
  }
  runtime.window = { location: { origin: 'https://workspace.test' } };
  runtime.AudioContext = class { async resume() {} async close() {} };
  runtime.providerFixture = { preset: null, Adapter, tokens };
  const built = await build({ entryPoints: ['src/lib/voice-adapters/routed-adapter.ts'], bundle: true, write: false, platform: 'node', format: 'esm', define: { 'import.meta.env.VITE_SUPABASE_URL': '"https://test.invalid"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"test"' }, plugins: [{ name: 'boundaries', setup(builder) {
    builder.onResolve({ filter: /(?:realtime-client|elevenlabs-adapter|config-service|elevenlabs-gateway|realtime-session|supabase)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents:
      args.path.endsWith('config-service') ? 'export const getConfigPresetById=async()=>globalThis.providerFixture.preset; export const configPresetToRealtimeConfig=p=>p;' :
      args.path.endsWith('realtime-client') ? 'export const RealtimeAPIClient=globalThis.providerFixture.Adapter;' :
      args.path.endsWith('elevenlabs-adapter') ? 'export const ElevenLabsVoiceAdapter=globalThis.providerFixture.Adapter;' :
      args.path.endsWith('elevenlabs-gateway') ? 'export const requestElevenLabsGatewayToken=async p=>{globalThis.providerFixture.tokens.push(p);return {token:"gateway",gateway_ws_url:"wss://gateway.test"}};' :
      args.path.endsWith('realtime-session') ? 'export const requestRealtimeWebSocketSecret=async(...p)=>{globalThis.providerFixture.tokens.push(p);return {token:"xai"}};' :
      'export const supabase={auth:{getSession:async()=>({data:{session:{access_token:"auth"}}})}};'
    }));
  } }] });
  try {
    const { createRoutedVoiceAdapter } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
    runtime.providerFixture.preset = { voice_provider: 'openai_realtime', model: 'gpt-realtime-2.1-mini', voice: 'sage' };
    const openai = await createRoutedVoiceAdapter('agent', 'session');
    assert.equal(created[0].config.voice, 'sage'); assert.equal(created[0].config.model, 'gpt-realtime-2.1-mini');
    assert.match(created[0].options.webrtc.sessionUrl, /routed_session_id=session/); assert.equal(openai.pcmOutput, false);
    runtime.providerFixture.preset = { voice_provider: 'elevenlabs_tts', voice_id: 'customer-selected-voice', voice_provider_key_id: 'key', model: 'gpt-realtime-2.1', voice_provider_config: { model_id: 'eleven_flash_v2_5', voice_settings: { stability: 0.3 }, output_format: 'pcm_24000' } };
    const eleven = await createRoutedVoiceAdapter('agent', 'session');
    assert.equal(created[1].config.voice_id, 'customer-selected-voice');
    assert.equal(created[1].config.voice_provider_config.voice_settings.stability, 0.3);
    assert.equal(tokens[0].routedVoice, true); assert.equal(tokens[0].sessionId, 'session');
    await eleven.adapter.connect(); await eleven.adapter.startCapture(); eleven.adapter.speakAnswer('Saved memory'); eleven.adapter.interruptSpeech(); eleven.adapter.disconnect();
    assert.deepEqual(created[1].calls, ['connect','capture','speak:Saved memory','interrupt','disconnect']);
    runtime.providerFixture.preset = { voice_provider: 'xai_realtime', voice: 'Rex', model: 'grok-voice-latest' };
    const xai = await createRoutedVoiceAdapter('agent', 'session');
    assert.equal(created[2].options.textOnly, true, 'recognition channel cannot produce competing speech');
    assert.equal(created[3].options.provider, 'xai'); assert.equal(created[3].config.voice, 'Rex'); assert.equal(created[3].config.model, 'grok-voice-latest');
    assert.deepEqual(tokens[1], ['agent', undefined, 'session']);
    await xai.adapter.connect(); await xai.adapter.startCapture(); xai.adapter.speakAnswer('Answer'); xai.adapter.disconnect();
    assert.ok(created[2].calls.includes('capture')); assert.ok(!created[3].calls.includes('capture'));
    assert.ok(created[3].calls.includes('speak:Answer')); assert.ok(!created[2].calls.includes('speak:Answer'));
    const count = created.length;
    for (const provider of ['elevenlabs_agent','personaplex']) {
      runtime.providerFixture.preset = { voice_provider: provider };
      await assert.rejects(createRoutedVoiceAdapter('agent','session'), /Use Native voice/);
    }
    assert.equal(created.length, count, 'no provider is silently substituted');
  } finally { runtime.providerFixture = saved.fixture; runtime.window = saved.window; runtime.AudioContext = saved.AudioContext; }
});
