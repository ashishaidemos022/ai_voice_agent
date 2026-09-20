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
      intent: {
        type: 'choice',
        choice: 'schedule_referral',
        confidence: 0.92,
        probabilities: { schedule_referral: 0.92, clinical_question: 0.08 }
      },
      next_step: {
        type: 'choice',
        choice: 'offer_appointments',
        confidence: 0.9,
        probabilities: { offer_appointments: 0.9, route_to_staff: 0.1 }
      },
      needs_human_review: { type: 'noul', noul: 0.04 },
      ...overrides
    }
  };
}

test('healthcare tool is restricted to the synthetic patient workflow', () => {
  assert.equal(HEALTHCARE_DEMO_PATIENT_REFERENCE, 'DEMO-1001');
  assert.deepEqual(HEALTHCARE_TOOL_PARAMETERS.required, ['utterance', 'patient_reference']);
  assert.equal(HEALTHCARE_TOOL_PARAMETERS.additionalProperties, false);
});

test('eligible administrative scheduling offers appointments without booking', () => {
  assert.deepEqual(safeHealthcareAction({
    utterance: 'I have a cardiology referral and need an afternoon appointment.',
    jev: jev(),
    hasOpenReferral: true,
    availableSlotCount: 3,
    selectedSlotProvided: false,
    confirmed: false
  }), {
    nextStep: 'offer_appointments',
    reason: 'eligible_options_found',
    mayBook: false
  });
});

test('booking requires an exact slot and explicit confirmation', () => {
  assert.equal(safeHealthcareAction({
    utterance: 'Thursday works.', jev: jev(), hasOpenReferral: true,
    availableSlotCount: 3, selectedSlotProvided: true, confirmed: false
  }).mayBook, false);
  assert.deepEqual(safeHealthcareAction({
    utterance: 'Yes, confirm Thursday at 1 PM.', jev: jev(), hasOpenReferral: true,
    availableSlotCount: 3, selectedSlotProvided: true, confirmed: true
  }), {
    nextStep: 'confirm_selected_slot',
    reason: 'explicit_confirmation',
    mayBook: true
  });
});

test('clinical, uncertain, and emergency requests route to staff', () => {
  const clinical = jev({ intent: { type: 'choice', choice: 'clinical_question', confidence: 0.98 } });
  assert.equal(safeHealthcareAction({
    utterance: 'Does this mean I have heart disease?', jev: clinical, hasOpenReferral: true,
    availableSlotCount: 3, selectedSlotProvided: false, confirmed: false
  }).nextStep, 'route_to_staff');
  const uncertain = jev({ intent: { type: 'choice', choice: 'schedule_referral', confidence: 0.4 } });
  assert.equal(safeHealthcareAction({
    utterance: 'Maybe something next week.', jev: uncertain, hasOpenReferral: true,
    availableSlotCount: 3, selectedSlotProvided: false, confirmed: false
  }).reason, 'low_confidence');
  assert.equal(hasEmergencyLanguage('I have chest pain and cannot breathe'), true);
  assert.equal(safeHealthcareAction({
    utterance: 'I have chest pain right now.', jev: jev(), hasOpenReferral: true,
    availableSlotCount: 3, selectedSlotProvided: true, confirmed: true
  }).reason, 'emergency_language');
});

test('a specialty or modality mismatch never offers the seeded cardiology slots', () => {
  const base = {
    hasOpenReferral: true,
    availableSlotCount: 3,
    selectedSlotProvided: false,
    confirmed: false,
    referralSpecialty: 'Cardiology consult',
    availableModalities: ['in_person'],
    jev: jev()
  };

  assert.deepEqual(
    safeHealthcareAction({
      ...base,
      utterance: 'My doctor referred me to dermatology and I need an afternoon appointment.'
    }),
    { nextStep: 'route_to_staff', reason: 'referral_specialty_mismatch', mayBook: false }
  );

  assert.deepEqual(
    safeHealthcareAction({
      ...base,
      utterance: 'Can the cardiology appointment be a video visit?'
    }),
    { nextStep: 'route_to_staff', reason: 'unsupported_modality', mayBook: false }
  );
});
