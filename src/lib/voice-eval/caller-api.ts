import { supabase } from '../supabase';
import { CallerRunClosedError, type CallerApi } from './synthetic-caller/types';

async function invokeCaller<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('voice-eval-caller', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    let message = error.message || 'Synthetic caller request failed';
    if (context && typeof context.json === 'function') {
      try {
        const errorBody = (await context.json()) as { error?: unknown } | null;
        if (typeof errorBody?.error === 'string' && errorBody.error) message = errorBody.error;
      } catch {
        // Body was not JSON (or already consumed); keep the generic message.
      }
    }
    if (context?.status === 409) throw new CallerRunClosedError(message);
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const callerApi: CallerApi = {
  async renderBeats(runId) {
    const data = await invokeCaller<{ lines: { beat_index: number; text: string; audio_b64: string }[] }>({ action: 'render', run_id: runId });
    return data.lines.map((line) => ({ beatIndex: line.beat_index, text: line.text, audioB64: line.audio_b64 }));
  },
  async nextTurn({ runId, transcript, beatsFired }) {
    const data = await invokeCaller<{ action: 'say' | 'hang_up'; text: string; audio_b64: string | null }>({
      action: 'next_turn',
      run_id: runId,
      transcript,
      beats_fired: beatsFired
    });
    return { action: data.action, text: data.text, audioB64: data.audio_b64 };
  }
};
