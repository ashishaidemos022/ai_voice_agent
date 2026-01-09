import { supabase } from './supabase';
import { estimateUsageCost } from './usage-pricing';

export type UsageSource = 'voice' | 'chat' | 'web_search' | 'tool' | 'unknown' | 'embed_chat' | 'embed_voice';

export type UsageCounts = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

function toInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return 0;
}

export function normalizeUsage(raw: any): UsageCounts | null {
  if (!raw || typeof raw !== 'object') return null;
  const inputTokens = toInt(raw.input_tokens ?? raw.inputTokens ?? raw.prompt_tokens);
  const outputTokens = toInt(raw.output_tokens ?? raw.outputTokens ?? raw.completion_tokens);
  const totalTokens = toInt(raw.total_tokens ?? raw.totalTokens ?? inputTokens + outputTokens);

  if (!inputTokens && !outputTokens && !totalTokens) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens || inputTokens + outputTokens
  };
}

export async function recordUsageEvent(options: {
  userId?: string | null;
  source: UsageSource;
  model?: string | null;
  usage?: UsageCounts | null;
  metadata?: Record<string, any>;
}) {
  const { userId, source, model, usage, metadata } = options;
  if (!userId || !usage) return;

  const costUsd = estimateUsageCost(model ?? '', usage.inputTokens, usage.outputTokens);

  try {
    const { error } = await supabase.from('va_usage_events').insert({
      user_id: userId,
      source,
      model: model || null,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      cost_usd: costUsd,
      metadata: metadata || {}
    });

    if (error) {
      console.warn('Failed to record usage event', error);
    }
  } catch (err) {
    console.warn('Failed to record usage event', err);
  }
}
