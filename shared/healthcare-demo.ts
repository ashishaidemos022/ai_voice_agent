export const HEALTHCARE_TOOL_NAME = 'healthcare_patient_access';
export const HEALTHCARE_DEMO_PATIENT_REFERENCE = 'DEMO-1001';

export const HEALTHCARE_TOOL_DESCRIPTION =
  'Use the synthetic Ashish_EHR patient-access workflow to classify an administrative request with Jev, verify an open referral, find eligible appointments, or confirm a selected demo appointment. This tool is administrative only and must not diagnose, recommend treatment, or handle a real patient.';

export const HEALTHCARE_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    utterance: {
      type: 'string',
      description: 'The patient\'s complete latest request in their own words.'
    },
    patient_reference: {
      type: 'string',
      description: `The synthetic demo patient reference. Use ${HEALTHCARE_DEMO_PATIENT_REFERENCE}.`
    },
    selected_slot_id: {
      type: 'string',
      description: 'An exact slot_id previously returned by this tool when the patient selects an offered appointment.'
    },
    confirmed: {
      type: 'boolean',
      description: 'True only after the patient explicitly confirms the exact date and time in the current conversation.'
    }
  },
  required: ['utterance', 'patient_reference'],
  additionalProperties: false
} as const;

export type HealthcareIntent =
  | 'schedule_referral'
  | 'referral_status'
  | 'reschedule_appointment'
  | 'billing_or_coverage'
  | 'clinical_question'
  | 'human_help'
  | 'other';

export type HealthcareNextStep =
  | 'look_up_referral'
  | 'offer_appointments'
  | 'confirm_selected_slot'
  | 'route_to_staff'
  | 'ask_for_clarification';

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
  hasOpenReferral: boolean;
  availableSlotCount: number;
  selectedSlotProvided: boolean;
  confirmed: boolean;
}) {
  return {
    intent: {
      type: 'choice',
      instructions: 'Classify the patient\'s administrative intent. Choose clinical_question when they ask for diagnosis, interpretation, treatment, or medical advice.',
      criteria: {
        schedule_referral: 'Schedule care using an existing referral',
        referral_status: 'Check whether a referral exists or is ready',
        reschedule_appointment: 'Move or change an existing appointment',
        billing_or_coverage: 'Ask about billing, claims, insurance, or coverage',
        clinical_question: 'Ask for diagnosis, interpretation, treatment, medication advice, or other clinical guidance',
        human_help: 'Explicitly request a person or staff member',
        other: 'None of the listed administrative intents clearly apply'
      }
    },
    next_step: {
      type: 'choice',
      instructions: {
        question: 'Choose the safest next administrative workflow step for the latest patient request.',
        workflow_state: context
      },
      criteria: {
        look_up_referral: 'Retrieve the synthetic patient\'s referral status before discussing availability',
        offer_appointments: 'An open referral exists and eligible appointment options can be shown',
        confirm_selected_slot: 'The patient selected an exact returned slot and explicitly confirmed it',
        route_to_staff: 'Clinical guidance, emergency language, unsupported work, ambiguity with risk, or a human request requires staff',
        ask_for_clarification: 'Ask one narrow question because a required preference or selection is missing'
      }
    },
    needs_human_review: {
      type: 'noul',
      instructions: 'Does this request require a human because it asks for clinical judgment, contains urgent symptom language, is ambiguous in a consequential way, or explicitly asks for staff?'
    }
  } as const;
}

const EMERGENCY_PHRASES = [
  'chest pain',
  'cannot breathe',
  "can't breathe",
  'difficulty breathing',
  'passed out',
  'unconscious',
  'stroke',
  'suicidal',
  'overdose',
  'severe bleeding'
];

export function hasEmergencyLanguage(value: string): boolean {
  const normalized = value.toLowerCase();
  return EMERGENCY_PHRASES.some((phrase) => normalized.includes(phrase));
}

export function safeHealthcareAction(params: {
  utterance: string;
  jev: HealthcareJevResult;
  hasOpenReferral: boolean;
  availableSlotCount: number;
  selectedSlotProvided: boolean;
  confirmed: boolean;
}) {
  const intent = params.jev.answers.intent;
  const nextStep = params.jev.answers.next_step;
  const humanReview = params.jev.answers.needs_human_review;
  const intentValue = intent?.choice as HealthcareIntent | undefined;
  const requestedNextStep = nextStep?.choice as HealthcareNextStep | undefined;
  const confidence = Number(intent?.confidence || 0);
  const emergency = hasEmergencyLanguage(params.utterance);
  const clinical = intentValue === 'clinical_question';
  const humanRequested = intentValue === 'human_help';
  const modelRequestsReview = Number(humanReview?.noul || 0) >= 0.5;

  if (emergency) {
    return { nextStep: 'route_to_staff' as const, reason: 'emergency_language', mayBook: false };
  }
  if (clinical || humanRequested || modelRequestsReview || confidence < 0.55) {
    return { nextStep: 'route_to_staff' as const, reason: clinical ? 'clinical_request' : humanRequested ? 'human_requested' : confidence < 0.55 ? 'low_confidence' : 'human_review', mayBook: false };
  }
  if (params.selectedSlotProvided && params.confirmed && params.hasOpenReferral) {
    return { nextStep: 'confirm_selected_slot' as const, reason: 'explicit_confirmation', mayBook: true };
  }
  if (!params.hasOpenReferral) {
    return { nextStep: 'route_to_staff' as const, reason: 'no_open_referral', mayBook: false };
  }
  if (params.availableSlotCount > 0 && ['schedule_referral', 'referral_status'].includes(intentValue || '')) {
    return { nextStep: 'offer_appointments' as const, reason: 'eligible_options_found', mayBook: false };
  }
  return {
    nextStep: requestedNextStep === 'ask_for_clarification' ? 'ask_for_clarification' as const : 'route_to_staff' as const,
    reason: 'unsupported_or_incomplete',
    mayBook: false
  };
}
