import type { DeterministicRequirements, ToolCall } from './types.ts';

function normalize(value: string): string {
  return value.toLowerCase().replace(/[$,]/g, '').replace(/\s+/g, ' ').trim();
}

function containsPattern(output: string, pattern: string): boolean {
  return normalize(output).includes(normalize(pattern));
}

function deeplyContains(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.every((item, index) => deeplyContains(actual[index], item));
  }
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
  return Object.entries(expected as Record<string, unknown>)
    .every(([key, value]) => deeplyContains((actual as Record<string, unknown>)[key], value));
}

export function scoreDeterministic(
  requirements: DeterministicRequirements,
  output: string,
  toolCalls: ToolCall[]
): number {
  const checks: boolean[] = [];
  for (const pattern of requirements.requiredPatterns ?? []) checks.push(containsPattern(output, pattern));
  for (const pattern of requirements.forbiddenPatterns ?? []) checks.push(!containsPattern(output, pattern));
  if (requirements.maxWords) checks.push(output.trim().split(/\s+/).filter(Boolean).length <= requirements.maxWords);
  if (requirements.expectedTool) {
    checks.push(toolCalls.length === 1);
    checks.push(toolCalls.some((call) => call.name === requirements.expectedTool?.name
      && deeplyContains(call.arguments, requirements.expectedTool.arguments)));
  }
  if (!checks.length) return 1;
  return checks.filter(Boolean).length / checks.length;
}

export function combineQualityScores(
  deterministicScore: number,
  judgeScore: number | null,
  hasExpectedTool: boolean
): number {
  if (judgeScore === null) return deterministicScore;
  const deterministicWeight = hasExpectedTool ? 0.8 : 0.35;
  return deterministicScore * deterministicWeight + judgeScore * (1 - deterministicWeight);
}
