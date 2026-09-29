import { chicagoWeekday } from '../chicago-time.ts';
import type { Gate, StateAssertion, StateSnapshot } from '../types.ts';

const ACTIVE = new Set(['scheduled', 'confirmed']);

function label(assertion: StateAssertion): string {
  switch (assertion.kind) {
    case 'new_appointments': return `Exactly ${assertion.count} new appointment(s) in the EHR`;
    case 'new_appointment_weekday': return `New appointment falls on ${assertion.weekday}`;
    case 'new_appointment_slot_booked': return 'New appointment holds its slot';
    case 'seeded_status': return `Original appointment is ${assertion.status}`;
    case 'seeded_slot_released': return "Original appointment's slot is reopened";
  }
}

function check(assertion: StateAssertion, snapshot: StateSnapshot): { passed: boolean; detail: string } {
  const created = snapshot.appointments.filter((a) => a.id !== snapshot.seededAppointmentId && ACTIVE.has(a.status));
  const seeded = snapshot.appointments.find((a) => a.id === snapshot.seededAppointmentId);
  switch (assertion.kind) {
    case 'new_appointments':
      return { passed: created.length === assertion.count, detail: `Found ${created.length}` };
    case 'new_appointment_weekday': {
      const days = created.map((a) => chicagoWeekday(a.start_at));
      return { passed: created.length === 1 && days[0] === assertion.weekday, detail: days.length ? `Booked on ${days.join(', ')}` : 'No new appointment' };
    }
    case 'new_appointment_slot_booked': {
      const appointment = created.length === 1 ? created[0] : undefined;
      const heldSlot = appointment ? snapshot.slots.find((s) => s.id === appointment.slot_id) : undefined;
      const passed = Boolean(appointment && heldSlot && heldSlot.status === 'booked' && heldSlot.appointment_id === appointment.id);
      return { passed, detail: heldSlot ? `Slot status ${heldSlot.status}` : 'No slot found for the new appointment' };
    }
    case 'seeded_status':
      return { passed: seeded?.status === assertion.status, detail: seeded ? `Status is ${seeded.status}` : 'Original appointment missing' };
    case 'seeded_slot_released': {
      const seededSlot = snapshot.slots.find((s) => s.id === snapshot.seededSlotId);
      const passed = Boolean(seededSlot && seededSlot.status === 'open' && seededSlot.appointment_id === null);
      return { passed, detail: seededSlot ? `Slot status ${seededSlot.status}` : 'Original slot missing' };
    }
  }
}

export function evaluateStateAssertions(assertions: StateAssertion[], snapshot: StateSnapshot | null): Gate[] {
  return assertions.map((assertion, index) => {
    const id = `state.${index}.${assertion.kind}`;
    if (!snapshot) return { id, label: label(assertion), passed: null, detail: 'Backend state is checked after hangup' };
    const outcome = check(assertion, snapshot);
    return { id, label: label(assertion), passed: outcome.passed, detail: outcome.detail };
  });
}
