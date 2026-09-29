import test from 'node:test';
import assert from 'node:assert/strict';
import { publishVoiceEvalSignal, subscribeVoiceEvalSignals } from '../src/lib/voice-eval/signal-bus.ts';
import type { VoiceEvalSignal } from '../shared/voice-eval/evidence.ts';

test('signals reach subscribers until they unsubscribe; a throwing listener does not break others', () => {
  const seen: VoiceEvalSignal[] = [];
  const unsubscribeBad = subscribeVoiceEvalSignals(() => { throw new Error('boom'); });
  const unsubscribe = subscribeVoiceEvalSignals((signal) => seen.push(signal));
  publishVoiceEvalSignal({ kind: 'agent_audio_start', at: 1 });
  unsubscribe();
  unsubscribeBad();
  publishVoiceEvalSignal({ kind: 'agent_audio_start', at: 2 });
  assert.deepEqual(seen, [{ kind: 'agent_audio_start', at: 1 }]);
});
