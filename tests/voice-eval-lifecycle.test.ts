import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureSlotPool, EVAL_VISIT_TYPE, MIN_OPEN_SLOTS, planSlotPool, setupRun, snapshotRun, sweepStale, teardownRun
} from '../shared/voice-eval/server/lifecycle.ts';
import { chicagoWeekday } from '../shared/voice-eval/chicago-time.ts';
import { getScenario } from '../shared/voice-eval/scenarios/index.ts';
import type { Scenario } from '../shared/voice-eval/types.ts';
import { MemoryEhrStore } from './helpers/voice-eval-memory-store.ts';

const now = new Date('2026-09-29T15:00:00Z'); // Tuesday in Chicago

test('planSlotPool makes 3 slots on each of the next 10 weekdays and skips existing starts', () => {
  let n = 0;
  const plan = planSlotPool(now, new Set(), () => `s${n++}`);
  assert.equal(plan.length, 30);
  assert.equal(plan[0].slot_start, '2026-09-30T14:00:00.000Z');
  assert.ok(plan.every((s) => !['Saturday', 'Sunday'].includes(chicagoWeekday(s.slot_start))));
  assert.ok(plan.every((s) => s.status === 'open' && s.visit_types_allowed.includes(EVAL_VISIT_TYPE)));
  assert.equal(planSlotPool(now, new Set(['2026-09-30T14:00:00.000Z'])).length, 29);
});

test('ensureSlotPool only tops up when fewer than the minimum are open', async () => {
  const store = new MemoryEhrStore();
  assert.equal(await ensureSlotPool(store, now), 30);
  assert.equal(await ensureSlotPool(store, now), 0);
  assert.ok((await store.listOpenFutureSlots(EVAL_VISIT_TYPE, now.toISOString())).length >= MIN_OPEN_SLOTS);
});

test('setup seeds a tagged appointment, snapshot sees it, teardown removes it and frees the slot', async () => {
  const store = new MemoryEhrStore();
  const hc02 = getScenario('hc-02') as Scenario;
  const setup = await setupRun(store, hc02, 'run-1', now);
  assert.ok(setup.seededAppointmentId);
  assert.ok(setup.seededSlotId);
  assert.match(setup.sensitiveStrings[0], /^HLS-[A-Z0-9]{4}$/);
  assert.match(setup.sensitiveStrings[1], /^[A-Z][a-z]+ \d{1,2}$/);

  const snapshot = await snapshotRun(store, 'run-1', setup);
  assert.equal(snapshot.appointments.length, 1);
  assert.equal(snapshot.appointments[0].referral_id, 'r-2');
  assert.equal(snapshot.slots[0].status, 'booked');

  assert.equal(await teardownRun(store, 'run-1'), 1);
  assert.equal(store.appointments.length, 0);
  assert.equal(store.slots.find((s) => s.id === setup.seededSlotId)?.status, 'open');
  assert.equal(await teardownRun(store, 'run-1'), 0);
});

test('setup without seeding returns no seeded ids; unknown patient throws', async () => {
  const store = new MemoryEhrStore();
  const setup = await setupRun(store, getScenario('hc-01') as Scenario, 'run-2', now);
  assert.deepEqual(setup, { seededAppointmentId: null, seededSlotId: null, sensitiveStrings: [] });
  await assert.rejects(setupRun(store, getScenario('hc-03') as Scenario, 'run-3', now), /EVAL-0003 is not seeded/);
});

test('sweepStale tears down runs older than an hour and leaves fresh ones', async () => {
  const store = new MemoryEhrStore();
  const hc02 = getScenario('hc-02') as Scenario;
  await setupRun(store, hc02, 'old-run', now);
  store.appointments[0].created_at = '2026-09-29T13:00:00.000Z';
  await setupRun(store, hc02, 'new-run', now);
  store.appointments[1].created_at = '2026-09-29T14:50:00.000Z';
  assert.deepEqual(await sweepStale(store, now), ['old-run']);
  assert.deepEqual(store.appointments.map((a) => a.eval_run_id), ['new-run']);
});

test('setup releases the reserved slot when the seed appointment insert fails', async () => {
  const store = new MemoryEhrStore();
  const failure = new Error('insert failed');
  store.insertAppointment = async () => { throw failure; };
  await assert.rejects(setupRun(store, getScenario('hc-02') as Scenario, 'run-4', now), (err) => err === failure);
  assert.equal(store.appointments.length, 0);
  assert.ok(store.slots.length > 0);
  assert.ok(store.slots.every((s) => s.status === 'open' && s.appointment_id === null));
});

test('setup rethrows the original insert error even when releasing the slot also fails', async () => {
  const store = new MemoryEhrStore();
  const failure = new Error('insert failed');
  store.insertAppointment = async () => { throw failure; };
  store.releaseSlotsForAppointments = async () => { throw new Error('release failed'); };
  await assert.rejects(setupRun(store, getScenario('hc-02') as Scenario, 'run-5', now), (err) => err === failure);
});
