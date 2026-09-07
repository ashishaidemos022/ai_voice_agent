import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: ['src/components/voice/RoutedVoiceControls.tsx'], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', define: {
  'import.meta.env.VITE_SUPABASE_URL': '"https://test.invalid"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"test"'
}, plugins: [{ name: 'voice-test-boundaries', setup(builder) {
  builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
  builder.onResolve({ filter: /\/supabase$/ }, () => ({ path: 'supabase', namespace: 'mock' }));
  builder.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'icons', namespace: 'mock' }));
  builder.onResolve({ filter: /VoiceAudioUsage$/ }, () => ({ path: 'usage', namespace: 'mock' }));
  builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'icons' ? 'export const Mic = () => null; export const Square = Mic; export const VolumeX = Mic;' : args.path === 'usage' ? 'export const VoiceAudioUsage = () => null;' : 'export const supabase = {auth:{getSession:async()=>({data:{session:{access_token:"test"}}})}};' }));
} }] });
const { RoutedVoiceControls } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const text = node => typeof node === 'string' ? node : (node.children || []).map(text).join('');

test('voice lifecycle prevents stale sends and serializes interrupted questions', async t => {
  const originals = Object.fromEntries(['navigator', 'document', 'MediaRecorder', 'AudioContext', 'Audio', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let renderer;
  let recorders, tracks, captures, submits, drafts, playbacks, fetcher, permission;
  class Recorder {
    static isTypeSupported() { return true; }
    state = 'inactive';
    constructor() { recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['speech'], { type: 'audio/webm' }) }); this.stopped = this.onstop?.(); }
  }
  class Context {
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(samples) { samples.fill(0); } }; }
  }
  class Playback {
    constructor() { playbacks.push(this); }
    play() { return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const props = () => ({ agentId: 'agent', sessionId: 'session', busy: false, messages: [], onCaptureState: captureState, onTranscript: draft, onSubmit: submit });
  const captureState = value => captures.push(value), draft = value => drafts.push(value), submit = value => submits.push(value);
  async function setup(overrides = {}) {
    recorders = []; tracks = []; captures = []; submits = []; drafts = []; playbacks = [];
    permission = null; fetcher = async () => Response.json({ text: 'Remember my budget is $600.' });
    const document = new EventTarget(); document.hidden = false;
    Object.defineProperties(globalThis, {
      document: { configurable: true, value: document },
      navigator: { configurable: true, value: { mediaDevices: { getUserMedia: () => {
        const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track);
        const stream = { getTracks: () => [track] };
        return permission ? permission.promise.then(() => stream) : Promise.resolve(stream);
      } } } },
      MediaRecorder: { configurable: true, value: Recorder }, AudioContext: { configurable: true, value: Context },
      Audio: { configurable: true, value: Playback }, fetch: { configurable: true, value: (...args) => fetcher(...args) }
    });
    await act(async () => { renderer = TestRenderer.create(React.createElement(RoutedVoiceControls, { ...props(), ...overrides })); });
  }
  async function click(label) {
    const button = renderer.root.findAllByType('button').find(node => text(node).includes(label));
    assert.ok(button, `Missing button ${label}`);
    assert.ok(!button.props.disabled, `${label} is disabled`);
    await act(async () => { button.props.onClick(); });
  }
  async function cleanup() { if (renderer) await act(async () => { renderer.unmount(); renderer = null; }); }
  try {
    await t.test('late microphone permission is released after cancellation', async () => {
      await setup(); permission = deferred();
      await click('Record question'); await click('Cancel recording');
      await act(async () => { permission.resolve(); });
      assert.equal(tracks[0].stopped, true); assert.equal(recorders.length, 0); assert.deepEqual(submits, []);
      await cleanup();
    });
    await t.test('canceled transcription never submits to a replacement session', async () => {
      await setup(); const response = deferred(); fetcher = () => response.promise;
      await click('Start conversation'); await click('Finish question');
      await act(async () => { renderer.update(React.createElement(RoutedVoiceControls, { ...props(), sessionId: 'replacement' })); });
      await act(async () => { response.resolve(Response.json({ text: 'stale answer' })); await recorders[0].stopped; });
      assert.deepEqual(submits, []); assert.deepEqual(drafts, []); assert.equal(tracks[0].stopped, true);
      await cleanup();
    });
    await t.test('a question captured during reasoning is queued and submitted exactly once', async () => {
      await setup({ busy: true }); await click('Start conversation'); await click('Finish question');
      await act(async () => { await recorders[0].stopped; });
      assert.deepEqual(submits, []); assert.match(text(renderer.root), /Next question/);
      await act(async () => { renderer.update(React.createElement(RoutedVoiceControls, props())); });
      assert.deepEqual(submits, ['Remember my budget is $600.']);
      await act(async () => { renderer.update(React.createElement(RoutedVoiceControls, props())); });
      assert.equal(submits.length, 1); assert.equal(tracks[0].stopped, true);
      await cleanup();
    });
    await t.test('discarding a queued question prevents later submission', async () => {
      await setup({ busy: true }); await click('Start conversation'); await click('Finish question');
      await act(async () => { await recorders[0].stopped; }); await click('Discard');
      await act(async () => { renderer.update(React.createElement(RoutedVoiceControls, props())); });
      assert.deepEqual(submits, []); await cleanup();
    });
    await t.test('hiding the page and unmounting release microphone tracks', async () => {
      await setup(); await click('Start conversation');
      await act(async () => { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
      assert.equal(tracks[0].stopped, true); assert.equal(captures.at(-1), false);
      await cleanup();
    });
    await t.test('continuous conversation resumes recording only after playback ends', async () => {
      await setup(); await click('Start conversation'); await click('Finish question');
      await act(async () => { await recorders[0].stopped; });
      assert.equal(submits.length, 1);
      fetcher = async () => new Response('audio');
      const message = { id: 'spoken', sender: 'assistant', content: 'Budget saved.', raw: { sources: { turnId: 'turn' } } };
      await act(async () => { renderer.update(React.createElement(RoutedVoiceControls, { ...props(), messages: [message] })); });
      assert.equal(playbacks.length, 1); assert.equal(recorders.length, 1);
      await act(async () => { playbacks[0].onended(); });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
      assert.equal(recorders.length, 2); assert.equal(recorders[1].state, 'recording');
      await cleanup(); assert.ok(tracks.every(track => track.stopped));
    });
    await t.test('stopping a long spoken answer prevents later segments', async () => {
      await setup(); let requests = 0; fetcher = async () => { requests++; return new Response('audio'); };
      const message = { id: 'long', sender: 'assistant', content: 'A long sentence. '.repeat(500), raw: { sources: { turnId: 'turn' } } };
      await act(async () => { renderer.update(React.createElement(RoutedVoiceControls, { ...props(), messages: [message] })); });
      assert.equal(requests, 1); await click('Stop audio');
      assert.equal(playbacks[0].paused, true); assert.equal(requests, 1);
      await cleanup();
    });
    await t.test('interrupting pending speech suppresses late playback', async () => {
      await setup(); const response = deferred(); fetcher = () => response.promise;
      const message = { id: 'answer', sender: 'assistant', content: 'Hello', raw: { sources: { turnId: 'turn' } } };
      await act(async () => { renderer.update(React.createElement(RoutedVoiceControls, { ...props(), messages: [message] })); });
      await click('Interrupt & speak');
      await act(async () => { response.resolve(new Response('audio')); });
      assert.equal(playbacks.length, 0); assert.equal(recorders.length, 1);
      await cleanup(); assert.equal(tracks[0].stopped, true);
    });
  } finally {
    await cleanup();
    for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
