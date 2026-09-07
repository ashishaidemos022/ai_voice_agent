import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { LiveVoiceCoordinator } from '../src/lib/live-voice-coordinator.ts';
import { liveVoiceSession } from '../shared/live-voice.ts';

function coordinator() {
  const sent: string[] = [], spoken: string[] = [], queued: string[] = []; let interrupted = 0;
  const flow = new LiveVoiceCoordinator({ submit: text => sent.push(text), speak: text => spoken.push(text), queued: text => queued.push(text), interrupt: () => interrupted++ });
  return { flow, sent, spoken, queued, interrupts: () => interrupted };
}

test('live speech submits automatically and duplicate transcript events send once', () => {
  const { flow, sent, spoken } = coordinator();
  flow.speechStarted(); flow.transcript('My budget?', 'one'); flow.transcript('My budget?', 'one');
  assert.deepEqual(sent, ['My budget?']);
  flow.sync(true); flow.sync(false, { id: 'answer', content: '$600.' });
  assert.deepEqual(spoken, ['$600.']);
  flow.sync(false, { id: 'answer', content: '$600.' }); assert.equal(spoken.length, 1);
});

test('barge-in suppresses stale speech and serializes new questions behind running tools', () => {
  const { flow, sent, spoken, interrupts } = coordinator();
  flow.speechStarted(); flow.transcript('First question', 'one'); flow.sync(true);
  flow.speechStarted(); flow.transcript('Actually, compare the shoes', 'two');
  assert.deepEqual(sent, ['First question']);
  flow.sync(false, { id: 'old', content: 'Obsolete answer' });
  assert.deepEqual(spoken, []); assert.equal(interrupts(), 2);
  assert.deepEqual(sent, ['First question', 'Actually, compare the shoes']);
  flow.sync(true); flow.sync(false, { id: 'new', content: 'Comparison' });
  assert.deepEqual(spoken, ['Comparison']);
});

test('an answer cannot begin speaking during an unfinished utterance or after disconnect', () => {
  const { flow, sent, spoken } = coordinator();
  flow.speechStarted(); flow.transcript('First', 'one'); flow.sync(true);
  flow.speechStarted(); flow.sync(false, { id: 'old', content: 'stale' });
  assert.deepEqual(spoken, []);
  flow.close(); flow.transcript('late transcription', 'two'); flow.sync(false, { id: 'later', content: 'late answer' });
  assert.deepEqual(sent, ['First']); assert.deepEqual(spoken, []);
});

test('live transport starts with VAD interruption enabled but autonomous answers disabled', () => {
  const session = liveVoiceSession();
  assert.equal(session.audio.input.turn_detection.create_response, false);
  assert.equal(session.audio.input.turn_detection.interrupt_response, true);
  assert.deepEqual(session.tools, []); assert.equal(session.tool_choice, 'none');
  assert.deepEqual(session.output_modalities, ['audio']);
});

test('realtime endpoint isolates routed sessions without changing native session defaults', async () => {
  const runtime = globalThis as any;
  const previous = { Deno: runtime.Deno, db: runtime.liveTestDb, fetch: globalThis.fetch };
  let handler: (request: Request) => Promise<Response>;
  const requests: any[] = [];
  runtime.Deno = { env: { get: (key: string) => ['OPENAI_BASE_URL','XAI_BASE_URL'].includes(key) ? undefined : 'configured' }, serve: (fn: typeof handler) => { handler = fn; } };
  runtime.liveTestDb = { auth: { getUser: async (token: string) => ({ data: { user: token === 'valid' ? { id: 'auth' } : null } }) }, from(table: string) {
    const filters: Record<string,string> = {};
    return { select() { return this; }, eq(key: string, value: string) { filters[key] = value; return this; }, async maybeSingle() {
      if (table === 'va_users') return { data: { id: 'owner' } };
      if (table === 'va_agent_configs') return { data: filters.id === 'agent' && filters.user_id === 'owner' ? { id: 'agent', instructions: 'Original native instructions', voice: 'marin', voice_provider: 'openai_realtime', turn_detection_enabled: true } : null };
      if (table === 'va_chat_sessions') return { data: filters.id === 'owned' && filters.user_id === 'owner' && filters.agent_preset_id === 'agent' ? { id: 'owned', status: 'active', metadata: { channel: 'routed_voice' } } : null };
      throw new Error(`Unexpected table ${table}`);
    } };
  } };
  globalThis.fetch = async (_url, init) => { requests.push(JSON.parse((init!.body as FormData).get('session') as string)); return new Response('answer-sdp'); };
  try {
    const built = await build({ entryPoints: ['supabase/functions/realtime-session/index.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'db', setup(builder) {
      builder.onResolve({ filter: /^npm:/ }, () => ({ path: 'db', namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const createClient = () => globalThis.liveTestDb;' }));
    } }] });
    await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
    const request = (query = '', token = 'valid') => handler!(new Request(`https://test.invalid?agent_id=agent${query}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/sdp' }, body: 'offer-sdp' }));
    assert.equal((await request('&routed_session_id=owned', 'invalid')).status, 401);
    assert.equal((await request('&routed_session_id=foreign')).status, 403);
    assert.equal((await request('&routed_session_id=owned&benchmark_run_id=run')).status, 400);
    assert.equal(requests.length, 0);
    assert.equal((await request('&routed_session_id=owned')).status, 200);
    assert.deepEqual(requests[0], liveVoiceSession({voice:'marin'}));
    assert.equal((await request()).status, 200);
    assert.equal(requests[1].instructions, 'Original native instructions');
    assert.equal(requests[1].audio.output.voice, 'marin');
    assert.equal(requests[1].audio.input.turn_detection.create_response, undefined);
  } finally { runtime.Deno = previous.Deno; runtime.liveTestDb = previous.db; globalThis.fetch = previous.fetch; }
});

test('WebRTC speech clears buffered audio and suppresses responses interrupted before creation', async () => {
  const built = await build({ entryPoints: ['src/lib/realtime-client.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'browser-boundaries', setup(builder) {
    builder.onResolve({ filter: /(?:tools-registry|audio-manager|benchmark-instrumentation|benchmark-audio-store)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const getToolSchemas=()=>[]; export const getAudioManager=()=>({}); export const beginBenchmarkTurn=()=>{}; export const emitBenchmarkEvent=()=>{}; export const emitBenchmarkMilestone=()=>{}; export const getBenchmarkTrace=()=>null; export const recordBenchmarkWaveform=()=>{}; export const saveBenchmarkOutputAudio=async()=>{};' }));
  } }] });
  const { RealtimeAPIClient } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  const sent: any[] = [];
  const client = new RealtimeAPIClient({ model: 'test', instructions: 'native', voice: 'marin' }, { routedVoice: true, webrtc: { sessionUrl: 'https://test.invalid' } });
  client.dataChannel = { readyState: 'open', send: (text: string) => sent.push(JSON.parse(text)) };
  client.remoteAudio = { muted: false };
  client.sendSessionUpdate();
  assert.deepEqual(sent[0].session, liveVoiceSession({voice:'marin'}));
  client.interruptSpeech();
  assert.equal(sent.length, 1, 'no clear/cancel is sent for an empty output buffer');
  client.speakAnswer('First answer');
  assert.equal(sent.at(-1).response.conversation, 'none');
  assert.equal(client.remoteAudio.muted, false);
  client.interruptSpeech();
  assert.equal(client.remoteAudio.muted, true);
  client.handleServerMessage({ type: 'response.created', response: { id: 'old' } });
  assert.ok(sent.some(event => event.type === 'response.cancel'));
  client.speakAnswer('New answer');
  assert.equal(sent.filter(event => event.type === 'response.create').length, 1, 'waits for old generation to finish');
  client.handleServerMessage({ type: 'response.done', response: { id: 'old', status: 'cancelled' } });
  assert.equal(sent.filter(event => event.type === 'response.create').length, 2);
  assert.equal(client.remoteAudio.muted, false);
  client.handleServerMessage({ type: 'response.created', response: { id: 'new' } });
  client.handleServerMessage({ type: 'output_audio_buffer.started' });
  client.handleServerMessage({ type: 'response.done', response: { id: 'new' } });
  const before = sent.length;
  client.interruptSpeech();
  assert.equal(sent[before].type, 'output_audio_buffer.clear');
  assert.equal(client.remoteAudio.muted, true);
  const xaiSent: any[] = [];
  const xai = new RealtimeAPIClient({ model: 'grok-voice-latest', voice: 'Rex' }, { routedVoice: true, provider: 'xai' });
  xai.dataChannel = { readyState: 'open', send: (text: string) => xaiSent.push(JSON.parse(text)) };
  xai.sendSessionUpdate(); xai.speakAnswer('Saved size is US 10 wide.');
  assert.equal(xaiSent[0].session.voice, 'Rex');
  assert.equal(xaiSent[0].session.turn_detection, null);
  assert.equal(xaiSent[1].item.type, 'force_message');
  assert.equal(xaiSent[1].item.interruptible, true);
  assert.ok(!xaiSent.some(event => event.type === 'response.create'));
});
