import type { EhrStore } from '../../shared/voice-eval/server/lifecycle.ts';
import type { AppointmentRow, SlotRow } from '../../shared/voice-eval/types.ts';

export class MemoryEhrStore implements EhrStore {
  patients = [{ id: 'p-john', mrn: '205042' }, { id: 'p-2', mrn: 'EVAL-0002' }];
  referrals = [{ id: 'r-john', patient_id: 'p-john', status: 'open' }];
  slots: SlotRow[] = [];
  appointments: AppointmentRow[] = [];

  async findPatientByMrn(mrn: string) { return this.patients.find((p) => p.mrn === mrn) ?? null; }
  async findOpenReferral(patientId: string) { return this.referrals.find((r) => r.patient_id === patientId && r.status === 'open') ?? null; }
  async listOpenFutureSlots(visitType: string, fromIso: string) {
    return this.slots
      .filter((s) => s.status === 'open' && s.slot_start >= fromIso && s.visit_types_allowed.includes(visitType))
      .sort((a, b) => a.slot_start.localeCompare(b.slot_start));
  }
  async listFutureSlotStarts(providerId: string, fromIso: string) {
    return this.slots.filter((s) => s.provider_id === providerId && s.slot_start >= fromIso).map((s) => s.slot_start);
  }
  async insertSlots(rows: SlotRow[]) { this.slots.push(...rows.map((r) => ({ ...r }))); }
  // Mirrors epic_provider_schedule_slots_appointment_id_fkey (not deferrable): a slot may only point at an existing appointment.
  private assertAppointmentExists(appointmentId: string) {
    if (!this.appointments.some((a) => a.id === appointmentId)) {
      throw new Error('insert or update on table "epic_provider_schedule_slots" violates foreign key constraint "epic_provider_schedule_slots_appointment_id_fkey"');
    }
  }
  // Mirrors epic_provider_schedule_slots_check1: which fields each status may carry.
  private assertSlotShape(slot: SlotRow) {
    const held = slot.held_by_session_id ?? null;
    const until = slot.held_until ?? null;
    const ok =
      (slot.status === 'open' && held === null && until === null && slot.appointment_id === null) ||
      (slot.status === 'held' && held !== null && until !== null && slot.appointment_id === null) ||
      (slot.status === 'booked' && slot.appointment_id !== null);
    if (!ok) throw new Error('new row for relation "epic_provider_schedule_slots" violates check constraint "epic_provider_schedule_slots_check1"');
  }
  async claimSlot(slotId: string, holderId: string, heldUntil: string) {
    const slot = this.slots.find((s) => s.id === slotId && s.status === 'open');
    if (!slot) return false;
    const next = { ...slot, status: 'held', held_by_session_id: holderId, held_until: heldUntil };
    this.assertSlotShape(next);
    Object.assign(slot, next);
    return true;
  }
  async linkSlot(slotId: string, holderId: string, appointmentId: string) {
    const slot = this.slots.find((s) => s.id === slotId && s.status === 'held' && s.held_by_session_id === holderId);
    if (!slot) return false;
    this.assertAppointmentExists(appointmentId);
    const next = { ...slot, status: 'booked', appointment_id: appointmentId, held_by_session_id: null, held_until: null };
    this.assertSlotShape(next);
    Object.assign(slot, next);
    return true;
  }
  async unclaimSlot(slotId: string, holderId: string) {
    const slot = this.slots.find((s) => s.id === slotId && s.status === 'held' && s.held_by_session_id === holderId);
    if (slot) Object.assign(slot, { status: 'open', held_by_session_id: null, held_until: null });
  }
  async insertAppointment(row: AppointmentRow) { this.appointments.push({ ...row, created_at: row.created_at ?? new Date().toISOString() }); }
  async listTaggedAppointments(evalRunId: string) { return this.appointments.filter((a) => a.eval_run_id === evalRunId); }
  async listSlotsByIds(ids: string[]) { return this.slots.filter((s) => ids.includes(s.id)); }
  async releaseSlotsForAppointments(ids: string[]) {
    for (const slot of this.slots) {
      if (slot.appointment_id && ids.includes(slot.appointment_id)) {
        slot.status = 'open';
        slot.appointment_id = null;
        slot.held_by_session_id = null;
        slot.held_until = null;
      }
    }
  }
  async releaseHoldsForPatient(patientId: string) {
    for (const slot of this.slots) {
      if (slot.status === 'held' && slot.held_by_session_id === patientId) {
        slot.status = 'open';
        slot.held_by_session_id = null;
        slot.held_until = null;
      }
    }
  }
  async deleteTaggedAppointments(evalRunId: string) {
    const doomed = new Set(this.appointments.filter((a) => a.eval_run_id === evalRunId).map((a) => a.id));
    // ON DELETE SET NULL on the slot FK: a slot still 'booked' by a deleted appointment would break check1.
    for (const slot of this.slots) {
      if (slot.appointment_id && doomed.has(slot.appointment_id)) this.assertSlotShape({ ...slot, appointment_id: null });
    }
    this.appointments = this.appointments.filter((a) => !doomed.has(a.id));
    return doomed.size;
  }
  async listStaleTaggedRunIds(olderThanIso: string) {
    return [...new Set(this.appointments.filter((a) => a.eval_run_id && (a.created_at ?? '') < olderThanIso).map((a) => a.eval_run_id as string))];
  }
}
