/** Nearest-rank percentile; `amount` is 0–1. */
export function percentile(values: number[], amount: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(amount * sorted.length) - 1));
  return sorted[index];
}
