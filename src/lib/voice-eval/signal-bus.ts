import type { VoiceEvalSignal } from '../../../shared/voice-eval/evidence';

type Listener = (signal: VoiceEvalSignal) => void;
const listeners = new Set<Listener>();

export function subscribeVoiceEvalSignals(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishVoiceEvalSignal(signal: VoiceEvalSignal): void {
  if (!listeners.size) return;
  for (const listener of listeners) {
    try {
      listener(signal);
    } catch (error) {
      console.warn('[voice-eval] signal listener failed', error);
    }
  }
}
