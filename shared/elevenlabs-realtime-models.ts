export const ELEVENLABS_REALTIME_MODELS = [
  { id: 'eleven_realtime_v1_mini', label: 'Eleven Realtime v1 Mini' },
  { id: 'eleven_realtime_v1_max', label: 'Eleven Realtime v1 Max' }
] as const;

export type ElevenLabsRealtimeModel = typeof ELEVENLABS_REALTIME_MODELS[number]['id'];

export function resolveElevenLabsRealtimeModel(value: unknown): ElevenLabsRealtimeModel | null {
  if (value === undefined || value === null || value === '') return null;
  if (value === 'eleven_realtime_v1_mini' || value === 'eleven_realtime_v1_max') return value;
  throw new Error('Unsupported ElevenLabs Realtime model');
}

export function validateElevenLabsRealtimeTokens(model: ElevenLabsRealtimeModel | null, maxTokens: number): void {
  if (model === 'eleven_realtime_v1_max' && maxTokens !== -1
    && (!Number.isInteger(maxTokens) || maxTokens < 1024)) {
    throw new Error('Eleven Realtime v1 Max requires at least 1,024 response tokens, or no limit (-1).');
  }
}

export function elevenLabsRealtimeLabel(model: ElevenLabsRealtimeModel): string {
  return ELEVENLABS_REALTIME_MODELS.find((entry) => entry.id === model)!.label;
}

// A published Custom mode (null) must take precedence over an unpublished selection.
export function effectiveElevenLabsRealtimeModel(config: {
  realtime_model?: unknown;
  app_managed?: { effective_realtime_model?: unknown };
}): ElevenLabsRealtimeModel | null {
  const synced = config.app_managed;
  return resolveElevenLabsRealtimeModel(synced && Object.prototype.hasOwnProperty.call(synced, 'effective_realtime_model')
    ? synced.effective_realtime_model
    : config.realtime_model);
}
