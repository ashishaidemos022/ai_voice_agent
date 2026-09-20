export const HEALTHCARE_TOOL_NAME = 'healthcare_patient_access';
export const HEALTHCARE_DEMO_PATIENT_REFERENCE = 'DEMO-1001';

export const HEALTHCARE_TOOL_DESCRIPTION =
  'Use the connected EHR patient-access workflow with Jev for identity verification, appointment and referral lookup, availability, appointment changes, visit logistics, and safe staff escalation. Call this on every substantive patient-access turn. This tool is administrative and must not diagnose, interpret results, recommend treatment, or provide medication advice.';

export type HealthcareAction =
  | 'verify_patient'
  | 'lookup_appointments'
  | 'lookup_referrals'
  | 'search_availability'
  | 'book_appointment'
  | 'reschedule_appointment'
  | 'cancel_appointment'
  | 'visit_logistics'
  | 'request_staff';

export const HEALTHCARE_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    utterance: { type: 'string', description: 'The patient\'s complete latest statement in their own words.' },
    patient_reference: {
      type: 'string',
      description: `The patient reference used by this configured workflow. Use ${HEALTHCARE_DEMO_PATIENT_REFERENCE} internally.`
    },
    action: {
      type: 'string',
      enum: [
        'verify_patient', 'lookup_appointments', 'lookup_referrals', 'search_availability',
        'book_appointment', 'reschedule_appointment', 'cancel_appointment', 'visit_logistics', 'request_staff'
      ],
      description: 'The single administrative action requested for this turn.'
    },
    date_of_birth: {
      type: 'string',
      description: 'Date of birth supplied by the caller, preferably YYYY-MM-DD. Never guess or reveal it.'
    },
    postal_code: {
      type: 'string',
      description: 'Postal code supplied by the caller. Never guess or reveal it.'
    },
    appointment_id: {
      type: 'string',
      description: 'An exact appointment_id previously returned by this tool. Keep it internal.'
    },
    selected_slot_id: {
      type: 'string',
      description: 'An exact slot_id previously returned by this tool. Keep it internal.'
    },
    confirmed: {
      type: 'boolean',
      description: 'True only after the caller explicitly confirms the exact appointment action and date/time during the current conversation.'
    }
  },
  required: ['utterance', 'patient_reference', 'action'],
  additionalProperties: false
} as const;

export type HealthcareIntent =
  | 'verify_identity' | 'appointment_lookup' | 'referral_status' | 'schedule_referral'
  | 'reschedule_appointment' | 'cancel_appointment' | 'visit_logistics'
  | 'billing_or_coverage' | 'clinical_question' | 'human_help' | 'other';

export type HealthcareNextStep =
  | 'verify_identity' | 'lookup_appointments' | 'look_up_referral' | 'offer_appointments'
  | 'confirm_selected_slot' | 'confirm_reschedule' | 'confirm_cancellation'
  | 'provide_visit_logistics' | 'route_to_staff' | 'ask_for_clarification';

export type JevAnswer = {
  type: 'choice' | 'score' | 'noul';
  choice?: string;
  score?: number;
  noul?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, string>;
};

export type HealthcareJevResult = {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export function healthcareJevQuestions(context: {
  action: HealthcareAction;
  verified: boolean;
  hasUpcomingAppointment: boolean;
  hasOpenReferral: boolean;
  availableSlotCount: number;
  appointmentSelected: boolean;
  selectedSlotProvided: boolean;
  confirmed: boolean;
}) {
  return {
    intent: {
      type: 'choice',
      instructions: 'Classify the caller\'s current intent. Choose clinical_question for diagnosis, symptom interpretation, treatment, test-result interpretation, or medication advice.',
      criteria: {
        verify_identity: 'Provide or discuss information needed to verify identity',
        appointment_lookup: 'Find, confirm, or ask about an existing appointment',
        referral_status: 'Check whether a referral exists or is ready',
        schedule_referral: 'Find availability or book care using a referral',
        reschedule_appointment: 'Move an existing appointment to another slot',
        cancel_appointment: 'Cancel an existing appointment',
        visit_logistics: 'Ask about location, arrival, department, provider, or contact details',
        billing_or_coverage: 'Ask about billing, claims, insurance, authorization, or coverage',
        clinical_question: 'Ask for clinical guidance, diagnosis, interpretation, treatment, or medication advice',
        human_help: 'Explicitly ask for a person or staff member',
        other: 'No listed intent clearly applies'
      }
    },
    next_step: {
      type: 'choice',
      instructions: { question: 'Choose the safest next administrative workflow step for this turn.', workflow_state: context },
      criteria: {
        verify_identity: 'Identity must be verified before protected appointment or referral information is disclosed',
        lookup_appointments: 'Return upcoming appointment information after verification',
        look_up_referral: 'Return referral status after verification',
        offer_appointments: 'An open referral exists and eligible appointment options can be offered',
        confirm_selected_slot: 'The caller selected and explicitly confirmed an exact slot for a new appointment',
        confirm_reschedule: 'The caller selected and explicitly confirmed the existing appointment and replacement slot',
        confirm_cancellation: 'The caller explicitly confirmed cancellation of an exact appointment',
        provide_visit_logistics: 'Provide confirmed visit location, department, provider, and phone details',
        route_to_staff: 'Clinical guidance, unsupported work, elevated risk, or a human request requires staff',
        ask_for_clarification: 'Ask one focused question because a required selection or preference is missing'
      }
    },
    needs_human_review: {
      type: 'noul',
      instructions: 'Does this turn require a human because it asks for clinical judgment, contains urgent symptom language, has a consequential ambiguity, requests unsupported work, or explicitly asks for staff?'
    }
  } as const;
}

const EMERGENCY_PHRASES = [
  'chest pain', 'cannot breathe', "can't breathe", 'difficulty breathing', 'passed out',
  'unconscious', 'stroke', 'suicidal', 'overdose', 'severe bleeding'
];

const SPECIALTY_TERMS = [
  'cardiology', 'dermatology', 'neurology', 'orthopedics', 'oncology',
  'gastroenterology', 'endocrinology', 'pulmonology', 'rheumatology', 'urology'
];

export function hasEmergencyLanguage(value: string): boolean {
  const normalized = value.toLowerCase();
  return EMERGENCY_PHRASES.some((phrase) => normalized.includes(phrase));
}

function requestedSpecialty(value: string): string | null {
  const normalized = value.toLowerCase();
  return SPECIALTY_TERMS.find((specialty) => normalized.includes(specialty)) || null;
}

export function safeHealthcareAction(params: {
  utterance: string;
  action: HealthcareAction;
  verified: boolean;
  jev: HealthcareJevResult;
  hasUpcomingAppointment: boolean;
  hasOpenReferral: boolean;
  availableSlotCount: number;
  appointmentSelected: boolean;
  selectedSlotProvided: boolean;
  confirmed: boolean;
  referralSpecialty?: string;
  availableModalities?: string[];
}) {
  const intent = params.jev.answers.intent;
  const humanReview = params.jev.answers.needs_human_review;
  const intentValue = intent?.choice as HealthcareIntent | undefined;
  const confidence = Number(intent?.confidence || 0);
  const emergency = hasEmergencyLanguage(params.utterance);
  const clinical = intentValue === 'clinical_question';
  const humanRequested = intentValue === 'human_help' || params.action === 'request_staff';
  const modelRequestsReview = Number(humanReview?.noul || 0) >= 0.5;
  const specialty = requestedSpecialty(params.utterance);
  const referralSpecialty = (params.referralSpecialty || '').toLowerCase();
  const specialtyMismatch = Boolean(specialty && referralSpecialty && !referralSpecialty.includes(specialty));
  const requestsVideo = /\b(video|virtual|telehealth|telemedicine)\b/i.test(params.utterance);
  const availableModalities = params.availableModalities || ['in_person'];

  if (emergency) return { nextStep: 'route_to_staff' as const, reason: 'emergency_language', mayMutate: false };
  if (clinical || humanRequested || modelRequestsReview || confidence < 0.55) {
    return {
      nextStep: 'route_to_staff' as const,
      reason: clinical ? 'clinical_request' : humanRequested ? 'human_requested' : confidence < 0.55 ? 'low_confidence' : 'human_review',
      mayMutate: false
    };
  }
  if (!params.verified) return { nextStep: 'verify_identity' as const, reason: 'identity_verification_required', mayMutate: false };
  if (specialtyMismatch) return { nextStep: 'route_to_staff' as const, reason: 'referral_specialty_mismatch', mayMutate: false };
  if (requestsVideo && !availableModalities.includes('video')) {
    return { nextStep: 'route_to_staff' as const, reason: 'unsupported_modality', mayMutate: false };
  }
  if (params.action === 'lookup_appointments') {
    return { nextStep: 'lookup_appointments' as const, reason: 'identity_verified', mayMutate: false };
  }
  if (params.action === 'lookup_referrals') {
    return { nextStep: 'look_up_referral' as const, reason: 'identity_verified', mayMutate: false };
  }
  if (params.action === 'visit_logistics') {
    return params.hasUpcomingAppointment
      ? { nextStep: 'provide_visit_logistics' as const, reason: 'appointment_found', mayMutate: false }
      : { nextStep: 'route_to_staff' as const, reason: 'no_upcoming_appointment', mayMutate: false };
  }
  if (params.action === 'cancel_appointment') {
    return params.appointmentSelected && params.confirmed
      ? { nextStep: 'confirm_cancellation' as const, reason: 'explicit_confirmation', mayMutate: true }
      : { nextStep: 'ask_for_clarification' as const, reason: 'cancellation_confirmation_required', mayMutate: false };
  }
  if (params.action === 'reschedule_appointment') {
    return params.appointmentSelected && params.selectedSlotProvided && params.confirmed
      ? { nextStep: 'confirm_reschedule' as const, reason: 'explicit_confirmation', mayMutate: true }
      : params.availableSlotCount > 0
        ? { nextStep: 'offer_appointments' as const, reason: 'replacement_options_found', mayMutate: false }
        : { nextStep: 'route_to_staff' as const, reason: 'no_eligible_slots', mayMutate: false };
  }
  if (params.action === 'book_appointment') {
    if (!params.hasOpenReferral) return { nextStep: 'route_to_staff' as const, reason: 'no_open_referral', mayMutate: false };
    return params.selectedSlotProvided && params.confirmed
      ? { nextStep: 'confirm_selected_slot' as const, reason: 'explicit_confirmation', mayMutate: true }
      : params.availableSlotCount > 0
        ? { nextStep: 'offer_appointments' as const, reason: 'eligible_options_found', mayMutate: false }
        : { nextStep: 'route_to_staff' as const, reason: 'no_eligible_slots', mayMutate: false };
  }
  if (params.action === 'search_availability') {
    return params.hasOpenReferral && params.availableSlotCount > 0
      ? { nextStep: 'offer_appointments' as const, reason: 'eligible_options_found', mayMutate: false }
      : { nextStep: 'route_to_staff' as const, reason: 'no_eligible_options', mayMutate: false };
  }
  return { nextStep: 'ask_for_clarification' as const, reason: 'verification_complete', mayMutate: false };
}
