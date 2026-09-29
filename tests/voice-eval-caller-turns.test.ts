import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom } from '../shared/voice-eval/caller/random.ts';
import { TurnDetector } from '../shared/voice-eval/caller/turn-detector.ts';

const detector = () => new TurnDetector({ startedAt: 0, gapMs: () => 600 });

test('seededRandom is deterministic per seed and stays in [0, 1)', () => {
  const a = seededRandom('run-1');
  const b = seededRandom('run-1');
  const c = seededRandom('run-2');
  const seqA = [a(), a(), a()];
  assert.deepEqual(seqA, [b(), b(), b()]);
  assert.notDeepEqual(seqA, [c(), c(), c()]);
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
});

test('fires once after the gap when the agent stops speaking', () => {
  const d = detector();
  d.observe({ kind: 'agent_audio_start', at: 1000 });
  assert.equal(d.poll(1500), null);
  d.observe({ kind: 'agent_audio_stop', at: 2000 });
  assert.equal(d.poll(2500), null);
  assert.equal(d.poll(2600), 'agent_turn_ended');
  assert.equal(d.poll(2700), null);
});

test('new agent audio during the gap cancels the turn end', () => {
  const d = detector();
  d.observe({ kind: 'agent_audio_start', at: 1000 });
  d.observe({ kind: 'agent_audio_stop', at: 2000 });
  d.observe({ kind: 'agent_audio_start', at: 2300 });
  assert.equal(d.poll(2700), null);
  d.observe({ kind: 'agent_audio_stop', at: 3000 });
  assert.equal(d.poll(3600), 'agent_turn_ended');
});

test('a tool call in flight blocks the turn end, and the result requires new agent speech', () => {
  const d = detector();
  d.observe({ kind: 'agent_audio_start', at: 1000 });
  d.observe({ kind: 'agent_audio_stop', at: 1500 });
  d.observe({ kind: 'tool_call', at: 1700, callId: 't1', name: 'healthcare_patient_access', args: {} });
  assert.equal(d.poll(3000), null);
  d.observe({ kind: 'tool_result', at: 4000, callId: 't1', ok: true, result: {} });
  assert.equal(d.poll(5000), null, 'the pre-tool "one moment" line is not a finished turn');
  d.observe({ kind: 'agent_audio_start', at: 5200 });
  d.observe({ kind: 'agent_audio_stop', at: 7000 });
  assert.equal(d.poll(7600), 'agent_turn_ended');
});

test('quiet fallback fires 10s after a tool result the agent never speaks about', () => {
  const d = detector();
  d.observe({ kind: 'agent_audio_start', at: 1000 });
  d.observe({ kind: 'agent_audio_stop', at: 1500 });
  d.observe({ kind: 'tool_call', at: 1700, callId: 't1', name: 'healthcare_patient_access', args: {} });
  d.observe({ kind: 'tool_result', at: 4000, callId: 't1', ok: true, result: {} });
  assert.equal(d.poll(13900), null);
  assert.equal(d.poll(14000), 'agent_quiet');
  assert.equal(d.poll(14100), null);
  assert.equal(d.poll(24000), 'agent_quiet');
});

test('a tool call that never returns is treated as stale after 30s', () => {
  const d = detector();
  d.observe({ kind: 'tool_call', at: 1000, callId: 't1', name: 'healthcare_patient_access', args: {} });
  assert.equal(d.poll(20000), null);
  assert.equal(d.poll(31000), 'agent_quiet');
});

test('opening fallback fires after 4s when the agent never speaks, but not once it has', () => {
  const silent = detector();
  assert.equal(silent.poll(3900), null);
  assert.equal(silent.poll(4000), 'agent_quiet');
  const greeted = detector();
  greeted.observe({ kind: 'agent_audio_start', at: 500 });
  assert.equal(greeted.poll(4500), null);
});

test('the caller speaking blocks signals; agent speech that ended during the caller turn does not count', () => {
  const d = detector();
  d.callerStarted(1000);
  d.observe({ kind: 'agent_audio_start', at: 1200 });
  d.observe({ kind: 'agent_audio_stop', at: 1400 });
  assert.equal(d.poll(2500), null);
  d.callerEnded(3000);
  assert.equal(d.poll(3700), null, 'the agent blip during caller speech is not a turn');

  const still = detector();
  still.callerStarted(1000);
  still.observe({ kind: 'agent_audio_start', at: 1500 });
  still.callerEnded(2000);
  still.observe({ kind: 'agent_audio_stop', at: 4000 });
  assert.equal(still.poll(4600), 'agent_turn_ended', 'agent still speaking when the caller ended counts');
});
