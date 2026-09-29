import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLatency } from '../shared/voice-eval/scoring/latency.ts';
import { scoreTurnTaking } from '../shared/voice-eval/scoring/turn-taking.ts';
import { agentAudio, agentAudioStop, agentSays, beatEvent, callerSays, callerUtterance, toolCall, turnMetric } from './helpers/voice-eval-fixtures.ts';

test('synthetic latency runs from caller utterance end to the next agent audio start', () => {
  const result = scoreLatency([
    callerUtterance(1000, 2000), agentAudio(3600),
    callerUtterance(6000, 1000), toolCall(7100, 't1', { action: 'search_availability' }), agentAudio(9500),
    turnMetric(9600, 50)
  ]);
  assert.equal(result.turnCount, 2);
  assert.equal(result.p50Ms, 600);
  assert.equal(result.p95Ms, 2500);
  assert.equal(result.maxMs, 2500);
  assert.equal(result.toolTurnP95Ms, 2500);
  assert.equal(result.status, 'fail');
});

test('synthetic latency with utterances but no agent reply is no_data', () => {
  assert.equal(scoreLatency([callerUtterance(1000, 1000), turnMetric(3000, 400)]).status, 'no_data');
});

test('synthetic barge-in cutoff is measured from the beat utterance start', () => {
  const base = [agentAudio(1000), beatEvent(2200, 0, 'barge_in'), callerUtterance(2200, 1500, 'Sorry — afternoon?', 'beat', 0)];
  const fast = scoreTurnTaking([...base, agentAudioStop(2550)]);
  assert.deepEqual(fast.bargeIns, [350]);
  assert.equal(fast.bargeInPass, true);
  const slow = scoreTurnTaking([...base, agentAudioStop(3100)]);
  assert.equal(slow.bargeInPass, false);
  const never = scoreTurnTaking(base);
  assert.equal(never.bargeInPass, false);
  assert.equal(never.status, 'fail');
});

test('a beat utterance while the agent is silent is not a barge-in', () => {
  const result = scoreTurnTaking([agentAudio(1000), agentAudioStop(2000), beatEvent(2200, 0, 'barge_in'), callerUtterance(2200, 1000, 'x', 'beat', 0)]);
  assert.deepEqual(result.bargeIns, []);
  assert.equal(result.bargeInPass, null);
});

test('synthetic talk-over uses exact utterance windows and ignores the barge-in beat', () => {
  const result = scoreTurnTaking([
    callerUtterance(1000, 2000), agentAudio(1500), agentAudioStop(1900),
    agentAudio(4000), beatEvent(4300, 0, 'barge_in'), callerUtterance(4300, 1000, 'Sorry', 'beat', 0),
    agentAudioStop(4600), agentAudio(5000)
  ]);
  assert.equal(result.talkOverCount, 1);
  assert.deepEqual(result.bargeIns, [300]);
  assert.equal(result.status, 'warn');
});

test('synthetic silence check uses exact utterance times, not transcript back-dating', () => {
  const human = [
    agentSays(1000, 'What is your date of birth?'),
    callerSays(11000, 'it is the fourteenth of february nineteen eighty eight okay'),
    agentAudio(12500)
  ];
  assert.equal(scoreTurnTaking(human).silenceViolations, 0);
  assert.equal(scoreTurnTaking([...human, callerUtterance(10000, 1000)]).silenceViolations, 1);
});
