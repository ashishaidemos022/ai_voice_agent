import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import {
  HEALTHCARE_DEMO_PATIENT_REFERENCE,
  healthcareJevQuestions,
  hasEmergencyLanguage,
  safeHealthcareAction,
  type HealthcareJevResult
} from '../../../shared/healthcare-demo.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TYPESAFE_API_KEY = Deno.env.get('TYPESAFE_API_KEY');
const TYPESAFE_BASE_URL = Deno.env.get('TYPESAFE_BASE_URL') || 'https://api.typesafe.ai/v1';
const EHR_SUPABASE_URL = Deno.env.get('EHR_SUPABASE_URL');
const EHR_SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('EHR_SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase service role credentials are missing');
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type JsonRecord = Record<string, unknown>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

async function ehrRequest(path: string, init: RequestInit = {}) {
  if (!EHR_SUPABASE_URL || !EHR_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Ashish_EHR connection is not configured');
  }
  const response = await fetch(`${EHR_SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: EHR_SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${EHR_SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(asRecord(body).message as string || `Ashish_EHR request failed (${response.status})`);
  }
  return body;
}

async function loadDemoPatientAccess() {
  const patientRows = await ehrRequest(`epic_patients?select=id,mrn,first_name&mrn=eq.${encodeURIComponent(HEALTHCARE_DEMO_PATIENT_REFERENCE)}&limit=1`);
  const patient = Array.isArray(patientRows) ? patientRows[0] : null;
  if (!patient?.id) throw new Error('Synthetic healthcare demo patient is not seeded');

  const referralRows = await ehrRequest(
    `epic_referrals?select=id,target_specialty,urgency,status,ordered_at&patient_id=eq.${encodeURIComponent(patient.id)}&status=eq.open&order=ordered_at.desc&limit=1`
  );
  const referral = Array.isArray(referralRows) ? referralRows[0] : null;
  const slotRows = referral
    ? await ehrRequest(
        `epic_provider_schedule_slots?select=id,slot_start,slot_end,duration_min,status,provider_id,department_id,visit_types_allowed,provider:epic_providers(first_name,last_name,specialty)&status=eq.open&slot_start=gte.${encodeURIComponent(new Date().toISOString())}&visit_types_allowed=cs.${encodeURIComponent('{CARDIOLOGY_CONSULT}')}&order=slot_start.asc&limit=5`
      )
    : [];

  return {
    patient: { id: patient.id, reference: patient.mrn, first_name: patient.first_name },
    referral,
    slots: Array.isArray(slotRows) ? slotRows : []
  };
}

async function evaluateWithJev(params: {
  utterance: string;
  hasOpenReferral: boolean;
  availableSlotCount: number;
  selectedSlotProvided: boolean;
  confirmed: boolean;
}): Promise<HealthcareJevResult> {
  if (!TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY is not configured');
  const response = await fetch(`${TYPESAFE_BASE_URL}/systemone`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TYPESAFE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'jev-latest',
      state: {
        latest_patient_utterance: params.utterance,
        demo_workflow: {
          synthetic_patient: true,
          open_referral_found: params.hasOpenReferral,
          eligible_appointment_count: params.availableSlotCount,
          exact_slot_selected: params.selectedSlotProvided,
          patient_explicitly_confirmed: params.confirmed
        }
      },
      questions: healthcareJevQuestions(params)
    })
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(asRecord(asRecord(body).error).message as string || `Jev request failed (${response.status})`);
  }
  return body as HealthcareJevResult;
}

async function confirmDemoAppointment(params: {
  patient: { id: string; reference: string; first_name: string };
  referral: JsonRecord;
  slots: JsonRecord[];
  selectedSlotId: string;
}) {
  const selected = params.slots.find((slot) => slot.id === params.selectedSlotId);
  if (!selected) throw new Error('Select one of the currently offered synthetic demo slots');
  const appointmentId = crypto.randomUUID();
  const confirmationNumber = `HLS-DEMO-${String(selected.id).slice(-4).toUpperCase()}`;
  const patched = await ehrRequest(
    `epic_provider_schedule_slots?id=eq.${encodeURIComponent(params.selectedSlotId)}&status=eq.open`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'booked', appointment_id: appointmentId, updated_at: new Date().toISOString() })
    }
  );
  if (!Array.isArray(patched) || patched.length !== 1) {
    throw new Error('That demo slot is no longer available');
  }
  try {
    await ehrRequest('epic_appointments', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        id: appointmentId,
        patient_id: params.patient.id,
        provider_id: selected.provider_id,
        department_id: selected.department_id,
        start_at: selected.slot_start,
        duration_min: selected.duration_min,
        status: 'scheduled',
        visit_type: 'Cardiology Consult',
        visit_type_code: 'CARDIOLOGY_CONSULT',
        reason: 'Synthetic patient-access showcase',
        chief_complaint: 'Administrative scheduling demo',
        confirmation_number: confirmationNumber,
        booked_via: 'GPT-Live-1 + Jev healthcare demo',
        slot_id: selected.id,
        referral_id: params.referral.id
      })
    });
  } catch (error) {
    await ehrRequest(`epic_provider_schedule_slots?id=eq.${encodeURIComponent(params.selectedSlotId)}&appointment_id=eq.${appointmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'open', appointment_id: null, updated_at: new Date().toISOString() })
    }).catch(() => undefined);
    throw error;
  }
  return {
    status: 'scheduled',
    confirmation_number: confirmationNumber,
    starts_at: selected.slot_start,
    provider: selected.provider,
    appointment_id: appointmentId
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return jsonResponse({ error: 'Authentication required' }, 401);
    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData.user) return jsonResponse({ error: 'Invalid session' }, 401);
    const { data: vaUser } = await adminClient.from('va_users').select('id').eq('auth_user_id', authData.user.id).maybeSingle();
    if (!vaUser) return jsonResponse({ error: 'User profile not found' }, 403);

    const body = asRecord(await req.json().catch(() => ({})));
    const utterance = typeof body.utterance === 'string' ? body.utterance.trim() : '';
    const patientReference = typeof body.patient_reference === 'string' ? body.patient_reference.trim().toUpperCase() : '';
    const selectedSlotId = typeof body.selected_slot_id === 'string' ? body.selected_slot_id.trim() : '';
    const confirmed = body.confirmed === true;
    if (!utterance) return jsonResponse({ error: 'utterance is required' }, 400);
    if (patientReference !== HEALTHCARE_DEMO_PATIENT_REFERENCE) {
      return jsonResponse({
        error: `This showcase is restricted to the synthetic patient reference ${HEALTHCARE_DEMO_PATIENT_REFERENCE}.`
      }, 400);
    }

    const access = await loadDemoPatientAccess();
    const selectedSlotProvided = Boolean(selectedSlotId);
    const context = {
      utterance,
      hasOpenReferral: Boolean(access.referral),
      availableSlotCount: access.slots.length,
      selectedSlotProvided,
      confirmed
    };
    const jev = await evaluateWithJev(context);
    const policy = safeHealthcareAction({ ...context, jev });
    const appointment = policy.mayBook && selectedSlotId
      ? await confirmDemoAppointment({
          patient: access.patient,
          referral: access.referral,
          slots: access.slots,
          selectedSlotId
        })
      : null;

    return jsonResponse({
      demo: true,
      synthetic_patient: true,
      clinical_use: false,
      decision: {
        intent: jev.answers.intent,
        next_step: { ...jev.answers.next_step, applied: appointment ? 'appointment_scheduled' : policy.nextStep },
        needs_human_review: jev.answers.needs_human_review,
        policy_reason: policy.reason,
        emergency_language_detected: hasEmergencyLanguage(utterance),
        model: jev.model
      },
      patient: { reference: access.patient.reference, first_name: access.patient.first_name },
      ehr: {
        referral: access.referral,
        eligible_slots: access.slots.map((slot: JsonRecord) => ({
          slot_id: slot.id,
          starts_at: slot.slot_start,
          ends_at: slot.slot_end,
          duration_min: slot.duration_min,
          provider: slot.provider,
          visit_type: 'CARDIOLOGY_CONSULT',
          modality: 'in_person'
        }))
      },
      appointment,
      action: appointment
        ? { status: 'completed', next_step: 'share_confirmation' }
        : { status: 'ready', next_step: policy.nextStep },
      sources: [
        'Ashish_EHR.epic_patients',
        'Ashish_EHR.epic_referrals',
        'Ashish_EHR.epic_provider_schedule_slots',
        ...(appointment ? ['Ashish_EHR.epic_appointments'] : [])
      ],
      jev_usage: jev.usage || null
    });
  } catch (error) {
    console.error('[healthcare-patient-access]', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Healthcare demo failed' }, 500);
  }
});
