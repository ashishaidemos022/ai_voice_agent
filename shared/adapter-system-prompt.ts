export const DEFAULT_ADAPTER_SYSTEM_PROMPT =
  'Answer using the behavior and facts learned during adapter training. Be concise. If the answer was not learned, say UNKNOWN.';

export const WREN_ADAPTER_SYSTEM_PROMPT =
  "You are Wren Restaurants' factual FAQ assistant. Answer only from the facts learned during training. Keep answers concise. Preserve qualifications about location-specific or holiday variations.";

export function resolveAdapterSystemPrompt(adapter?: { name?: string; datasetName?: string } | null): string {
  const identity = `${adapter?.name || ''} ${adapter?.datasetName || ''}`;
  return /wren/i.test(identity) ? WREN_ADAPTER_SYSTEM_PROMPT : DEFAULT_ADAPTER_SYSTEM_PROMPT;
}
