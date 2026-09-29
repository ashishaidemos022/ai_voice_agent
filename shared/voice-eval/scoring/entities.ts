import { bestWindowDistance, factMatchesText, factMatchesValue, factTokens, transcriptTokensFor } from '../normalize.ts';
import type { EntityCheck, EntityResult, EvidenceEvent, Scenario } from '../types.ts';
import { healthcareCalls } from './tools.ts';

export function scoreEntities(scenario: Scenario, events: EvidenceEvent[]): EntityResult {
  const callerText = events.flatMap((event) => (event.kind === 'caller_transcript' ? [event.text] : [])).join(' ');
  const calls = healthcareCalls(events);
  let distance = 0;
  let total = 0;

  const entities: EntityCheck[] = Object.entries(scenario.facts)
    .filter(([, fact]) => fact.critical)
    .map(([name, fact]) => {
      const argField = fact.argField;
      const withArg = argField
        ? [...calls].reverse().find((call) => call.args[argField] !== undefined && call.args[argField] !== null && call.args[argField] !== '')
        : undefined;
      if (callerText) {
        const reference = factTokens(fact);
        distance += bestWindowDistance(reference, transcriptTokensFor(fact, callerText));
        total += reference.length;
      }
      return {
        fact: name,
        kind: fact.kind,
        expected: fact.value,
        heardCorrectly: callerText ? factMatchesText(fact, callerText) : null,
        argCorrect: argField && withArg ? factMatchesValue(fact, withArg.args[argField]) : null
      };
    });

  const status = !entities.length || !callerText
    ? 'no_data'
    : entities.some((e) => e.argCorrect === false)
      ? 'fail'
      : entities.some((e) => e.heardCorrectly === false) ? 'warn' : 'pass';
  // Overall WER needs a reference transcript; only the synthetic caller (phase 2) has one.
  return { status, entities, entityWer: total > 0 ? distance / total : null, overallWer: null };
}
