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

export const XAI_VOICE_LANGUAGES = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'ar-EG', label: 'Arabic (Egypt)' },
  { value: 'ar-SA', label: 'Arabic (Saudi Arabia)' },
  { value: 'ar-AE', label: 'Arabic (United Arab Emirates)' },
  { value: 'bn', label: 'Bengali' },
  { value: 'zh', label: 'Chinese (Simplified)' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'hi', label: 'Hindi' },
  { value: 'id', label: 'Indonesian' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'pt-PT', label: 'Portuguese (Portugal)' },
  { value: 'ru', label: 'Russian' },
  { value: 'es-MX', label: 'Spanish (Mexico)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'tr', label: 'Turkish' },
  { value: 'vi', label: 'Vietnamese' }
] as const;

export type XAIVoiceLanguage = (typeof XAI_VOICE_LANGUAGES)[number]['value'];

export function normalizeXAIVoiceLanguage(language?: string | null): XAIVoiceLanguage {
  return XAI_VOICE_LANGUAGES.some((option) => option.value === language)
    ? language as XAIVoiceLanguage
    : 'auto';
}

export function getXAIVoiceLanguageLabel(language: XAIVoiceLanguage): string {
  return XAI_VOICE_LANGUAGES.find((option) => option.value === language)?.label ?? 'Auto-detect';
}

export function normalizeXAIVoiceModel(model?: string | null): string {
  const candidate = model?.trim();
  return candidate?.startsWith('grok-voice-') ? candidate : XAI_VOICE_MODELS.default;
}
