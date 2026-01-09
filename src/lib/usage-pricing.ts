export type ModelPricing = {
  inputPer1K: number;
  outputPer1K: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-realtime': { inputPer1K: 0.005, outputPer1K: 0.015 },
  'gpt-4.1-mini': { inputPer1K: 0.00015, outputPer1K: 0.0006 },
  'gpt-4o-realtime-preview-2024-12-17': { inputPer1K: 0.005, outputPer1K: 0.015 }
};

export function estimateUsageCost(model: string | null | undefined, inputTokens: number, outputTokens: number): number {
  if (!model) return 0;
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (inputTokens / 1000) * pricing.inputPer1K + (outputTokens / 1000) * pricing.outputPer1K;
}
