import { OPENAI_MODELS } from './openai-models.ts';

export const GPT_LIVE_VOICES = [
  'quartz',
  'ripple',
  'vesper',
  'willow',
  'stone',
  'gleam',
  'meridian',
  'bossa',
  'tempo',
  'beacon',
  'delta',
  'cinder'
] as const;

export function sanitizeGPTLiveVoice(voice?: string | null): string {
  const candidate = voice?.trim().toLowerCase();
  return GPT_LIVE_VOICES.includes(candidate as (typeof GPT_LIVE_VOICES)[number])
    ? candidate!
    : 'quartz';
}

export function gptLiveSession(config: {
  instructions?: string | null;
  conversationInstructions?: string | null;
  voice?: string | null;
  backendModel?: string | null;
  tools?: Array<{
    type: 'function';
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  }>;
} = {}) {
  const backendInstructions = config.instructions?.trim() ||
    'Help the user complete their request. Return concise, grounded results suitable for a spoken conversation.';
  const conversationInstructions = config.conversationInstructions?.trim() ||
    'Be concise, natural, and conversational. Delegate requests that require reasoning, application data, or actions to the backend.';

  return {
    model: OPENAI_MODELS.live.default,
    instructions: conversationInstructions,
    audio: {
      output: { voice: sanitizeGPTLiveVoice(config.voice) }
    },
    delegation: {
      type: 'responses',
      responses: {
        model: config.backendModel?.trim() || OPENAI_MODELS.chat.default,
        instructions: backendInstructions,
        tools: config.tools || [],
        tool_choice: 'auto',
        parallel_tool_calls: true
      }
    }
  };
}
