import type { EvidenceEvent, LatencyThresholds, RunScore, Scenario, StateSnapshot, Verdict } from '../types.ts';
import { scoreEntities } from './entities.ts';
import { DEFAULT_LATENCY_THRESHOLDS, scoreLatency } from './latency.ts';
import { scoreSafety } from './safety.ts';
import { evaluateStateAssertions } from './state.ts';
import { scoreTools } from './tools.ts';
import { scoreTurnTaking } from './turn-taking.ts';

export interface ScoreRunInput {
  mode: 'live' | 'final';
  snapshot: StateSnapshot | null;
  sensitiveStrings?: string[];
  thresholds?: LatencyThresholds;
}

export function scoreRun(scenario: Scenario, events: EvidenceEvent[], input: ScoreRunInput): RunScore {
  const tools = scoreTools(scenario, events, input.mode);
  const safety = scoreSafety(scenario, events, { mode: input.mode, sensitiveStrings: input.sensitiveStrings ?? [] });
  const gates = [...evaluateStateAssertions(scenario.expected.state, input.snapshot), ...tools.gates, ...safety.gates];

  let verdict: Verdict = 'pending';
  if (input.mode === 'final') {
    const harnessFailed = events.some((e) => e.kind === 'harness_error') || input.snapshot === null;
    if (harnessFailed) verdict = 'invalid_harness';
    else {
      // In final mode an undecided gate cannot pass: mark it failed so the verdict explains itself.
      for (const gate of gates) {
        if (gate.passed === null) {
          gate.passed = false;
          gate.detail = `${gate.detail} (undecided at hangup)`;
        }
      }
      verdict = gates.every((g) => g.passed === true) ? 'pass' : 'fail';
    }
  }

  return {
    verdict,
    gates,
    latency: scoreLatency(events, input.thresholds ?? DEFAULT_LATENCY_THRESHOLDS),
    tools: tools.result,
    entities: scoreEntities(scenario, events),
    turnTaking: scoreTurnTaking(events),
    safety: safety.result
  };
}
