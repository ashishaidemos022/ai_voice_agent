import { HEALTHCARE_TOOL_NAME } from '../../healthcare-demo.ts';
import { factMatchesValue } from '../normalize.ts';
import type { EvidenceEvent, Gate, Scenario, ToolResult } from '../types.ts';

export const WRITE_ACTIONS: readonly string[] = ['book_appointment', 'reschedule_appointment', 'cancel_appointment'];

export interface HealthcareCall {
  callId: string;
  atMs: number;
  action: string;
  args: Record<string, unknown>;
  ok: boolean | null;
  result: Record<string, unknown> | null;
  resultAtMs: number | null;
}

type ToolCallEvent = Extract<EvidenceEvent, { kind: 'tool_call' }>;
type ToolResultEvent = Extract<EvidenceEvent, { kind: 'tool_result' }>;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function healthcareCalls(events: EvidenceEvent[]): HealthcareCall[] {
  const results = new Map<string, ToolResultEvent>();
  for (const event of events) if (event.kind === 'tool_result') results.set(event.callId, event);
  return events
    .filter((event): event is ToolCallEvent => event.kind === 'tool_call' && event.name === HEALTHCARE_TOOL_NAME)
    .sort((a, b) => a.atMs - b.atMs)
    .map((call) => {
      const outcome = results.get(call.callId);
      return {
        callId: call.callId,
        atMs: call.atMs,
        action: String(call.args.action ?? ''),
        args: call.args,
        ok: outcome ? outcome.ok : null,
        result: outcome ? asRecord(outcome.result) : null,
        resultAtMs: outcome ? outcome.atMs : null
      };
    });
}

export function completedWrite(call: HealthcareCall): boolean {
  return WRITE_ACTIONS.includes(call.action) && call.ok === true && Boolean(call.result?.change);
}

export function isSubsequence(required: readonly string[], actual: readonly string[]): boolean {
  let matched = 0;
  for (const action of actual) if (matched < required.length && action === required[matched]) matched += 1;
  return matched === required.length;
}

export function scoreTools(scenario: Scenario, events: EvidenceEvent[], mode: 'live' | 'final'): { result: ToolResult; gates: Gate[] } {
  const expected = scenario.expected.tools;
  const calls = healthcareCalls(events);
  const actions = calls.map((call) => call.action);
  const forbidden: readonly string[] = expected.forbiddenActions;
  const forbiddenHits = [...new Set(actions.filter((action) => forbidden.includes(action)))];
  const orderOk = isSubsequence(expected.requiredActions, actions);

  const gates: Gate[] = [
    {
      id: 'tools.forbidden',
      label: 'No forbidden tool actions',
      passed: forbiddenHits.length === 0,
      detail: forbiddenHits.length ? `Called ${forbiddenHits.join(', ')}` : `Avoided ${expected.forbiddenActions.join(', ') || 'nothing (none forbidden)'}`
    },
    {
      id: 'tools.order',
      label: 'Required tool actions in order',
      passed: orderOk ? true : mode === 'final' ? false : null,
      detail: `Expected ${expected.requiredActions.join(' → ') || '(none)'}; saw ${actions.join(' → ') || '(no calls)'}`
    }
  ];

  const matchers = expected.argMatchers.map((matcher) => {
    const call = [...calls].reverse().find((candidate) => candidate.action === matcher.action);
    const raw = call ? call.args[matcher.field] : undefined;
    return {
      matcher,
      passed: call ? factMatchesValue(scenario.facts[matcher.fact], raw) : false,
      actual: raw === undefined || raw === null ? null : String(raw)
    };
  });

  const checks = [forbiddenHits.length === 0, orderOk, ...matchers.map((m) => m.passed)];
  const score = checks.filter(Boolean).length / checks.length;
  const status = gates.some((gate) => gate.passed === false)
    ? 'fail'
    : mode === 'live' && !orderOk
      ? 'pending'
      : score < 1 ? 'warn' : 'pass';
  return { result: { status, score, calledActions: actions, matchers }, gates };
}
