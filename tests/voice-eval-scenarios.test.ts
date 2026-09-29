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
  assert.equal(new Set(HEALTHCARE_SCENARIOS.map((s) => s.evalPatient)).size, 10);
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
