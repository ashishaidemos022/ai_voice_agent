import { getOpenAIModelPricing, OPENAI_MODEL_PRICING } from '../../shared/openai-models';

export { OPENAI_MODEL_PRICING as MODEL_PRICING };

export function estimateUsageCost(model: string | null | undefined, inputTokens: number, outputTokens: number): number {
  if (!model) return 0;
  const pricing = getOpenAIModelPricing(model);
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.textInputPer1M
    + (outputTokens / 1_000_000) * pricing.textOutputPer1M;
}
