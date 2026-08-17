export const OPENAI_MODELS = {
  realtime: {
    default: 'gpt-realtime-2.1',
    economy: 'gpt-realtime-2.1-mini',
    legacyFallback: 'gpt-realtime-1.5'
  },
  chat: {
    frontier: 'gpt-5.6-sol',
    default: 'gpt-5.6-terra',
    economy: 'gpt-5.6-luna',
    mini: 'gpt-5.4-mini',
    nano: 'gpt-5.4-nano'
  },
  transcription: {
    accurate: 'gpt-4o-transcribe',
    streaming: 'gpt-realtime-whisper'
  }
} as const;

export type OpenAIModelId =
  | typeof OPENAI_MODELS.realtime[keyof typeof OPENAI_MODELS.realtime]
  | typeof OPENAI_MODELS.chat[keyof typeof OPENAI_MODELS.chat]
  | typeof OPENAI_MODELS.transcription[keyof typeof OPENAI_MODELS.transcription]
  | 'gpt-4.1-mini';

export type ModelPricing = {
  textInputPer1M: number;
  cachedTextInputPer1M?: number;
  textOutputPer1M: number;
  audioInputPer1M?: number;
  cachedAudioInputPer1M?: number;
  audioOutputPer1M?: number;
};

export const OPENAI_MODEL_PRICING: Partial<Record<OpenAIModelId, ModelPricing>> = {
  'gpt-realtime-2.1': {
    textInputPer1M: 4,
    cachedTextInputPer1M: 0.4,
    textOutputPer1M: 24,
    audioInputPer1M: 32,
    cachedAudioInputPer1M: 0.4,
    audioOutputPer1M: 64
  },
  'gpt-realtime-2.1-mini': {
    textInputPer1M: 0.6,
    cachedTextInputPer1M: 0.06,
    textOutputPer1M: 2.4,
    audioInputPer1M: 10,
    cachedAudioInputPer1M: 0.3,
    audioOutputPer1M: 20
  },
  'gpt-realtime-1.5': {
    textInputPer1M: 4,
    cachedTextInputPer1M: 0.4,
    textOutputPer1M: 16,
    audioInputPer1M: 32,
    cachedAudioInputPer1M: 0.4,
    audioOutputPer1M: 64
  },
  'gpt-5.6-sol': {
    textInputPer1M: 5,
    cachedTextInputPer1M: 0.5,
    textOutputPer1M: 30
  },
  'gpt-5.6-terra': {
    textInputPer1M: 2,
    cachedTextInputPer1M: 0.2,
    textOutputPer1M: 12
  },
  'gpt-5.6-luna': {
    textInputPer1M: 0.2,
    cachedTextInputPer1M: 0.02,
    textOutputPer1M: 1.2
  },
  'gpt-5.4-mini': {
    textInputPer1M: 0.75,
    cachedTextInputPer1M: 0.075,
    textOutputPer1M: 4.5
  },
  'gpt-5.4-nano': {
    textInputPer1M: 0.2,
    cachedTextInputPer1M: 0.02,
    textOutputPer1M: 1.25
  },
  'gpt-4.1-mini': {
    textInputPer1M: 0.4,
    cachedTextInputPer1M: 0.1,
    textOutputPer1M: 1.6
  }
};

export const OPENAI_TOOL_PRICING = {
  fileSearchPerCall: 2.5 / 1000
} as const;

export const OPENAI_PRICING_EFFECTIVE_DATE = '2026-08-17';

export function getOpenAIModelPricing(model?: string | null): ModelPricing | undefined {
  const candidate = model?.trim();
  if (!candidate) return undefined;

  const direct = OPENAI_MODEL_PRICING[candidate as OpenAIModelId];
  if (direct) return direct;

  if (/^gpt-4\.1-mini(?:-|$)/i.test(candidate)) {
    return OPENAI_MODEL_PRICING['gpt-4.1-mini'];
  }

  if (/^(gpt-realtime|gpt-4o(?:-mini)?-realtime(?:-preview.*)?)$/i.test(candidate)) {
    return OPENAI_MODEL_PRICING[OPENAI_MODELS.realtime.legacyFallback];
  }

  return undefined;
}

const LEGACY_REALTIME_MODEL_PATTERN = /^(gpt-realtime(?:-1\.5|-2)?|gpt-4o(?:-mini)?-realtime(?:-preview.*)?)$/i;

export function isRealtimeModel(model: string | null | undefined): boolean {
  return Boolean(model?.trim().toLowerCase().includes('realtime'));
}

export function normalizeRealtimeModel(model?: string | null): string {
  const candidate = model?.trim();
  if (!candidate || LEGACY_REALTIME_MODEL_PATTERN.test(candidate)) {
    return OPENAI_MODELS.realtime.default;
  }
  return isRealtimeModel(candidate) ? candidate : OPENAI_MODELS.realtime.default;
}

export function normalizeChatModel(model?: string | null): string {
  const candidate = model?.trim();
  if (!candidate || isRealtimeModel(candidate)) {
    return OPENAI_MODELS.chat.default;
  }
  return candidate;
}
