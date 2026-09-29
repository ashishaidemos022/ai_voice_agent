import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrainRequest, MAX_LINE_CHARS, parseBrainDecision } from '../shared/voice-eval/caller/brain-prompt.ts';
import { getScenario } from '../shared/voice-eval/scenarios/index.ts';
import type { Scenario } from '../shared/voice-eval/types.ts';

const hc05 = getScenario('hc-05') as Scenario;

test('brain request carries persona, goal and visible facts but hides pending correction facts', () => {
  const hidden = buildBrainRequest(hc05, [], ['preferredDay']);
  assert.match(hidden.instructions, /calm/);
  assert.match(hidden.instructions, /First ask for Tuesday/);
  assert.match(hidden.instructions, /dob: 1988-02-14/);
  assert.doesNotMatch(hidden.instructions, /preferredDay:/);
  const shown = buildBrainRequest(hc05, [], []);
  assert.match(shown.instructions, /preferredDay: Thursday/);
});

test('an empty transcript says the call just connected', () => {
  assert.match(buildBrainRequest(hc05, [], []).input, /just connected/);
});

test('transcript is rendered as Agent/You lines, keeps the last 60 turns, and clamps long turns', () => {
  const turns = Array.from({ length: 70 }, (_, i) => ({ role: i % 2 ? 'caller' as const : 'agent' as const, text: `turn ${i}` }));
  turns[69] = { role: 'caller', text: 'x'.repeat(5000) };
  const { input } = buildBrainRequest(hc05, turns, []);
  assert.doesNotMatch(input, /turn 9\b/);
  assert.match(input, /Agent: turn 10/);
  assert.match(input, /You: turn 11/);
  assert.ok(!input.includes('x'.repeat(1001)));
});

test('parseBrainDecision accepts say and hang_up, rejects bad output, clamps long lines', () => {
  assert.deepEqual(parseBrainDecision('{"action":"say","text":" Hi there. "}'), { action: 'say', text: 'Hi there.' });
  assert.deepEqual(parseBrainDecision('{"action":"hang_up","text":""}'), { action: 'hang_up', text: '' });
  assert.throws(() => parseBrainDecision('{"action":"say","text":"  "}'), /empty/);
  assert.throws(() => parseBrainDecision('{"action":"dance","text":"x"}'), /action/);
  assert.throws(() => parseBrainDecision('not json'), /JSON/);
  assert.equal(parseBrainDecision(JSON.stringify({ action: 'say', text: 'y'.repeat(900) })).text.length, MAX_LINE_CHARS);
});
