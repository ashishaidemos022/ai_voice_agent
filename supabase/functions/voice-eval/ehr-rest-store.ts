import type { EhrStore } from '../../../shared/voice-eval/server/lifecycle.ts';
import type { AppointmentRow, SlotRow } from '../../../shared/voice-eval/types.ts';

const SLOT_COLUMNS = 'id,provider_id,department_id,slot_start,slot_end,duration_min,status,appointment_id,visit_types_allowed';
const APPOINTMENT_COLUMNS = 'id,patient_id,provider_id,department_id,start_at,duration_min,status,visit_type,visit_type_code,reason,confirmation_number,booked_via,slot_id,referral_id,eval_run_id,created_at';

export function createEhrRestStore(baseUrl: string, serviceKey: string): EhrStore {
  const root = `${baseUrl.replace(/\/$/, '')}/rest/v1/`;
  const enc = encodeURIComponent;
  const inList = (ids: string[]) => `(${ids.map(enc).join(',')})`;

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${root}${path}`, {
      ...init,
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
    });
    const text = await response.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
      if (response.ok) throw new Error(`EHR returned a non-JSON response (${response.status})`);
    }
    if (!response.ok) throw new Error((body && typeof body === 'object' && 'message' in body ? String(body.message) : '') || `EHR request failed (${response.status})`);
    return body;
  }

  return {
    async findPatientByMrn(mrn) {
      const rows = await request(`epic_patients?select=id&mrn=eq.${enc(mrn)}&limit=1`);
      return Array.isArray(rows) && rows[0] ? { id: rows[0].id } : null;
    },
    async findOpenReferral(patientId) {
      const rows = await request(`epic_referrals?select=id&patient_id=eq.${enc(patientId)}&status=eq.open&order=ordered_at.desc&limit=1`);
      return Array.isArray(rows) && rows[0] ? { id: rows[0].id } : null;
    },
    async listOpenFutureSlots(visitType, fromIso) {
      const rows = await request(`epic_provider_schedule_slots?select=${SLOT_COLUMNS}&status=eq.open&slot_start=gte.${enc(fromIso)}&visit_types_allowed=cs.${enc(`{${visitType}}`)}&order=slot_start.asc&limit=200`);
      return (Array.isArray(rows) ? rows : []) as SlotRow[];
    },
    async listFutureSlotStarts(providerId, fromIso) {
      const rows = await request(`epic_provider_schedule_slots?select=slot_start&provider_id=eq.${enc(providerId)}&slot_start=gte.${enc(fromIso)}&limit=1000`);
      return (Array.isArray(rows) ? rows : []).map((row: { slot_start: string }) => new Date(row.slot_start).toISOString());
    },
    async insertSlots(rows) {
      if (!rows.length) return;
      const now = new Date().toISOString();
      await request('epic_provider_schedule_slots', {
        method: 'POST',
        body: JSON.stringify(rows.map((row) => ({ ...row, held_by_session_id: null, held_until: null, created_at: now, updated_at: now })))
      });
    },
    async claimSlot(slotId, holderId, heldUntil) {
      const patched = await request(`epic_provider_schedule_slots?id=eq.${enc(slotId)}&status=eq.open`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'held', held_by_session_id: holderId, held_until: heldUntil, updated_at: new Date().toISOString() })
      });
      return Array.isArray(patched) && patched.length === 1;
    },
    async linkSlot(slotId, holderId, appointmentId) {
      const patched = await request(`epic_provider_schedule_slots?id=eq.${enc(slotId)}&status=eq.held&held_by_session_id=eq.${enc(holderId)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'booked', appointment_id: appointmentId, held_by_session_id: null, held_until: null, updated_at: new Date().toISOString() })
      });
      return Array.isArray(patched) && patched.length === 1;
    },
    async unclaimSlot(slotId, holderId) {
      await request(`epic_provider_schedule_slots?id=eq.${enc(slotId)}&status=eq.held&held_by_session_id=eq.${enc(holderId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'open', held_by_session_id: null, held_until: null, updated_at: new Date().toISOString() })
      });
    },
    async insertAppointment(row) {
      await request('epic_appointments', { method: 'POST', body: JSON.stringify(row) });
    },
    async listTaggedAppointments(evalRunId) {
      const rows = await request(`epic_appointments?select=${APPOINTMENT_COLUMNS}&eval_run_id=eq.${enc(evalRunId)}`);
      return (Array.isArray(rows) ? rows : []) as AppointmentRow[];
    },
    async listSlotsByIds(ids) {
      if (!ids.length) return [];
      const rows = await request(`epic_provider_schedule_slots?select=${SLOT_COLUMNS}&id=in.${inList(ids)}`);
      return (Array.isArray(rows) ? rows : []) as SlotRow[];
    },
    async releaseSlotsForAppointments(appointmentIds) {
      if (!appointmentIds.length) return;
      await request(`epic_provider_schedule_slots?appointment_id=in.${inList(appointmentIds)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'open', appointment_id: null, held_by_session_id: null, held_until: null, updated_at: new Date().toISOString() })
      });
    },
    async releaseHoldsForPatient(patientId) {
      await request(`epic_provider_schedule_slots?status=eq.held&held_by_session_id=eq.${enc(patientId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'open', held_by_session_id: null, held_until: null, updated_at: new Date().toISOString() })
      });
    },
    async deleteTaggedAppointments(evalRunId) {
      const rows = await request(`epic_appointments?eval_run_id=eq.${enc(evalRunId)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
      return Array.isArray(rows) ? rows.length : 0;
    },
    async listStaleTaggedRunIds(olderThanIso) {
      const rows = await request(`epic_appointments?select=eval_run_id&eval_run_id=not.is.null&created_at=lt.${enc(olderThanIso)}&limit=500`);
      return [...new Set((Array.isArray(rows) ? rows : []).map((row: { eval_run_id: string }) => row.eval_run_id))];
    }
  };
}
