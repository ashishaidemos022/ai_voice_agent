import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import {
  HEALTHCARE_DEMO_PATIENT_REFERENCE,
  HEALTHCARE_TOOL_PARAMETERS,
  JEV_DEFAULT_PRICING,
  estimateJevCostUsd,
  healthcareJevQuestions,
  hasEmergencyLanguage,
  safeHealthcareAction,
  type HealthcareAction,
  type HealthcareJevResult,
  type JevPricing,
  type JevTelemetry
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

function pricingRate(name: string, fallback: number) {
  const parsed = Number(Deno.env.get(name));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const JEV_PRICING: JevPricing = {
  inputUsdPerMillionTokens: pricingRate('TYPESAFE_JEV_INPUT_USD_PER_MTOK', JEV_DEFAULT_PRICING.inputUsdPerMillionTokens),
  outputUsdPerMillionTokens: pricingRate('TYPESAFE_JEV_OUTPUT_USD_PER_MTOK', JEV_DEFAULT_PRICING.outputUsdPerMillionTokens)
};

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase service role credentials are missing');
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type JsonRecord = Record<string, any>;
const PATIENT_TIME_ZONE = 'America/Chicago';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

async function ehrRequest(path: string, init: RequestInit = {}) {
  if (!EHR_SUPABASE_URL || !EHR_SUPABASE_SERVICE_ROLE_KEY) throw new Error('EHR connection is not configured');
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
  if (!response.ok) throw new Error(asRecord(body).message as string || `EHR request failed (${response.status})`);
  return body;
}

async function loadPatientAccess() {
  const patientRows = await ehrRequest(
    `epic_patients?select=id,mrn,first_name,last_name,dob,postal_code&mrn=eq.${encodeURIComponent(HEALTHCARE_DEMO_PATIENT_REFERENCE)}&limit=1`
  );
  const patient = Array.isArray(patientRows) ? patientRows[0] : null;
  if (!patient?.id) throw new Error('Configured patient record was not found');

  const [referralRows, appointmentRows, slotRows] = await Promise.all([
    ehrRequest(
      `epic_referrals?select=id,target_specialty,urgency,status,ordered_at&patient_id=eq.${encodeURIComponent(patient.id)}&status=eq.open&order=ordered_at.desc`
    ),
    ehrRequest(
      `epic_appointments?select=id,start_at,duration_min,status,visit_type,visit_type_code,reason,confirmation_number,slot_id,referral_id,provider:epic_providers(first_name,last_name,specialty),department:epic_departments(name,phone,location:epic_locations(name,address,phone))&patient_id=eq.${encodeURIComponent(patient.id)}&status=in.(scheduled,confirmed)&start_at=gte.${encodeURIComponent(new Date().toISOString())}&order=start_at.asc`
    ),
    ehrRequest(
      `epic_provider_schedule_slots?select=id,slot_start,slot_end,duration_min,status,provider_id,department_id,visit_types_allowed,provider:epic_providers(first_name,last_name,specialty),department:epic_departments(name,phone,location:epic_locations(name,address,phone))&status=eq.open&slot_start=gte.${encodeURIComponent(new Date().toISOString())}&visit_types_allowed=cs.${encodeURIComponent('{CARDIOLOGY_CONSULT}')}&order=slot_start.asc&limit=8`
    )
  ]);

  return {
    patient,
    referrals: Array.isArray(referralRows) ? referralRows : [],
    appointments: Array.isArray(appointmentRows) ? appointmentRows : [],
    slots: Array.isArray(slotRows) ? slotRows : []
  };
}

function normalizeDate(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  const parsed = new Date(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(parsed.getTime()) ? text : '';
}

function verifyPatient(patient: JsonRecord, dateOfBirth: unknown, postalCode: unknown) {
  const suppliedDob = normalizeDate(dateOfBirth);
  const suppliedPostal = typeof postalCode === 'string' ? postalCode.trim().replace(/\s+/g, '').toUpperCase() : '';
  const expectedDob = typeof patient.dob === 'string' ? patient.dob.slice(0, 10) : '';
  const expectedPostal = typeof patient.postal_code === 'string'
    ? patient.postal_code.trim().replace(/\s+/g, '').toUpperCase()
    : '';
  return Boolean(suppliedDob && suppliedPostal && suppliedDob === expectedDob && suppliedPostal === expectedPostal);
}

function localDateTime(value: unknown) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return null;
  const display = new Intl.DateTimeFormat('en-US', {
    timeZone: PATIENT_TIME_ZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PATIENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return {
    display,
    local_date: `${part('year')}-${part('month')}-${part('day')}`,
    local_time: `${part('hour')}:${part('minute')} ${part('dayPeriod')}`,
    timezone: PATIENT_TIME_ZONE,
    timezone_abbreviation: part('timeZoneName')
  };
}

async function evaluateWithJev(params: {
  utterance: string;
  action: HealthcareAction;
  verified: boolean;
  hasUpcomingAppointment: boolean;
  hasOpenReferral: boolean;
  availableSlotCount: number;
  appointmentSelected: boolean;
  selectedSlotProvided: boolean;
  confirmed: boolean;
}): Promise<{ result: HealthcareJevResult; telemetry: JevTelemetry }> {
  if (!TYPESAFE_API_KEY) throw new Error('TypeSafe connection is not configured');
  const startedAt = Date.now();
  const response = await fetch(`${TYPESAFE_BASE_URL}/systemone`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'jev-latest',
      state: {
        latest_patient_utterance: params.utterance,
        workflow: {
          requested_action: params.action,
          identity_verified: params.verified,
          upcoming_appointment_found: params.hasUpcomingAppointment,
          open_referral_found: params.hasOpenReferral,
          eligible_appointment_count: params.availableSlotCount,
          appointment_selected: params.appointmentSelected,
          exact_slot_selected: params.selectedSlotProvided,
          patient_explicitly_confirmed: params.confirmed
        }
      },
      questions: healthcareJevQuestions(params)
    })
  });
  const body = await response.json();
  const latencyMs = Date.now() - startedAt;
  if (!response.ok) throw new Error(asRecord(asRecord(body).error).message as string || `Jev request failed (${response.status})`);
  const result = body as HealthcareJevResult;
  return { result, telemetry: jevTelemetry(result, latencyMs) };
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function jevTelemetry(result: HealthcareJevResult, latencyMs: number): JevTelemetry {
  const usage = asRecord(result.usage);
  const inputTokens = numberOrNull(usage.input_tokens);
  const outputTokens = numberOrNull(usage.output_tokens);
  const billedCost = numberOrNull(usage.cost_usd);
  const estimatedCost = estimateJevCostUsd(inputTokens, outputTokens, JEV_PRICING);
  return {
    model: result.model || null,
    latency_ms: latencyMs,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: numberOrNull(usage.total_tokens)
      ?? (inputTokens === null && outputTokens === null ? null : (inputTokens || 0) + (outputTokens || 0)),
    cost_usd: billedCost ?? estimatedCost,
    cost_kind: billedCost !== null ? 'billed' : estimatedCost !== null ? 'estimated' : null,
    pricing: JEV_PRICING
  };
}

function publicAppointment(appointment: JsonRecord) {
  return {
    appointment_id: appointment.id,
    starts_at: appointment.start_at,
    local_start: localDateTime(appointment.start_at),
    duration_min: appointment.duration_min,
    status: appointment.status,
    visit_type: appointment.visit_type,
    reason: appointment.reason,
    confirmation_number: appointment.confirmation_number,
    provider: appointment.provider,
    department: appointment.department
  };
}

function publicSlot(slot: JsonRecord) {
  return {
    slot_id: slot.id,
    starts_at: slot.slot_start,
    ends_at: slot.slot_end,
    local_start: localDateTime(slot.slot_start),
    local_end: localDateTime(slot.slot_end),
    duration_min: slot.duration_min,
    provider: slot.provider,
    department: slot.department,
    visit_type: 'CARDIOLOGY_CONSULT',
    modality: 'in_person'
  };
}

async function reserveSlot(slot: JsonRecord, appointmentId: string) {
  const patched = await ehrRequest(`epic_provider_schedule_slots?id=eq.${encodeURIComponent(slot.id)}&status=eq.open`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'booked', appointment_id: appointmentId, updated_at: new Date().toISOString() })
  });
  if (!Array.isArray(patched) || patched.length !== 1) throw new Error('That appointment time is no longer available');
}

async function releaseSlot(slotId: string, appointmentId: string) {
  await ehrRequest(`epic_provider_schedule_slots?id=eq.${encodeURIComponent(slotId)}&appointment_id=eq.${appointmentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'open', appointment_id: null, updated_at: new Date().toISOString() })
  }).catch(() => undefined);
}

async function createAppointment(params: {
  patientId: string;
  referral: JsonRecord;
  slot: JsonRecord;
  bookedVia: string;
}) {
  const appointmentId = crypto.randomUUID();
  const confirmationNumber = `HLS-${String(params.slot.id).slice(-4).toUpperCase()}`;
  await reserveSlot(params.slot, appointmentId);
  try {
    const rows = await ehrRequest('epic_appointments', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        id: appointmentId,
        patient_id: params.patientId,
        provider_id: params.slot.provider_id,
        department_id: params.slot.department_id,
        start_at: params.slot.slot_start,
        duration_min: params.slot.duration_min,
        status: 'scheduled',
        visit_type: 'Cardiology Consult',
        visit_type_code: 'CARDIOLOGY_CONSULT',
        reason: 'Cardiology referral visit',
        confirmation_number: confirmationNumber,
        booked_via: params.bookedVia,
        slot_id: params.slot.id,
        referral_id: params.referral.id
      })
    });
    return Array.isArray(rows) ? rows[0] : null;
  } catch (error) {
    await releaseSlot(params.slot.id, appointmentId);
    throw error;
  }
}

async function executeConfirmedAction(params: {
  action: HealthcareAction;
  patient: JsonRecord;
  referrals: JsonRecord[];
  appointments: JsonRecord[];
  slots: JsonRecord[];
  appointmentId: string;
  selectedSlotId: string;
}) {
  const referral = params.referrals[0];
  const appointment = params.appointments.find((row) => row.id === params.appointmentId);
  const slot = params.slots.find((row) => row.id === params.selectedSlotId);

  if (params.action === 'cancel_appointment') {
    if (!appointment) throw new Error('Select an upcoming appointment before confirming cancellation');
    const changed = await ehrRequest(`epic_appointments?id=eq.${encodeURIComponent(appointment.id)}&status=in.(scheduled,confirmed)`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'cancelled' })
    });
    if (!Array.isArray(changed) || changed.length !== 1) throw new Error('That appointment can no longer be cancelled');
    if (appointment.slot_id) await releaseSlot(appointment.slot_id, appointment.id);
    return { type: 'cancelled', appointment: publicAppointment({ ...appointment, status: 'cancelled' }) };
  }

  if (!slot) throw new Error('Select one of the currently offered appointment times');
  if (!referral) throw new Error('No open referral is available for scheduling');
  const created = await createAppointment({
    patientId: params.patient.id,
    referral,
    slot,
    bookedVia: 'agent'
  });

  if (params.action === 'reschedule_appointment') {
    if (!appointment) {
      await ehrRequest(`epic_appointments?id=eq.${encodeURIComponent(created.id)}`, { method: 'DELETE' }).catch(() => undefined);
      await releaseSlot(slot.id, created.id);
      throw new Error('Select the existing appointment before confirming a new time');
    }
    await ehrRequest(`epic_appointments?id=eq.${encodeURIComponent(appointment.id)}&status=in.(scheduled,confirmed)`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'rescheduled' })
    });
    if (appointment.slot_id) await releaseSlot(appointment.slot_id, appointment.id);
    return { type: 'rescheduled', previous_appointment_id: appointment.id, appointment: publicAppointment({ ...created, provider: slot.provider, department: slot.department }) };
  }

  return { type: 'booked', appointment: publicAppointment({ ...created, provider: slot.provider, department: slot.department }) };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  const requestStartedAt = Date.now();
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
    const action = body.action as HealthcareAction;
    const allowedActions = new Set(HEALTHCARE_TOOL_PARAMETERS.properties.action.enum);
    const appointmentId = typeof body.appointment_id === 'string' ? body.appointment_id.trim() : '';
    const selectedSlotId = typeof body.selected_slot_id === 'string' ? body.selected_slot_id.trim() : '';
    const confirmed = body.confirmed === true;
    if (!utterance) return jsonResponse({ error: 'utterance is required' }, 400);
    if (!allowedActions.has(action)) return jsonResponse({ error: 'A valid patient-access action is required' }, 400);
    if (patientReference !== HEALTHCARE_DEMO_PATIENT_REFERENCE) return jsonResponse({ error: 'Patient reference not found' }, 404);

    const ehrStartedAt = Date.now();
    const access = await loadPatientAccess();
    const ehrLatencyMs = Date.now() - ehrStartedAt;
    const verified = verifyPatient(access.patient, body.date_of_birth, body.postal_code);
    const selectedAppointment = access.appointments.find((row) => row.id === appointmentId);
    const eligibleSlots = action === 'reschedule_appointment'
      ? selectedAppointment
        ? access.slots.filter((slot) => Array.isArray(slot.visit_types_allowed) && slot.visit_types_allowed.includes(selectedAppointment.visit_type_code))
        : []
      : access.slots;
    const context = {
      action,
      verified,
      utterance,
      hasUpcomingAppointment: access.appointments.length > 0,
      hasOpenReferral: access.referrals.length > 0,
      availableSlotCount: eligibleSlots.length,
      appointmentSelected: Boolean(appointmentId),
      selectedSlotProvided: Boolean(selectedSlotId),
      confirmed
    };
    const { result: jev, telemetry } = await evaluateWithJev(context);
    const policy = safeHealthcareAction({
      ...context,
      jev,
      referralSpecialty: access.referrals[0]?.target_specialty,
      availableModalities: ['in_person']
    });

    const change = policy.mayMutate
      ? await executeConfirmedAction({
          action,
          patient: access.patient,
          referrals: access.referrals,
          appointments: access.appointments,
          slots: eligibleSlots,
          appointmentId,
          selectedSlotId
        })
      : null;

    if (!verified) {
      return jsonResponse({
        verification: { verified: false, required: ['date_of_birth', 'postal_code'] },
        decision: {
          intent: jev.answers.intent,
          next_step: { ...jev.answers.next_step, applied: policy.nextStep },
          needs_human_review: jev.answers.needs_human_review,
          policy_reason: policy.reason,
          emergency_language_detected: hasEmergencyLanguage(utterance),
          model: jev.model,
          answers: jev.answers
        },
        action: { status: 'verification_required', next_step: policy.nextStep },
        jev: telemetry,
        timing: {
          jev_ms: telemetry.latency_ms,
          ehr_ms: ehrLatencyMs,
          total_ms: Date.now() - requestStartedAt
        },
        jev_usage: jev.usage || null
      });
    }

    return jsonResponse({
      verification: { verified: true, patient: { first_name: access.patient.first_name, last_name: access.patient.last_name } },
      decision: {
        intent: jev.answers.intent,
        next_step: { ...jev.answers.next_step, applied: change ? `appointment_${change.type}` : policy.nextStep },
        needs_human_review: jev.answers.needs_human_review,
        policy_reason: policy.reason,
        emergency_language_detected: hasEmergencyLanguage(utterance),
        model: jev.model,
        answers: jev.answers
      },
      ehr: {
        appointments: access.appointments.map(publicAppointment),
        referrals: access.referrals,
        eligible_slots: eligibleSlots.map(publicSlot)
      },
      change,
      action: change ? { status: 'completed', next_step: 'share_confirmation' } : { status: 'ready', next_step: policy.nextStep },
      sources: ['Supabase_EHR MCP', 'epic_patients', 'epic_appointments', 'epic_referrals', 'epic_provider_schedule_slots'],
      jev: telemetry,
      timing: {
        jev_ms: telemetry.latency_ms,
        ehr_ms: ehrLatencyMs,
        total_ms: Date.now() - requestStartedAt
      },
      jev_usage: jev.usage || null
    });
  } catch (error) {
    console.error('[healthcare-patient-access]', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Patient-access workflow failed' }, 500);
  }
});
