import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const built = await build({ entryPoints: ['src/components/voice/LiveVoiceControls.tsx'], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', define: { 'import.meta.env.VITE_SUPABASE_URL': '"https://test.invalid"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"test"' }, plugins: [{ name: 'live-boundaries', setup(builder) {
  builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
  builder.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'icons', namespace: 'mock-icons' }));
  builder.onResolve({ filter: /routed-adapter$/ }, args => ({ path: args.path, namespace: 'mock' }));
  builder.onLoad({ filter: /.*/, namespace: 'mock-icons' }, () => ({ contents: 'export const Mic = () => null; export const MicOff = () => null;' }));
  builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const createRoutedVoiceAdapter = async () => ({adapter:new globalThis.LiveTestTransport({}, {routedVoice:true}),label:"Selected provider",pcmOutput:false});' }));
} }] });

test('live controls keep capture active through reasoning and speech and stop on unmount', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const transports = [];
  class Transport {
    handlers = {}; captured = 0; stopped = 0; spoken = []; interrupted = 0; disconnected = false;
    constructor(_config, options) { this.options = options; transports.push(this); }
    on(type, handler) { this.handlers[type] = handler; }
    emit(type, data = {}) { this.handlers[type]?.(data); }
    async connect() {}
    async startCapture() { this.captured++; }
    stopCapture() { this.stopped++; }
    speakAnswer(text) { this.spoken.push(text); }
    interruptSpeech() { this.interrupted++; }
    disconnect() { this.disconnected = true; }
  }
  globalThis.LiveTestTransport = Transport;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: new EventTarget() });
  let renderer;
  try {
    const { LiveVoiceControls } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
    const sent = [];
    const props = { agentId: 'agent', sessionId: 'session', busy: false, messages: [], onSubmit: text => sent.push(text) };
    await act(async () => { renderer = TestRenderer.create(React.createElement(LiveVoiceControls, props)); });
    const transport = transports[0];
    assert.equal(transport.options.routedVoice, true); assert.equal(transport.captured, 1);
    const buttonText = node => typeof node === 'string' ? node : (node.children || []).map(buttonText).join('');
    const click = async label => {
      const button = renderer.root.findAllByType('button').find(node => buttonText(node).includes(label));
      assert.ok(button, `Missing ${label} button`);
      await act(async () => { await button.props.onClick(); });
    };
    await click('Mute');
    assert.equal(transport.stopped, 1); assert.equal(transport.disconnected, false);
    await click('Unmute');
    assert.equal(transport.captured, 2); assert.equal(transport.disconnected, false);
    await act(async () => { transport.emit('speech.started'); transport.emit('transcript.done', { role: 'user', transcript: 'My budget?', itemId: 'one' }); });
    assert.deepEqual(sent, ['My budget?']);
    await act(async () => { renderer.update(React.createElement(LiveVoiceControls, { ...props, busy: true })); });
    const message = { id: 'answer', sender: 'assistant', content: '$600.' };
    await act(async () => { renderer.update(React.createElement(LiveVoiceControls, { ...props, messages: [message] })); });
    assert.deepEqual(transport.spoken, ['$600.']); assert.equal(transport.captured, 2); assert.equal(transport.disconnected, false);
    const before = transport.interrupted;
    await act(async () => { transport.emit('speech.started'); });
    assert.equal(transport.interrupted, before + 1);
    await act(async () => { renderer.unmount(); }); renderer = null;
    assert.equal(transport.disconnected, true);
    transport.emit('transcript.done', { role: 'user', transcript: 'stale', itemId: 'two' });
    assert.deepEqual(sent, ['My budget?']);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document;
    delete globalThis.LiveTestTransport;
  }
});
