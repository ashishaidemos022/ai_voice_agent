import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);

test('Unmute works after reconnect and recovers from a failed or canceled start', async (t) => {
  for (const method of ['log', 'warn', 'error'] as const) t.mock.method(console, method, () => {});
  const runtime = globalThis as any;
  const previous = { fixture: runtime.micFixture, window: runtime.window };
  const clients: any[] = [];
  class Client {
    handlers: any = {}; connected = false; starts = 0; stops = 0;
    start: () => Promise<void> = async () => {};
    constructor() { clients.push(this); }
    on(name: string, fn: any) { (this.handlers[name] ||= []).push(fn); }
    emit(name: string, value = {}) { for (const fn of this.handlers[name] || []) fn(value); }
    isConnected() { return this.connected; }
    async connect() { this.connected = true; this.emit('connected'); }
    disconnect() { this.connected = false; this.emit('disconnected'); }
    async startCapture() { this.starts++; await this.start(); }
    stopCapture() { this.stops++; }
  }
  const audio = { isReady: () => true, close() {}, stopCapture() {}, isCurrentlyInitializing: () => false };
  const query: any = { select: () => query, insert: () => query, update: () => query, eq: () => query, single: async () => ({ data: { id: 'session' }, error: null }), then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve) };
  runtime.micFixture = { Client, audio, user: { id: 'owner' }, db: { from: () => query } };
  runtime.window = Object.assign(new EventTarget(), { location: { origin: 'https://app.test' }, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {} });
  let hook: any, renderer: any;
  try {
    const bundle = await build({ entryPoints: ['src/hooks/useVoiceAgent.ts'], bundle: true, write: false, platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' }, plugins: [{ name: 'hook-boundaries', setup(builder) {
      builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
      builder.onResolve({ filter: /(?:audio-manager|realtime-client|personaplex-adapter|elevenlabs-adapter|elevenlabs-agent-adapter|supabase|signal-bus|tools-registry|rag-service|config-service|AuthContext|usage-tracker|personaplex-gateway|elevenlabs-gateway|elevenlabs-agent|realtime-session|model-route-metrics|a2ui|benchmark-instrumentation|benchmark-audio-store)$/ }, args => ({ path: args.path, namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
        export const getAudioManager=()=>globalThis.micFixture.audio;
        export const RealtimeAPIClient=globalThis.micFixture.Client;
        export const PersonaPlexVoiceAdapter=RealtimeAPIClient, ElevenLabsVoiceAdapter=RealtimeAPIClient, ElevenLabsAgentAdapter=RealtimeAPIClient;
        export const supabase=globalThis.micFixture.db;
        export const useAuth=()=>({vaUser:globalThis.micFixture.user});
        export const getConfigPresetById=async()=>null, configPresetToRealtimeConfig=p=>p;
        export const requestRealtimeWebSocketSecret=async()=>({token:'ephemeral'});
        export const executeTool=async()=>({}), loadMCPTools=async()=>{}, registerAdapterCheckpointTool=()=>{}, registerRagKnowledgeTool=()=>{};
        export const publishVoiceEvalSignal=()=>{}, runRagAugmentation=async()=>({}), normalizeUsage=()=>null, recordUsageEvent=async()=>{};
        export const requestPersonaPlexGatewayToken=async()=>({}), requestElevenLabsGatewayToken=async()=>({}), finalizeElevenLabsAgentUsage=async()=>({}), requestElevenLabsAgentSignedUrl=async()=>'';
        export const estimateInklingSmallCostUsd=()=>0, formatA2UIEventMessage=()=>'';
        export const emitBenchmarkEvent=()=>{}, emitBenchmarkMilestone=()=>{}, getBenchmarkTrace=()=>null, recordBenchmarkWaveform=()=>{}, loadBenchmarkAudio=async()=>null, saveBenchmarkPcm16Output=async()=>{};
      ` }));
    } }] });
    const { useVoiceAgent } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    function Harness() { hook = useVoiceAgent(); return null; }
    await act(async () => { renderer = TestRenderer.create(React.createElement(Harness)); });
    const config = { voice_provider: 'xai_realtime', model: 'grok-voice-3.0', voice: 'iris', instructions: 'Help', temperature: 0.5, max_response_output_tokens: 1024 };
    await act(async () => { await hook.initialize(config, 'agent'); });
    const client = clients[0];
    await act(async () => { hook.toggleRecording(); });
    assert.equal(hook.isRecording, true); assert.equal(client.starts, 1);
    await act(async () => { client.disconnect(); });
    assert.equal(hook.isRecording, false);
    await act(async () => { await client.connect(); });
    await act(async () => { hook.toggleRecording(); });
    assert.equal(hook.isRecording, true); assert.equal(client.starts, 2, 'reconnect must clear the prior mic-started flag');
    await act(async () => { hook.toggleRecording(); });
    client.start = async () => { throw new Error('Microphone permission denied'); };
    await act(async () => { hook.toggleRecording(); });
    assert.equal(hook.isRecording, false); assert.equal(hook.isStartingRecording, false);
    assert.match(hook.error, /Microphone permission denied/);
    let resolveStart!: () => void;
    client.start = () => new Promise(resolve => { resolveStart = resolve; });
    await act(async () => { hook.toggleRecording(); });
    assert.equal(hook.isStartingRecording, true);
    const starts = client.starts;
    await act(async () => { hook.toggleRecording(); });
    assert.equal(client.starts, starts, 'repeated Unmute cannot start a second capture');
    await act(async () => { client.disconnect(); resolveStart(); });
    assert.equal(hook.isRecording, false); assert.equal(hook.isStartingRecording, false);
    client.start = async () => {};
    await act(async () => { await client.connect(); hook.toggleRecording(); });
    assert.equal(hook.isRecording, true, 'retry succeeds after canceled startup');
    await act(async () => { await hook.cleanup(); renderer.unmount(); }); renderer = null;
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    runtime.micFixture = previous.fixture; runtime.window = previous.window;
  }
});

test('Web Audio unmute resumes the context, renders a silent capture graph, and cancels late starts', async (t) => {
  t.mock.method(console, 'log', () => {});
  const runtime = globalThis as any;
  const previous = { window: runtime.window, Worklet: runtime.AudioWorkletNode };
  class Node {
    connections = new Set<any>(); port: any = { onmessage: null }; gain = { value: 1 };
    connect(node: any) { this.connections.add(node); }
    disconnect(node?: any) { if (node) this.connections.delete(node); else this.connections.clear(); }
  }
  runtime.AudioWorkletNode = Node;
  runtime.window = { location: { origin: 'https://app.test' } };
  try {
    const bundle = await build({ entryPoints: ['src/lib/audio-manager.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'metrics', setup(builder) {
      builder.onResolve({ filter: /benchmark-instrumentation$/ }, () => ({ path: 'metrics', namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const emitBenchmarkEvent=()=>{},emitBenchmarkMilestone=()=>{},recordBenchmarkWaveform=()=>{};' }));
    } }] });
    const { AudioManager } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    let resumes = 0;
    const context: any = { state: 'suspended', destination: new Node(), createGain: () => new Node(), audioWorklet: { addModule: async () => {} }, resume: async () => { resumes++; context.state = 'running'; } };
    const manager: any = new AudioManager(); manager.audioContext = context; manager.stream = {}; manager.microphone = new Node();
    const frames: any[] = [];
    await manager.startCapture((frame: any) => frames.push(frame));
    assert.equal(resumes, 1);
    assert.equal(manager.captureSink.gain.value, 0);
    assert.ok(manager.captureSink.connections.has(context.destination));
    const first = manager.workletNode, onmessage = first.port.onmessage;
    onmessage({ data: new Int16Array([123]) }); assert.equal(frames.length, 1);
    manager.stopCapture(); onmessage({ data: new Int16Array([456]) });
    assert.equal(frames.length, 1, 'muted and stale processors cannot submit audio');
    assert.equal(manager.microphone.connections.size, 0);
    await manager.startCapture((frame: any) => frames.push(frame));
    assert.equal(manager.microphone.connections.size, 1);
    manager.stopCapture();
    let resolveModule!: () => void;
    manager.workletReady = false;
    context.audioWorklet.addModule = () => new Promise(resolve => { resolveModule = resolve; });
    const pending = manager.startCapture(() => {});
    manager.stopCapture(); resolveModule(); await pending;
    assert.equal(manager.workletNode, null, 'a stopped capture cannot reopen when module loading finishes');
  } finally { runtime.window = previous.window; runtime.AudioWorkletNode = previous.Worklet; }
});
