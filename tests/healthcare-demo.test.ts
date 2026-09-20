import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEALTHCARE_DEMO_PATIENT_REFERENCE,
  HEALTHCARE_TOOL_PARAMETERS,
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
    nextStep: 'verify_identity', reason: 'identity_verification_required', mayMutate: false
  });
  assert.deepEqual(safeHealthcareAction(base), {
    nextStep: 'lookup_appointments', reason: 'identity_verified', mayMutate: false
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
    ...base, action: 'cancel_appointment', appointmentSelected: true, confirmed: true
  }).nextStep, 'confirm_cancellation');
});

test('clinical, uncertain, emergency, and human requests route to staff', () => {
  const clinical = jev({ intent: { type: 'choice', choice: 'clinical_question', confidence: 0.98 } });
  assert.equal(safeHealthcareAction({ ...base, utterance: 'What does this result mean?', jev: clinical }).reason, 'clinical_request');
  const uncertain = jev({ intent: { type: 'choice', choice: 'appointment_lookup', confidence: 0.4 } });
  assert.equal(safeHealthcareAction({ ...base, jev: uncertain }).reason, 'low_confidence');
  assert.equal(hasEmergencyLanguage('I have chest pain and cannot breathe'), true);
  assert.equal(safeHealthcareAction({ ...base, utterance: 'I have chest pain right now.' }).reason, 'emergency_language');
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
