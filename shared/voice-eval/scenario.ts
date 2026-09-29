import { HEALTHCARE_TOOL_PARAMETERS, isEvalPatientReference } from '../healthcare-demo.ts';
import type { Scenario } from './types.ts';

const ACTIONS = new Set<string>(HEALTHCARE_TOOL_PARAMETERS.properties.action.enum);
const WEEKDAYS = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);

export function validateScenario(s: Scenario): string[] {
  const errors: string[] = [];
  if (!/^hc-\d{2}$/.test(s.id)) errors.push(`${s.id}: id must look like hc-01`);
  if (!Number.isInteger(s.version) || s.version < 1) errors.push(`${s.id}: version must be a positive integer`);
  if (!isEvalPatientReference(s.evalPatient)) errors.push(`${s.id}: evalPatient must be an eval target (EVAL-0001 or 205042)`);

  const tools = s.expected.tools;
  for (const action of [...tools.requiredActions, ...tools.forbiddenActions]) {
    if (!ACTIONS.has(action)) errors.push(`${s.id}: unknown action ${action}`);
  }
  for (const matcher of tools.argMatchers) {
    if (!ACTIONS.has(matcher.action)) errors.push(`${s.id}: unknown action ${matcher.action}`);
    if (!s.facts[matcher.fact]) errors.push(`${s.id}: arg matcher references missing fact ${matcher.fact}`);
  }
  s.beats.forEach((beat, index) => {
    if (beat.correctedFact && !s.facts[beat.correctedFact]) errors.push(`${s.id}: correctedFact ${beat.correctedFact} is not a fact`);
    if (beat.anchor && !ACTIONS.has(beat.anchor.afterTool)) errors.push(`${s.id}: unknown anchor action ${beat.anchor.afterTool}`);
    if (beat.kind !== 'silence' && !beat.line?.trim()) errors.push(`${s.id}: beat ${index} needs a line`);
    if (beat.kind === 'silence' && !(Number(beat.durationMs) > 0)) errors.push(`${s.id}: beat ${index} needs durationMs`);
    if (beat.kind === 'barge_in' && !(typeof beat.afterAgentSpeechMs === 'number' && beat.afterAgentSpeechMs >= 0)) {
      errors.push(`${s.id}: beat ${index} needs afterAgentSpeechMs`);
    }
  });
  for (const assertion of s.expected.state) {
    if (assertion.kind === 'new_appointment_weekday' && !WEEKDAYS.has(assertion.weekday)) {
      errors.push(`${s.id}: invalid weekday ${assertion.weekday}`);
    }
    if ((assertion.kind === 'seeded_status' || assertion.kind === 'seeded_slot_released') && !s.setup.seedAppointment) {
      errors.push(`${s.id}: ${assertion.kind} needs setup.seedAppointment`);
    }
  }
  if (s.expected.policy.requireEscalation && !tools.forbiddenActions.includes('book_appointment')) {
    errors.push(`${s.id}: escalation scenarios must forbid book_appointment`);
  }
  if (!s.expected.policy.judgeRubric.every((entry) => /^[a-z_]+: /.test(entry))) {
    errors.push(`${s.id}: rubric entries must look like "id: description"`);
  }
  return errors;
}
