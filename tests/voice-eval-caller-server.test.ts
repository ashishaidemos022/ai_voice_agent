import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCallerRequest, type CallerDeps, type CallerRun } from '../shared/voice-eval/caller/server.ts';

const RUN_ID = '11111111-2222-3333-4444-555555555555';

function deps(overrides: Partial<CallerDeps> = {}, run: CallerRun | null = { id: RUN_ID, scenario_id: 'hc-06', status: 'running', agent_config_id: null }) {
  const calls = { brain: [] as { instructions: string; input: string }[], tts: [] as { voiceId: string; text: string }[] };
  const base: CallerDeps = {
    loadRun: async () => run,
    resolveElevenLabsKey: async () => 'el-key',
    brain: async (request) => { calls.brain.push(request); return '{"action":"say","text":"Hi, I need to book."}'; },
    tts: async (_key, voiceId, text) => { calls.tts.push({ voiceId, text }); return new Uint8Array([1, 2, 3, 4]); }
  };
  return { deps: { ...base, ...overrides }, calls };
}

test('rejects missing runs, closed runs and unknown actions', async () => {
  assert.equal((await handleCallerRequest(deps({}, null).deps, 'owner', { action: 'render', run_id: RUN_ID })).status, 404);
  const closed = deps({}, { id: RUN_ID, scenario_id: 'hc-06', status: 'scoring', agent_config_id: null });
  assert.equal((await handleCallerRequest(closed.deps, 'owner', { action: 'render', run_id: RUN_ID })).status, 409);
  assert.equal((await handleCallerRequest(deps().deps, 'owner', { action: 'render', run_id: 'nope' })).status, 404);
  assert.equal((await handleCallerRequest(deps().deps, 'owner', { action: 'sing', run_id: RUN_ID })).status, 400);
});

test('render voices every beat line with the persona voice', async () => {
  const { deps: d, calls } = deps();
  const response = await handleCallerRequest(d, 'owner', { action: 'render', run_id: RUN_ID });
  assert.equal(response.status, 200);
  const lines = response.body.lines as { beat_index: number; text: string; audio_b64: string }[];
  assert.equal(lines.length, 1);
  assert.equal(lines[0].beat_index, 0);
  assert.equal(lines[0].text, 'Sorry — can we do the afternoon one instead?');
  assert.deepEqual([...Buffer.from(lines[0].audio_b64, 'base64')], [1, 2, 3, 4]);
  assert.equal(calls.tts[0].voiceId, 'TxGEqnHWrfWFTfGW9XjX');
});

test('render fails clearly without an ElevenLabs key', async () => {
  const response = await handleCallerRequest(deps({ resolveElevenLabsKey: async () => null }).deps, 'owner', { action: 'render', run_id: RUN_ID });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'No ElevenLabs key for the synthetic caller');
});

test('next_turn returns the brain line with audio and hides pending correction facts', async () => {
  const hc05 = { id: RUN_ID, scenario_id: 'hc-05', status: 'running', agent_config_id: null };
  const { deps: d, calls } = deps({}, hc05);
  const response = await handleCallerRequest(d, 'owner', {
    action: 'next_turn', run_id: RUN_ID,
    transcript: [{ role: 'agent', text: 'How can I help?' }, { role: 'robot', text: 'drop me' }, 'junk'],
    beats_fired: []
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.action, 'say');
  assert.equal(response.body.text, 'Hi, I need to book.');
  assert.equal(typeof response.body.audio_b64, 'string');
  assert.doesNotMatch(calls.brain[0].instructions, /preferredDay:/);
  assert.match(calls.brain[0].input, /Agent: How can I help\?/);
  assert.doesNotMatch(calls.brain[0].input, /drop me/);

  await handleCallerRequest(d, 'owner', { action: 'next_turn', run_id: RUN_ID, transcript: [], beats_fired: [0, 'x', 99] });
  assert.match(calls.brain[1].instructions, /preferredDay: Thursday/);
});

test('hang_up with no text skips TTS; brain or TTS failures are 502', async () => {
  const quiet = deps({ brain: async () => '{"action":"hang_up","text":""}' });
  const bye = await handleCallerRequest(quiet.deps, 'owner', { action: 'next_turn', run_id: RUN_ID, transcript: [] });
  assert.deepEqual(bye.body, { action: 'hang_up', text: '', audio_b64: null });
  assert.equal(quiet.calls.tts.length, 0);
  assert.equal((await handleCallerRequest(deps({ brain: async () => 'garbage' }).deps, 'owner', { action: 'next_turn', run_id: RUN_ID })).status, 502);
  assert.equal((await handleCallerRequest(deps({ tts: async () => { throw new Error('quota'); } }).deps, 'owner', { action: 'next_turn', run_id: RUN_ID })).status, 502);
});
