// Shared helpers for ElevenLabs Realtime Translation (alpha, enterprise workspaces).
// API reference: https://elevenlabs.io/docs/api-reference/realtime-translation/v-1-translation-realtime
// Kept free of browser/Deno globals so the UI, the edge function and node tests can share it.

export const TRANSLATION_INPUT_SAMPLE_RATE = 16000;
export const TRANSLATION_INPUT_FORMAT = 'pcm_16000';
export const TRANSLATION_OUTPUT_FORMAT = 'pcm_24000';
/** ElevenLabs recommends ~100 ms of audio per input_audio_chunk. */
export const TRANSLATION_CHUNK_MS = 100;

export const TRANSLATION_TTS_MODELS = [
  { id: 'eleven_v4_turbo', label: 'Eleven v4 Turbo (default)' },
  { id: 'eleven_flash_v2_5', label: 'Eleven Flash v2.5 (lowest latency)' },
  { id: 'eleven_v3', label: 'Eleven v3 (most expressive)' }
] as const;
export type TranslationTtsModel = typeof TRANSLATION_TTS_MODELS[number]['id'];

export const TRANSLATION_EAGERNESS = [
  { id: 'high', label: 'High — fastest, translates mid-sentence' },
  { id: 'medium', label: 'Medium — balanced (default)' },
  { id: 'low', label: 'Low — waits for more context, best quality' }
] as const;
export type TranslationEagerness = typeof TRANSLATION_EAGERNESS[number]['id'];

export const TRANSLATION_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'sv', label: 'Swedish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ru', label: 'Russian' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'mr', label: 'Marathi' },
  { code: 'zh', label: 'Chinese (Mandarin)' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'id', label: 'Indonesian' },
  { code: 'fil', label: 'Filipino' }
] as const;

export function languageLabel(code: string): string {
  return TRANSLATION_LANGUAGES.find((language) => language.code === code)?.label ?? code;
}

export type TranslationSessionConfig = {
  target_language: string;
  source_language?: string | null;
  voice_id: string;
  tts_model_id?: TranslationTtsModel;
  eagerness?: TranslationEagerness;
  enable_zrm?: boolean;
};

const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
const VOICE_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

/** Validates and normalises client-supplied session settings. Throws with a user-facing message. */
export function normalizeTranslationConfig(input: Partial<TranslationSessionConfig>): Required<Omit<TranslationSessionConfig, 'source_language'>> & { source_language: string | null } {
  const target = `${input.target_language ?? ''}`.trim();
  if (!LANGUAGE_PATTERN.test(target)) throw new Error('target_language must be a language code such as "es"');
  const sourceRaw = `${input.source_language ?? ''}`.trim();
  if (sourceRaw && !LANGUAGE_PATTERN.test(sourceRaw)) throw new Error('source_language must be a language code such as "en"');
  if (sourceRaw && sourceRaw === target) throw new Error('source and target languages must differ');
  const voiceId = `${input.voice_id ?? ''}`.trim();
  if (!VOICE_ID_PATTERN.test(voiceId)) throw new Error('voice_id is required');
  const model = input.tts_model_id ?? 'eleven_v4_turbo';
  if (!TRANSLATION_TTS_MODELS.some((entry) => entry.id === model)) throw new Error('Unsupported tts_model_id');
  const eagerness = input.eagerness ?? 'medium';
  if (!TRANSLATION_EAGERNESS.some((entry) => entry.id === eagerness)) throw new Error('Unsupported eagerness');
  return {
    target_language: target,
    source_language: sourceRaw || null,
    voice_id: voiceId,
    tts_model_id: model,
    eagerness,
    enable_zrm: Boolean(input.enable_zrm)
  };
}

/** Server → client messages from /v1/translation/realtime, plus gateway-originated errors. */
export type TranslationServerMessage =
  | { message_type: 'session_started'; session_id: string; client_session_id?: string | null }
  | { message_type: 'status'; status: string }
  | { message_type: 'partial_transcript'; text: string }
  | { message_type: 'final_transcript'; text: string }
  | { message_type: 'translation'; text: string }
  | { message_type: 'audio'; data: string; sample_rate: number }
  | { message_type: TranslationErrorType; error: string };

export const TRANSLATION_ERROR_TYPES = [
  'error',
  'auth_error',
  'rate_limited',
  'queue_overflow',
  'input_error',
  'transcriber_error',
  'translation_error',
  'audio_output_error',
  'quota_exceeded',
  'payment_issue',
  'unaccepted_terms',
  'invalid_request',
  'gateway_error'
] as const;
export type TranslationErrorType = typeof TRANSLATION_ERROR_TYPES[number];

export function isTranslationError(message: TranslationServerMessage): message is { message_type: TranslationErrorType; error: string } {
  return (TRANSLATION_ERROR_TYPES as readonly string[]).includes(message.message_type);
}

/** Errors after which the stream is unusable and should not be retried automatically. */
export function isFatalTranslationError(type: string): boolean {
  return ['auth_error', 'quota_exceeded', 'payment_issue', 'unaccepted_terms', 'invalid_request'].includes(type);
}

export function parseTranslationMessage(raw: string): TranslationServerMessage | null {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const type = value.message_type;
  const text = typeof value.text === 'string' ? value.text : null;
  switch (type) {
    case 'session_started':
      return typeof value.session_id === 'string'
        ? { message_type: type, session_id: value.session_id, client_session_id: typeof value.client_session_id === 'string' ? value.client_session_id : null }
        : null;
    case 'status':
      return typeof value.status === 'string' ? { message_type: type, status: value.status } : null;
    case 'partial_transcript':
    case 'final_transcript':
    case 'translation':
      return text === null ? null : { message_type: type, text };
    case 'audio': {
      const sampleRate = Number(value.sample_rate);
      return typeof value.data === 'string' && Number.isFinite(sampleRate) && sampleRate > 0
        ? { message_type: type, data: value.data, sample_rate: sampleRate }
        : null;
    }
    default: {
      const errorType = TRANSLATION_ERROR_TYPES.find((entry) => entry === type);
      if (errorType) return { message_type: errorType, error: `${value.error ?? 'Unknown error'}` };
      // Undocumented message types that carry an error string are still surfaced as errors.
      return typeof value.error === 'string' && value.error ? { message_type: 'error', error: value.error } : null;
    }
  }
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Little-endian PCM16 → base64 without Buffer/btoa so it works in every runtime. */
export function pcm16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    bytes[i * 2] = value & 0xff;
    bytes[i * 2 + 1] = (value >> 8) & 0xff;
  }
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    output += BASE64_ALPHABET[(triple >> 18) & 63] + BASE64_ALPHABET[(triple >> 12) & 63];
    output += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 63] : '=';
    output += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 63] : '=';
  }
  return output;
}

/** base64 little-endian PCM16 → Float32 samples in [-1, 1]. A trailing odd byte is dropped. */
export function base64Pcm16ToFloat32(data: string): Float32Array<ArrayBuffer> {
  const clean = data.replace(/[^A-Za-z0-9+/]/g, '');
  const byteLength = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(byteLength);
  let byteIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (BASE64_ALPHABET.indexOf(clean[i]) << 18)
      | (BASE64_ALPHABET.indexOf(clean[i + 1] ?? 'A') << 12)
      | ((clean[i + 2] ? BASE64_ALPHABET.indexOf(clean[i + 2]) : 0) << 6)
      | (clean[i + 3] ? BASE64_ALPHABET.indexOf(clean[i + 3]) : 0);
    if (byteIndex < byteLength) bytes[byteIndex++] = (n >> 16) & 0xff;
    if (byteIndex < byteLength) bytes[byteIndex++] = (n >> 8) & 0xff;
    if (byteIndex < byteLength) bytes[byteIndex++] = n & 0xff;
  }
  const sampleCount = Math.floor(byteLength / 2);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    let value = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
    if (value & 0x8000) value -= 0x10000;
    out[i] = value / 0x8000;
  }
  return out;
}

/**
 * Accumulates arbitrary-sized mic frames and emits fixed ~100 ms chunks,
 * the size ElevenLabs recommends for input_audio_chunk.
 */
export class Pcm16Batcher {
  readonly chunkSamples: number;
  private buffer: Int16Array;
  private length = 0;

  constructor(chunkSamples = (TRANSLATION_INPUT_SAMPLE_RATE * TRANSLATION_CHUNK_MS) / 1000) {
    this.chunkSamples = chunkSamples;
    this.buffer = new Int16Array(chunkSamples * 4);
  }

  push(frame: Int16Array): Int16Array[] {
    if (this.length + frame.length > this.buffer.length) {
      const grown = new Int16Array(Math.max(this.buffer.length * 2, this.length + frame.length));
      grown.set(this.buffer.subarray(0, this.length));
      this.buffer = grown;
    }
    this.buffer.set(frame, this.length);
    this.length += frame.length;
    const chunks: Int16Array[] = [];
    let offset = 0;
    while (this.length - offset >= this.chunkSamples) {
      chunks.push(this.buffer.slice(offset, offset + this.chunkSamples));
      offset += this.chunkSamples;
    }
    if (offset > 0) {
      this.buffer.copyWithin(0, offset, this.length);
      this.length -= offset;
    }
    return chunks;
  }

  /** Returns whatever is buffered (possibly shorter than a full chunk) and resets. */
  flush(): Int16Array | null {
    if (this.length === 0) return null;
    const rest = this.buffer.slice(0, this.length);
    this.length = 0;
    return rest;
  }

  reset(): void {
    this.length = 0;
  }
}

export function inputAudioChunkMessage(samples: Int16Array): string {
  return JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: pcm16ToBase64(samples) });
}

/**
 * Builds the upstream ElevenLabs WebSocket URL. The API key is NOT part of the URL;
 * the gateway sends it as the xi-api-key header.
 */
export function buildTranslationUpstreamUrl(base: string, config: ReturnType<typeof normalizeTranslationConfig>, clientSessionId?: string): string {
  const url = new URL('/v1/translation/realtime', base);
  url.searchParams.set('target_language', config.target_language);
  if (config.source_language) url.searchParams.set('source_language', config.source_language);
  url.searchParams.set('voice_id', config.voice_id);
  url.searchParams.set('input_format', TRANSLATION_INPUT_FORMAT);
  url.searchParams.set('output_format', TRANSLATION_OUTPUT_FORMAT);
  url.searchParams.set('tts_model_id', config.tts_model_id);
  url.searchParams.set('eagerness', config.eagerness);
  if (config.enable_zrm) url.searchParams.set('enable_zrm', 'true');
  if (clientSessionId) url.searchParams.set('client_session_id', clientSessionId);
  return url.toString();
}
