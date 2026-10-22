export const XAI_VOICE_MODELS = {
  default: 'grok-voice-latest',
  flagship: 'grok-voice-3.0',
  previous: 'grok-voice-2.0'
} as const;

export const XAI_VOICES = [
  { value: 'ara', label: 'Ara', description: 'Welcoming and warm' },
  { value: 'eve', label: 'Eve', description: 'Lively British delivery · default' },
  { value: 'leo', label: 'Leo', description: 'Strong British delivery' },
  { value: 'rex', label: 'Rex', description: 'Clear and assured' },
  { value: 'sal', label: 'Sal', description: 'Even, smooth delivery' },
  { value: 'altair', label: 'Altair', description: 'Polished premium delivery' },
  { value: 'atlas', label: 'Atlas', description: 'Commanding yet reassuring' },
  { value: 'aurora', label: 'Aurora', description: 'Radiant and serene' },
  { value: 'carina', label: 'Carina', description: 'Soothing, gentle empathy' },
  { value: 'castor', label: 'Castor', description: 'Relaxed conversational charm' },
  { value: 'celeste', label: 'Celeste', description: 'Assured, compassionate support' },
  { value: 'cosmo', label: 'Cosmo', description: 'Curious and accessible' },
  { value: 'helios', label: 'Helios', description: 'Versatile upbeat energy' },
  { value: 'helix', label: 'Helix', description: 'High-energy bold delivery' },
  { value: 'iris', label: 'Iris', description: 'Cheerful, personable charm' },
  { value: 'kepler', label: 'Kepler', description: 'Inventive charismatic delivery' },
  { value: 'liora', label: 'Liora', description: 'Grounded, calming presence' },
  { value: 'lumen', label: 'Lumen', description: 'Articulate engaging warmth' },
  { value: 'luna', label: 'Luna', description: 'Patient nurturing delivery' },
  { value: 'lux', label: 'Lux', description: 'Quietly thoughtful delivery' },
  { value: 'naksh', label: 'Naksh', description: 'Thoughtful warmth · Indian accent' },
  { value: 'orion', label: 'Orion', description: 'Resonant cinematic depth' },
  { value: 'perseus', label: 'Perseus', description: 'Trustworthy assured delivery' },
  { value: 'rigel', label: 'Rigel', description: 'Professional precision · Australian accent' },
  { value: 'sirius', label: 'Sirius', description: 'Playful quick wit' },
  { value: 'ursa', label: 'Ursa', description: 'Steady companionable warmth' },
  { value: 'zagan', label: 'Zagan', description: 'Distinctive dramatic power' },
  { value: 'zenith', label: 'Zenith', description: 'Focused purposeful energy' }
] as const;

export function normalizeXAIVoice(voice?: string | null): string {
  const candidate = voice?.trim();
  // Canonicalize built-ins while preserving saved custom voice IDs verbatim.
  return XAI_VOICES.find((entry) => entry.value === candidate?.toLowerCase())?.value || candidate || 'eve';
}

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
  if ([XAI_VOICE_MODELS.previous, 'grok-voice-think-fast-2.0', 'grok-voice-think-fast-1.0'].includes(candidate || '')) {
    return XAI_VOICE_MODELS.flagship;
  }
  return candidate?.startsWith('grok-voice-') ? candidate : XAI_VOICE_MODELS.default;
}
