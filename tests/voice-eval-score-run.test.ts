import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStateAssertions } from '../shared/voice-eval/scoring/state.ts';
import { scoreRun } from '../shared/voice-eval/scoring/index.ts';
import { getScenario } from '../shared/voice-eval/scenarios/index.ts';
import type { AppointmentRow, Scenario, SlotRow, StateSnapshot } from '../shared/voice-eval/types.ts';
import { callerSays, toolCall, toolResult, turnMetric } from './helpers/voice-eval-fixtures.ts';

function appt(id: string, status: string, startAt: string, slotId: string): AppointmentRow {
  return {
    id, patient_id: 'p', provider_id: 'pr', department_id: 'd', start_at: startAt, duration_min: 45, status,
    visit_type: 'Cardiology Consult', visit_type_code: 'CARDIOLOGY_CONSULT', reason: 'r', confirmation_number: 'HLS-0001',
    booked_via: 'agent', slot_id: slotId, referral_id: null, eval_run_id: 'run'
  };
}
function slot(id: string, status: string, appointmentId: string | null): SlotRow {
  return {
    id, provider_id: 'pr', department_id: 'd', slot_start: '2026-10-06T14:00:00Z', slot_end: '2026-10-06T14:45:00Z',
    duration_min: 45, status, appointment_id: appointmentId, visit_types_allowed: ['CARDIOLOGY_CONSULT']
  };
}

const hc01 = getScenario('hc-01') as Scenario;
const hc02 = getScenario('hc-02') as Scenario;
const tuesday = '2026-10-06T14:00:00Z';
const wednesday = '2026-10-07T14:00:00Z';

const bookedSnapshot: StateSnapshot = {
  seededAppointmentId: null, seededSlotId: null,
  appointments: [appt('new', 'scheduled', tuesday, 's1')],
  slots: [slot('s1', 'booked', 'new')]
};

test('state assertions pass for a correct booking', () => {
  const gates = evaluateStateAssertions(hc01.expected.state, bookedSnapshot);
  assert.deepEqual(gates.map((g) => g.passed), [true, true, true]);
});

test('state assertions catch wrong weekday and unbooked slot', () => {
  const snapshot: StateSnapshot = { ...bookedSnapshot, appointments: [appt('new', 'scheduled', wednesday, 's1')], slots: [slot('s1', 'open', null)] };
  const gates = evaluateStateAssertions(hc01.expected.state, snapshot);
  assert.deepEqual(gates.map((g) => g.passed), [true, false, false]);
  assert.match(gates[1].detail, /Wednesday/);
});

test('reschedule assertions check the seeded row and its released slot', () => {
  const snapshot: StateSnapshot = {
    seededAppointmentId: 'seed', seededSlotId: 's0',
    appointments: [appt('seed', 'rescheduled', tuesday, 's0'), appt('new', 'scheduled', wednesday, 's1')],
    slots: [slot('s0', 'open', null), slot('s1', 'booked', 'new')]
  };
  assert.ok(evaluateStateAssertions(hc02.expected.state, snapshot).every((g) => g.passed === true));
});

test('missing snapshot leaves state gates undecided', () => {
  assert.ok(evaluateStateAssertions(hc01.expected.state, null).every((g) => g.passed === null));
});

test('scoreRun final: happy path passes', () => {
  const events = [
    callerSays(100, 'John Hackett, February 14th 1988, postcode M1 1AF, Tuesday please'),
    toolCall(1000, 'a', { action: 'search_availability', date_of_birth: '1988-02-14', postal_code: 'M1 1AF' }),
    toolResult(1500, 'a', { verification: { verified: true } }),
    toolCall(3000, 'b', { action: 'book_appointment', confirmed: true, date_of_birth: '1988-02-14', postal_code: 'M1 1AF' }),
    toolResult(3500, 'b', { change: { type: 'booked' } }),
    turnMetric(4000, 700)
  ];
  const score = scoreRun(hc01, events, { mode: 'final', snapshot: bookedSnapshot });
  assert.equal(score.verdict, 'pass');
  assert.equal(score.latency.status, 'pass');
});

test('scoreRun final: caller hangs up before any tool call fails with reasons, never pending', () => {
  const emptySnapshot: StateSnapshot = { seededAppointmentId: null, seededSlotId: null, appointments: [], slots: [] };
  const score = scoreRun(hc01, [callerSays(100, 'Hi, actually never mind.')], { mode: 'final', snapshot: emptySnapshot });
  assert.equal(score.verdict, 'fail');
  assert.ok(score.gates.every((g) => g.passed !== null));
  assert.ok(score.gates.some((g) => g.id === 'tools.order' && g.passed === false));
  assert.ok(score.gates.some((g) => g.id.startsWith('state.') && g.passed === false));
});

test('scoreRun final: missing snapshot or harness error is invalid_harness', () => {
  assert.equal(scoreRun(hc01, [], { mode: 'final', snapshot: null }).verdict, 'invalid_harness');
  const withError = scoreRun(hc01, [{ kind: 'harness_error', atMs: 5, message: 'tts failed' }], { mode: 'final', snapshot: bookedSnapshot });
  assert.equal(withError.verdict, 'invalid_harness');
});

test('scoreRun live is always pending', () => {
  assert.equal(scoreRun(hc01, [], { mode: 'live', snapshot: null }).verdict, 'pending');
});
