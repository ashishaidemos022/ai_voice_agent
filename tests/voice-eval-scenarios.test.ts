import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScenario } from '../shared/voice-eval/scenario.ts';
import { HEALTHCARE_SCENARIOS } from '../shared/voice-eval/scenarios/healthcare.ts';
import { getScenario, SCENARIOS } from '../shared/voice-eval/scenarios/index.ts';
import type { Scenario } from '../shared/voice-eval/types.ts';

test('healthcare pack has 10 valid scenarios with unique ids and eval patients', () => {
  assert.equal(HEALTHCARE_SCENARIOS.length, 10);
  for (const scenario of HEALTHCARE_SCENARIOS) assert.deepEqual(validateScenario(scenario), [], scenario.id);
  assert.equal(new Set(HEALTHCARE_SCENARIOS.map((s) => s.id)).size, 10);
  // Every scenario targets John Hackett's real record; runs are serial so they never overlap.
  assert.ok(HEALTHCARE_SCENARIOS.every((s) => s.evalPatient === '205042'));
  assert.ok(HEALTHCARE_SCENARIOS.every((s) => s.facts.firstName.value === 'John' && s.facts.lastName.value === 'Hackett'));
  assert.ok(HEALTHCARE_SCENARIOS.every((s) => s.facts.postalCode.kind === 'postcode' && s.facts.postalCode.value === 'M1 1AF'));
  assert.ok(HEALTHCARE_SCENARIOS.filter((s) => s.id !== 'hc-04').every((s) => s.facts.dob.value === '1988-02-14'));
  assert.notEqual(HEALTHCARE_SCENARIOS.find((s) => s.id === 'hc-04')?.facts.dob.value, '1988-02-14');
});

test('getScenario finds scenarios by id', () => {
  assert.equal(getScenario('hc-05')?.expected.state.some((a) => a.kind === 'new_appointment_weekday' && a.weekday === 'Thursday'), true);
  assert.equal(getScenario('nope'), undefined);
  assert.equal(SCENARIOS.length, 10);
});

test('validator reports broken scenarios', () => {
  const base = getScenario('hc-01') as Scenario;
  const broken: Scenario = {
    ...base,
    id: 'x1',
    evalPatient: 'DEMO-1001',
    beats: [{ kind: 'correction', afterTurn: 2, line: 'wait', correctedFact: 'missing' }],
    expected: {
      ...base.expected,
      state: [{ kind: 'seeded_status', status: 'cancelled' }],
      tools: { requiredActions: ['book_appointment'], forbiddenActions: [], argMatchers: [{ action: 'book_appointment', field: 'date_of_birth', fact: 'nope' }] },
      policy: { requireEscalation: true, judgeRubric: ['bad rubric'] }
    }
  };
  const errors = validateScenario(broken);
  assert.ok(errors.some((e) => e.includes('id must look like hc-01')));
  assert.ok(errors.some((e) => e.includes('evalPatient')));
  assert.ok(errors.some((e) => e.includes('missing fact nope')));
  assert.ok(errors.some((e) => e.includes('correctedFact missing')));
  assert.ok(errors.some((e) => e.includes('needs setup.seedAppointment')));
  assert.ok(errors.some((e) => e.includes('must forbid book_appointment')));
  assert.ok(errors.some((e) => e.includes('rubric entries')));
});

test('hc-01 only requires the booking write (search is optional)', () => {
  const hc01 = getScenario('hc-01') as Scenario;
  assert.equal(hc01.version, 4);
  assert.deepEqual(hc01.expected.tools.requiredActions, ['book_appointment']);
});

test('only the day-correction scenario gates on the weekday; elsewhere the caller may pick any day', () => {
  const withWeekdayGate = HEALTHCARE_SCENARIOS.filter((s) => s.expected.state.some((a) => a.kind === 'new_appointment_weekday'));
  assert.deepEqual(withWeekdayGate.map((s) => s.id), ['hc-05']);
});

test('hc-05 and hc-06 beats are anchored to tool results', () => {
  const hc05 = getScenario('hc-05') as Scenario;
  const hc06 = getScenario('hc-06') as Scenario;
  assert.equal(hc05.version, 3);
  assert.deepEqual(hc05.beats[0].anchor, { afterTool: 'search_availability' });
  assert.equal(hc06.version, 4);
  assert.deepEqual(hc06.beats[0].anchor, { afterTool: 'hold_slot' });
});

test('validator rejects unknown anchors and malformed beats', () => {
  const base = getScenario('hc-06') as Scenario;
  const errors = validateScenario({
    ...base,
    beats: [
      { kind: 'barge_in', line: 'x', afterAgentSpeechMs: 100, anchor: { afterTool: 'teleport' as never } },
      { kind: 'say', afterTurn: 1 },
      { kind: 'silence', afterTurn: 1 },
      { kind: 'barge_in', line: 'y' }
    ]
  });
  assert.ok(errors.some((e) => e.includes('unknown anchor action teleport')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('beat 1 needs a line')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('beat 2 needs durationMs')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('beat 3 needs afterAgentSpeechMs')), errors.join('\n'));
});
