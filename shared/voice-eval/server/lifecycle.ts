import { addDaysYmd, chicagoLocalToUtcIso, chicagoMonthDay, chicagoWeekday, chicagoYmd } from '../chicago-time.ts';
import type { AppointmentRow, Scenario, SetupResult, SlotRow, StateSnapshot } from '../types.ts';

/** Minimal EHR access the evaluator needs. Implemented over PostgREST in the Edge Function and in memory in tests. */
export interface EhrStore {
  findPatientByMrn(mrn: string): Promise<{ id: string } | null>;
  findOpenReferral(patientId: string): Promise<{ id: string } | null>;
  listOpenFutureSlots(visitType: string, fromIso: string): Promise<SlotRow[]>;
  /** ISO strings (toISOString format) of every slot for the provider starting at or after fromIso. */
  listFutureSlotStarts(providerId: string, fromIso: string): Promise<string[]>;
  insertSlots(rows: SlotRow[]): Promise<void>;
  reserveSlot(slotId: string, appointmentId: string): Promise<boolean>;
  insertAppointment(row: AppointmentRow): Promise<void>;
  listTaggedAppointments(evalRunId: string): Promise<AppointmentRow[]>;
  listSlotsByIds(ids: string[]): Promise<SlotRow[]>;
  releaseSlotsForAppointments(appointmentIds: string[]): Promise<void>;
  deleteTaggedAppointments(evalRunId: string): Promise<number>;
  listStaleTaggedRunIds(olderThanIso: string): Promise<string[]>;
}

export const EVAL_SLOT_PROVIDER_ID = '33333333-0000-0000-0000-000000000002';
export const EVAL_SLOT_DEPARTMENT_ID = '22222222-0000-0000-0000-000000000003';
export const EVAL_VISIT_TYPE = 'CARDIOLOGY_CONSULT';
export const MIN_OPEN_SLOTS = 12;
export const STALE_RUN_MS = 60 * 60 * 1000;
const SLOT_POOL_WEEKDAYS = 10;
const SLOT_POOL_LOCAL_HOURS = [9, 11, 14];
const SLOT_DURATION_MIN = 45;
const SEED_MIN_LEAD_MS = 2 * 24 * 60 * 60 * 1000;

export function planSlotPool(now: Date, existingStarts: Set<string>, makeId: () => string = () => crypto.randomUUID()): SlotRow[] {
  const rows: SlotRow[] = [];
  let ymd = chicagoYmd(now);
  let weekdays = 0;
  while (weekdays < SLOT_POOL_WEEKDAYS) {
    ymd = addDaysYmd(ymd, 1);
    const day = chicagoWeekday(`${ymd}T18:00:00Z`);
    if (day === 'Saturday' || day === 'Sunday') continue;
    weekdays += 1;
    for (const hour of SLOT_POOL_LOCAL_HOURS) {
      const start = chicagoLocalToUtcIso(ymd, hour);
      if (existingStarts.has(start)) continue;
      rows.push({
        id: makeId(),
        provider_id: EVAL_SLOT_PROVIDER_ID,
        department_id: EVAL_SLOT_DEPARTMENT_ID,
        slot_start: start,
        slot_end: new Date(Date.parse(start) + SLOT_DURATION_MIN * 60_000).toISOString(),
        duration_min: SLOT_DURATION_MIN,
        status: 'open',
        appointment_id: null,
        visit_types_allowed: [EVAL_VISIT_TYPE]
      });
    }
  }
  return rows;
}

export async function ensureSlotPool(store: EhrStore, now: Date): Promise<number> {
  const open = await store.listOpenFutureSlots(EVAL_VISIT_TYPE, now.toISOString());
  if (open.length >= MIN_OPEN_SLOTS) return 0;
  const existing = new Set(await store.listFutureSlotStarts(EVAL_SLOT_PROVIDER_ID, now.toISOString()));
  const rows = planSlotPool(now, existing);
  await store.insertSlots(rows);
  return rows.length;
}

export async function setupRun(store: EhrStore, scenario: Scenario, evalRunId: string, now: Date): Promise<SetupResult> {
  const patient = await store.findPatientByMrn(scenario.evalPatient);
  if (!patient) throw new Error(`Eval patient ${scenario.evalPatient} is not seeded in the EHR`);
  await ensureSlotPool(store, now);
  if (!scenario.setup.seedAppointment) return { seededAppointmentId: null, seededSlotId: null, sensitiveStrings: [] };

  const referral = await store.findOpenReferral(patient.id);
  const [slot] = await store.listOpenFutureSlots(EVAL_VISIT_TYPE, new Date(now.getTime() + SEED_MIN_LEAD_MS).toISOString());
  if (!slot) throw new Error('No open slot is available to seed the scenario appointment');
  const appointmentId = crypto.randomUUID();
  if (!(await store.reserveSlot(slot.id, appointmentId))) throw new Error('Seed slot was taken; retry setup');
  const confirmation = `HLS-${slot.id.replace(/-/g, '').slice(-4).toUpperCase()}`;
  await store.insertAppointment({
    id: appointmentId,
    patient_id: patient.id,
    provider_id: slot.provider_id,
    department_id: slot.department_id,
    start_at: slot.slot_start,
    duration_min: slot.duration_min,
    status: 'scheduled',
    visit_type: 'Cardiology Consult',
    visit_type_code: EVAL_VISIT_TYPE,
    reason: 'Cardiology referral visit',
    confirmation_number: confirmation,
    booked_via: 'eval_setup',
    slot_id: slot.id,
    referral_id: referral?.id ?? null,
    eval_run_id: evalRunId
  });
  return { seededAppointmentId: appointmentId, seededSlotId: slot.id, sensitiveStrings: [confirmation, chicagoMonthDay(slot.slot_start)] };
}

export async function snapshotRun(store: EhrStore, evalRunId: string, setup: SetupResult): Promise<StateSnapshot> {
  const appointments = await store.listTaggedAppointments(evalRunId);
  const slotIds = [...new Set([...appointments.map((a) => a.slot_id), setup.seededSlotId].filter((id): id is string => Boolean(id)))];
  return {
    seededAppointmentId: setup.seededAppointmentId,
    seededSlotId: setup.seededSlotId,
    appointments,
    slots: await store.listSlotsByIds(slotIds)
  };
}

export async function teardownRun(store: EhrStore, evalRunId: string): Promise<number> {
  const appointments = await store.listTaggedAppointments(evalRunId);
  if (!appointments.length) return 0;
  await store.releaseSlotsForAppointments(appointments.map((a) => a.id));
  return store.deleteTaggedAppointments(evalRunId);
}

export async function sweepStale(store: EhrStore, now: Date): Promise<string[]> {
  const runIds = await store.listStaleTaggedRunIds(new Date(now.getTime() - STALE_RUN_MS).toISOString());
  for (const runId of runIds) await teardownRun(store, runId);
  return runIds;
}
