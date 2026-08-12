export const XAI_VOICE_MODELS = {
  default: 'grok-voice-latest',
  flagship: 'grok-voice-think-fast-2.0',
  previous: 'grok-voice-think-fast-1.0'
} as const;

export const XAI_VOICES = [
  { value: 'ara', label: 'Ara', description: 'Multilingual' },
  { value: 'eve', label: 'Eve', description: 'Multilingual · default' },
  { value: 'leo', label: 'Leo', description: 'Multilingual' },
  { value: 'rex', label: 'Rex', description: 'Multilingual' },
  { value: 'sal', label: 'Sal', description: 'Multilingual' }
] as const;

export function normalizeXAIVoiceModel(model?: string | null): string {
  const candidate = model?.trim();
  return candidate?.startsWith('grok-voice-') ? candidate : XAI_VOICE_MODELS.default;
}
