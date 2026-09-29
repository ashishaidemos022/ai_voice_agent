import test from 'node:test';
import assert from 'node:assert/strict';
import { BeatScheduler } from '../shared/voice-eval/caller/beat-scheduler.ts';
import { SCENARIOS, getScenario } from '../shared/voice-eval/scenarios/index.ts';
import type { Scenario } from '../shared/voice-eval/types.ts';

const TOOL = 'healthcare_patient_access';
const scenario = (id: string) => getScenario(id) as Scenario;
function toolOk(s: BeatScheduler, callId: string, action: string, result: unknown = { ok: true }) {
  s.observe({ kind: 'tool_call', at: 0, callId, name: TOOL, args: { action } });
  s.observe({ kind: 'tool_result', at: 1, callId, ok: true, result });
}

test('scenarios without beats always ask the brain', () => {
  const s = new BeatScheduler(scenario('hc-01').beats);
  for (let i = 0; i < 5; i += 1) assert.deepEqual(s.nextTurnAction(), { kind: 'brain' });
});

test('hc-10 says its line on the second caller turn', () => {
  const s = new BeatScheduler(scenario('hc-10').beats);
  assert.equal(s.nextTurnAction().kind, 'brain');
  const second = s.nextTurnAction();
  assert.equal(second.kind, 'beat');
  assert.equal(second.kind === 'beat' && second.beatIndex, 0);
  assert.equal(s.nextTurnAction().kind, 'brain', 'a beat fires once');
  assert.deepEqual(s.firedBeats(), [0]);
});

test('hc-09 goes silent on the third caller turn', () => {
  const s = new BeatScheduler(scenario('hc-09').beats);
  s.nextTurnAction();
  s.nextTurnAction();
  assert.deepEqual(s.nextTurnAction(), { kind: 'silence', beatIndex: 0, durationMs: 12000 });
});

test('hc-05 correction waits for both its turn and a successful search, and hides the fact until then', () => {
  const s = new BeatScheduler(scenario('hc-05').beats);
  assert.deepEqual(s.hiddenFacts(), ['preferredDay']);
  for (let i = 0; i < 4; i += 1) assert.equal(s.nextTurnAction().kind, 'brain');
  toolOk(s, 'a', 'search_availability', { error: 'EHR offline' });
  assert.equal(s.nextTurnAction().kind, 'brain', 'a failed search is not the anchor');
  toolOk(s, 'b', 'search_availability');
  assert.equal(s.nextTurnAction().kind, 'beat');
  assert.deepEqual(s.hiddenFacts(), []);
});

test('hc-06 barge-in arms only after the hold, fires afterAgentSpeechMs into agent audio, once', () => {
  const s = new BeatScheduler(scenario('hc-06').beats);
  s.observe({ kind: 'agent_audio_start', at: 1000 });
  assert.equal(s.pollBargeIn(5000), null, 'not armed before hold_slot');
  toolOk(s, 'h', 'hold_slot');
  s.observe({ kind: 'agent_audio_start', at: 6000 });
  s.observe({ kind: 'agent_audio_stop', at: 6500 });
  assert.equal(s.pollBargeIn(7300), null, 'agent stopped early: cancelled but still armed');
  s.observe({ kind: 'agent_audio_start', at: 8000 });
  assert.equal(s.pollBargeIn(9199), null);
  const fired = s.pollBargeIn(9200);
  assert.equal(fired?.beatIndex, 0);
  s.observe({ kind: 'agent_audio_start', at: 12000 });
  assert.equal(s.pollBargeIn(20000), null, 'fires once');
  assert.equal(s.nextTurnAction().kind, 'brain', 'barge-ins are never turn actions');
});

test('every scenario fires all its turn beats once anchors are met', () => {
  for (const sc of SCENARIOS) {
    const s = new BeatScheduler(sc.beats);
    sc.beats.forEach((beat, i) => { if (beat.anchor) toolOk(s, `c${i}`, beat.anchor.afterTool); });
    for (let i = 0; i < 10; i += 1) s.nextTurnAction();
    const expected = sc.beats.flatMap((beat, i) => (beat.kind === 'barge_in' ? [] : [i]));
    assert.deepEqual(s.firedBeats(), expected, sc.id);
  }
});
