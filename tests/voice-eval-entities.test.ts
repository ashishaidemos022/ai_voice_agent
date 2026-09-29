import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreEntities } from '../shared/voice-eval/scoring/entities.ts';
import { getScenario } from '../shared/voice-eval/scenarios/index.ts';
import type { Scenario } from '../shared/voice-eval/types.ts';
import { callerSays, toolCall } from './helpers/voice-eval-fixtures.ts';

const hc01 = getScenario('hc-01') as Scenario;

test('all entities heard and passed correctly', () => {
  const result = scoreEntities(hc01, [
    callerSays(100, 'Hi, this is Maya Patel.'),
    callerSays(900, 'March 14th, 1979, and my zip is 75204.'),
    toolCall(1000, 'a', { action: 'search_availability', date_of_birth: '1979-03-14', postal_code: '75204' })
  ]);
  assert.equal(result.status, 'pass');
  assert.equal(result.entityWer, 0);
  assert.equal(result.overallWer, null);
  assert.deepEqual(result.entities.map((e) => e.fact), ['firstName', 'lastName', 'dob', 'postalCode']);
});

test('misheard zip warns; wrong tool argument fails', () => {
  const misheard = scoreEntities(hc01, [
    callerSays(100, 'Maya Patel, March 14th 1979, zip 75240'),
    toolCall(1000, 'a', { action: 'search_availability', date_of_birth: '1979-03-14', postal_code: '75204' })
  ]);
  assert.equal(misheard.status, 'warn');
  assert.equal(misheard.entities.find((e) => e.fact === 'postalCode')?.heardCorrectly, false);
  assert.ok((misheard.entityWer ?? 0) > 0);

  const wrongArg = scoreEntities(hc01, [
    callerSays(100, 'Maya Patel, March 14th 1979, zip 75204'),
    toolCall(1000, 'a', { action: 'search_availability', date_of_birth: '1979-03-14', postal_code: '75240' })
  ]);
  assert.equal(wrongArg.status, 'fail');
  assert.equal(wrongArg.entities.find((e) => e.fact === 'postalCode')?.argCorrect, false);
});

test('no caller transcript means no data', () => {
  const result = scoreEntities(hc01, []);
  assert.equal(result.status, 'no_data');
  assert.equal(result.entityWer, null);
  assert.equal(result.entities[0].heardCorrectly, null);
  assert.equal(result.entities[2].argCorrect, null);
});
