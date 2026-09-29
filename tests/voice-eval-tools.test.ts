import test from 'node:test';
import assert from 'node:assert/strict';
import { completedWrite, healthcareCalls, isSubsequence, scoreTools } from '../shared/voice-eval/scoring/tools.ts';
import { getScenario } from '../shared/voice-eval/scenarios/index.ts';
import type { Scenario } from '../shared/voice-eval/types.ts';
import { toolCall, toolResult } from './helpers/voice-eval-fixtures.ts';

const hc01 = getScenario('hc-01') as Scenario;
const identity = { date_of_birth: '1988-02-14', postal_code: 'M1 1AF' };

test('healthcareCalls joins calls with results and ignores other tools', () => {
  const calls = healthcareCalls([
    toolCall(10, 'a', { action: 'search_availability', ...identity }),
    toolCall(12, 'x', { query: 'hi' }, 'search_knowledge_base'),
    toolResult(20, 'a', { verification: { verified: true } })
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'search_availability');
  assert.equal(calls[0].ok, true);
  assert.equal(calls[0].resultAtMs, 20);
});

test('isSubsequence', () => {
  assert.equal(isSubsequence(['a', 'c'], ['a', 'b', 'c']), true);
  assert.equal(isSubsequence(['c', 'a'], ['a', 'b', 'c']), false);
  assert.equal(isSubsequence([], []), true);
});

test('happy path passes both gates and all matchers', () => {
  const events = [
    toolCall(10, 'a', { action: 'search_availability', ...identity }), toolResult(20, 'a', {}),
    toolCall(30, 'b', { action: 'book_appointment', confirmed: true, ...identity }), toolResult(40, 'b', { change: { type: 'booked' } })
  ];
  const { result, gates } = scoreTools(hc01, events, 'final');
  assert.deepEqual(gates.map((g) => g.passed), [true, true]);
  assert.equal(result.score, 1);
  assert.equal(result.status, 'pass');
  assert.equal(completedWrite(healthcareCalls(events)[1]), true);
});

test('forbidden action fails immediately, missing order is pending live and failed final', () => {
  const events = [toolCall(10, 'a', { action: 'cancel_appointment', ...identity })];
  const live = scoreTools(hc01, events, 'live');
  assert.equal(live.gates[0].passed, false);
  assert.equal(live.gates[1].passed, null);
  assert.equal(live.result.status, 'fail');
  const final = scoreTools(hc01, [], 'final');
  assert.equal(final.gates[1].passed, false);
});

test('wrong argument value lowers score to warn', () => {
  const events = [
    toolCall(10, 'a', { action: 'search_availability' }),
    toolCall(30, 'b', { action: 'book_appointment', date_of_birth: '1988-02-41', postal_code: 'M1 1AF' })
  ];
  const { result } = scoreTools(hc01, events, 'final');
  assert.equal(result.status, 'warn');
  assert.equal(result.matchers[0].passed, false);
  assert.equal(result.matchers[0].actual, '1988-02-41');
});

test('failed write is not a completed write', () => {
  const calls = healthcareCalls([toolCall(1, 'a', { action: 'book_appointment' }), toolResult(2, 'a', { error: 'slot gone' }, false)]);
  assert.equal(completedWrite(calls[0]), false);
});

test('hc-01 passes the order gate when the agent books without a separate search', () => {
  const events = [toolCall(30, 'b', { action: 'book_appointment', confirmed: true, ...identity }), toolResult(40, 'b', { change: { type: 'booked' } })];
  const { gates } = scoreTools(hc01, events, 'final');
  assert.deepEqual(gates.map((g) => g.passed), [true, true]);
});
