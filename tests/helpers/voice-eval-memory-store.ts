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
  async reserveSlot(slotId: string, appointmentId: string) {
    const slot = this.slots.find((s) => s.id === slotId && s.status === 'open');
    if (!slot) return false;
    slot.status = 'booked';
    slot.appointment_id = appointmentId;
    return true;
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
    const before = this.appointments.length;
    this.appointments = this.appointments.filter((a) => a.eval_run_id !== evalRunId);
    return before - this.appointments.length;
  }
  async listStaleTaggedRunIds(olderThanIso: string) {
    return [...new Set(this.appointments.filter((a) => a.eval_run_id && (a.created_at ?? '') < olderThanIso).map((a) => a.eval_run_id as string))];
  }
}
