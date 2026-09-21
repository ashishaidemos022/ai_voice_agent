import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEALTHCARE_DEMO_PATIENT_REFERENCE,
  HEALTHCARE_TOOL_PARAMETERS,
  emergencyEscalation,
  estimateJevCostUsd,
  hasEmergencyLanguage,
  safeHealthcareAction,
  type HealthcareJevResult
} from '../shared/healthcare-demo.ts';

function jev(overrides: Partial<HealthcareJevResult['answers']> = {}): HealthcareJevResult {
  return {
    model: 'jev-test',
    answers: {
      intent: { type: 'choice', choice: 'appointment_lookup', confidence: 0.92 },
      next_step: { type: 'choice', choice: 'lookup_appointments', confidence: 0.9 },
      needs_human_review: { type: 'noul', noul: 0.04 },
      ...overrides
    }
  };
}

const base = {
  utterance: 'When is my next appointment?',
  action: 'lookup_appointments' as const,
  verified: true,
  jev: jev(),
  hasUpcomingAppointment: true,
  hasOpenReferral: true,
  availableSlotCount: 3,
  appointmentSelected: false,
  selectedSlotProvided: false,
  confirmed: false,
  referralSpecialty: 'Cardiology consult',
  availableModalities: ['in_person']
};

test('patient-access tool requires an action and verification inputs are optional', () => {
  assert.equal(HEALTHCARE_DEMO_PATIENT_REFERENCE, 'DEMO-1001');
  assert.deepEqual(HEALTHCARE_TOOL_PARAMETERS.required, ['utterance', 'patient_reference', 'action']);
  assert.equal(HEALTHCARE_TOOL_PARAMETERS.additionalProperties, false);
  assert.ok(HEALTHCARE_TOOL_PARAMETERS.properties.action.enum.includes('reschedule_appointment'));
});

test('protected EHR workflows require identity verification', () => {
  assert.deepEqual(safeHealthcareAction({ ...base, verified: false }), {
    nextStep: 'verify_identity', reason: 'identity_verification_required', mayMutate: false, urgency: 'routine'
  });
  assert.deepEqual(safeHealthcareAction(base), {
    nextStep: 'lookup_appointments', reason: 'identity_verified', mayMutate: false, urgency: 'routine'
  });
});

test('booking, rescheduling, and cancellation require exact explicit confirmation', () => {
  assert.equal(safeHealthcareAction({ ...base, action: 'book_appointment' }).mayMutate, false);
  assert.equal(safeHealthcareAction({
    ...base, action: 'book_appointment', selectedSlotProvided: true, confirmed: true
  }).mayMutate, true);
  assert.equal(safeHealthcareAction({
    ...base, action: 'reschedule_appointment', appointmentSelected: true, selectedSlotProvided: true, confirmed: true
  }).nextStep, 'confirm_reschedule');
  assert.equal(safeHealthcareAction({
    ...base, action: 'reschedule_appointment', appointmentSelected: false
  }).reason, 'appointment_selection_required');
  assert.equal(safeHealthcareAction({
    ...base, action: 'cancel_appointment', appointmentSelected: true, confirmed: true
  }).nextStep, 'confirm_cancellation');
});

test('clinical, uncertain, emergency, and human requests route to staff', () => {
  const clinical = jev({ intent: { type: 'choice', choice: 'clinical_question', confidence: 0.98 } });
  assert.equal(safeHealthcareAction({ ...base, utterance: 'What does this result mean?', jev: clinical }).reason, 'clinical_request');
  const uncertain = jev({ intent: { type: 'choice', choice: 'appointment_lookup', confidence: 0.4 } });
  assert.equal(safeHealthcareAction({ ...base, jev: uncertain }).reason, 'low_confidence');
  assert.equal(hasEmergencyLanguage('I have chest pain and cannot breathe'), true);
  assert.equal(safeHealthcareAction({ ...base, utterance: 'I have chest pain right now.' }).reason, 'emergency_symptoms');
  assert.equal(safeHealthcareAction({ ...base, action: 'request_staff' }).reason, 'human_requested');
});

test('a specialty or modality mismatch never offers cardiology slots', () => {
  assert.equal(safeHealthcareAction({
    ...base,
    action: 'search_availability',
    utterance: 'My dermatology referral needs an afternoon appointment.'
  }).reason, 'referral_specialty_mismatch');
  assert.equal(safeHealthcareAction({
    ...base,
    action: 'search_availability',
    utterance: 'Can the cardiology appointment be a video visit?'
  }).reason, 'unsupported_modality');
});

test('Jev cost estimates price reported tokens and stay null without usage', () => {
  const pricing = { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 4 };
  assert.equal(estimateJevCostUsd(1_000_000, 500_000, pricing), 4);
  assert.equal(estimateJevCostUsd(1_000, null, pricing), 0.002);
  assert.equal(estimateJevCostUsd(null, undefined, pricing), null);
  assert.equal(estimateJevCostUsd(undefined, undefined), null);
});

test('chest pain escalates to staff as an emergency before any other gate', () => {
  const routine = jev({ symptom_acuity: { type: 'noul', noul: 0.02 } });
  const chestPain = safeHealthcareAction({
    ...base,
    utterance: 'I have chest pain right now.',
    jev: routine
  });
  assert.equal(chestPain.urgency, 'emergency');
  assert.equal(chestPain.nextStep, 'route_to_staff');
  assert.equal(chestPain.reason, 'emergency_symptoms');
  assert.equal(chestPain.mayMutate, false);

  // An unverified caller reporting chest pain is escalated, not asked for date of birth.
  assert.equal(safeHealthcareAction({
    ...base, verified: false, utterance: 'My chest hurts and I feel dizzy.', jev: routine
  }).nextStep, 'route_to_staff');

  // Emergency outranks an otherwise-complete confirmed booking.
  const confirmedBooking = safeHealthcareAction({
    ...base,
    action: 'book_appointment',
    utterance: 'I have chest pain but I still want to book the cardiology slot.',
    selectedSlotProvided: true,
    confirmed: true,
    jev: routine
  });
  assert.equal(confirmedBooking.mayMutate, false);
  assert.equal(confirmedBooking.urgency, 'emergency');
});

test('Jev symptom acuity escalates wording the keyword list misses', () => {
  const paraphrase = 'There is a lot of pressure in my chest and my arm feels heavy.';
  assert.equal(hasEmergencyLanguage(paraphrase), false);

  const acute = safeHealthcareAction({
    ...base,
    utterance: paraphrase,
    jev: jev({ symptom_acuity: { type: 'noul', noul: 0.82 } })
  });
  assert.equal(acute.urgency, 'emergency');
  assert.equal(acute.reason, 'emergency_symptoms');
  assert.equal(acute.mayMutate, false);

  // Keyword language still escalates even when Jev scores the turn as low acuity.
  assert.equal(safeHealthcareAction({
    ...base,
    utterance: 'I have chest pain.',
    jev: jev({ symptom_acuity: { type: 'noul', noul: 0.01 } })
  }).urgency, 'emergency');
});

test('a low acuity score leaves the ordinary workflow untouched', () => {
  const calm = jev({ symptom_acuity: { type: 'noul', noul: 0.03 } });
  const lookup = safeHealthcareAction({ ...base, jev: calm });
  assert.equal(lookup.urgency, 'routine');
  assert.equal(lookup.nextStep, 'lookup_appointments');

  // A missing acuity answer must not escalate on its own.
  const withoutAcuity = safeHealthcareAction(base);
  assert.equal(withoutAcuity.urgency, 'routine');
  assert.equal(withoutAcuity.nextStep, 'lookup_appointments');
});

test('the emergency escalation payload tells the agent to stop and hand off', () => {
  const escalation = emergencyEscalation({ acuityScore: 0.82, callbackNumber: '+1-214-555-0143' });
  assert.equal(escalation.priority, 'emergency');
  assert.equal(escalation.connect_to, 'staff');
  assert.equal(escalation.acuity_score, 0.82);
  assert.equal(escalation.callback_number, '+1-214-555-0143');
  assert.match(escalation.instruction, /911/);
  assert.match(escalation.instruction, /stop/i);

  // Without a verified caller there is no clinic number to read back.
  assert.equal(emergencyEscalation({ acuityScore: 0.9 }).callback_number, null);
});
