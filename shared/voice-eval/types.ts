import type { HealthcareAction } from '../healthcare-demo.ts';

export type Weekday = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
export type FactKind = 'name' | 'date' | 'digits' | 'weekday' | 'text' | 'postcode';

export interface Fact {
  kind: FactKind;
  value: string;
  critical: boolean;
  /** Tool argument that must carry this fact, e.g. 'date_of_birth'. */
  argField?: string;
}

export type BeatKind = 'barge_in' | 'correction' | 'silence' | 'say';

export interface BeatAnchor {
  /** The beat becomes eligible only after a successful result for this healthcare action. */
  afterTool: HealthcareAction;
}

export interface Beat {
  kind: BeatKind;
  line?: string;
  afterTurn?: number;
  afterAgentSpeechMs?: number;
  durationMs?: number;
  correctedFact?: string;
  anchor?: BeatAnchor;
}

export type StateAssertion =
  | { kind: 'new_appointments'; count: number }
  | { kind: 'new_appointment_weekday'; weekday: Weekday }
  | { kind: 'new_appointment_slot_booked' }
  | { kind: 'seeded_status'; status: 'scheduled' | 'cancelled' | 'rescheduled' }
  | { kind: 'seeded_slot_released' };

export interface ArgMatcher {
  action: HealthcareAction;
  field: string;
  fact: string;
}

export interface ToolExpectations {
  requiredActions: HealthcareAction[];
  forbiddenActions: HealthcareAction[];
  argMatchers: ArgMatcher[];
}

export interface Scenario {
  id: string;
  version: number;
  title: string;
  summary: string;
  persona: {
    voiceId: string;
    accent: string;
    noise: 'none' | 'cafe' | 'car' | 'speakerphone';
    temperament: 'calm' | 'rushed' | 'angry' | 'anxious';
  };
  goal: string;
  evalPatient: string;
  facts: Record<string, Fact>;
  beats: Beat[];
  setup: { seedAppointment: boolean };
  expected: {
    state: StateAssertion[];
    tools: ToolExpectations;
    policy: { requireEscalation: boolean; judgeRubric: string[] };
  };
}

export type EvidenceEvent =
  | { kind: 'caller_speech_start'; atMs: number }
  | { kind: 'caller_speech_stop'; atMs: number }
  | { kind: 'caller_transcript'; atMs: number; text: string }
  | { kind: 'agent_transcript'; atMs: number; text: string }
  | { kind: 'agent_audio_start'; atMs: number }
  | { kind: 'agent_audio_stop'; atMs: number }
  /** A synthetic caller line; atMs is when playback started. */
  | { kind: 'caller_utterance'; atMs: number; durationMs: number; text: string; source: 'brain' | 'beat'; beatIndex: number | null }
  | { kind: 'beat'; atMs: number; beatIndex: number; beatKind: BeatKind }
  | { kind: 'turn_metric'; atMs: number; firstAudioMs: number | null; bargeInMs: number | null; toolCallMs: number | null }
  | { kind: 'tool_call'; atMs: number; callId: string; name: string; args: Record<string, unknown> }
  | { kind: 'tool_result'; atMs: number; callId: string; ok: boolean; result: unknown }
  | { kind: 'harness_error'; atMs: number; message: string };

export type DimensionStatus = 'pass' | 'warn' | 'fail' | 'no_data' | 'pending';

export interface Gate {
  id: string;
  label: string;
  /** null = not decided yet (live mode) */
  passed: boolean | null;
  detail: string;
}

export interface LatencyThresholds { p95PassMs: number; p95WarnMs: number }

export interface LatencyResult {
  status: DimensionStatus;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  turnCount: number;
  toolTurnP95Ms: number | null;
}

export interface ToolResult {
  status: DimensionStatus;
  score: number;
  calledActions: string[];
  matchers: { matcher: ArgMatcher; passed: boolean; actual: string | null }[];
}

export interface EntityCheck {
  fact: string;
  kind: FactKind;
  expected: string;
  heardCorrectly: boolean | null;
  argCorrect: boolean | null;
}

export interface EntityResult {
  status: DimensionStatus;
  entities: EntityCheck[];
  entityWer: number | null;
  overallWer: number | null;
}

export interface TurnTakingResult {
  status: DimensionStatus;
  bargeIns: number[];
  bargeInPass: boolean | null;
  talkOverCount: number;
  silenceViolations: number;
}

export interface SafetyResult {
  status: DimensionStatus;
  escalated: boolean | null;
  disclosureBeforeVerification: boolean;
}

export type Verdict = 'pass' | 'fail' | 'invalid_harness' | 'pending';

export interface RunScore {
  verdict: Verdict;
  gates: Gate[];
  latency: LatencyResult;
  tools: ToolResult;
  entities: EntityResult;
  turnTaking: TurnTakingResult;
  safety: SafetyResult;
}

export interface JudgeItem {
  item: string;
  score: 0 | 1 | 2;
  verdict: string;
  evidence: { turn: number; quote: string }[];
}

export interface JudgeResult {
  status: 'ok' | 'unavailable' | 'skipped';
  items: JudgeItem[];
  droppedDeductions: number;
  notes: string;
  model: string | null;
  error?: string;
  missingItems?: string[];
}

export interface SlotRow {
  id: string;
  provider_id: string;
  department_id: string;
  slot_start: string;
  slot_end: string;
  duration_min: number;
  status: string;
  appointment_id: string | null;
  visit_types_allowed: string[];
  held_by_session_id?: string | null;
  held_until?: string | null;
}

export interface AppointmentRow {
  id: string;
  patient_id: string;
  provider_id: string;
  department_id: string;
  start_at: string;
  duration_min: number;
  status: string;
  visit_type: string;
  visit_type_code: string;
  reason: string;
  confirmation_number: string;
  booked_via: string;
  slot_id: string | null;
  referral_id: string | null;
  eval_run_id: string | null;
  created_at?: string;
}

export interface SetupResult {
  seededAppointmentId: string | null;
  seededSlotId: string | null;
  sensitiveStrings: string[];
  /** EHR patient id of the eval target; teardown releases slots still held for it. */
  patientId: string | null;
}

export interface StateSnapshot {
  seededAppointmentId: string | null;
  seededSlotId: string | null;
  appointments: AppointmentRow[];
  slots: SlotRow[];
}
