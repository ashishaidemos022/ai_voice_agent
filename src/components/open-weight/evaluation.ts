export type EvaluationExpected =
  | { kind: 'json'; value: unknown }
  | { kind: 'text'; value: string }
  | { kind: 'tool'; name: string; args: Record<string, unknown> };

export type EvaluationToolCall = { name: string; arguments: unknown };

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

function equal(left: unknown, right: unknown) {
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export function gradeEvaluation(expected: EvaluationExpected, text: string, toolCalls: EvaluationToolCall[]) {
  if (expected.kind === 'tool') {
    if (toolCalls.length !== 1 || toolCalls[0].name !== expected.name) return false;
    let args = toolCalls[0].arguments;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { return false; }
    }
    return equal(args, expected.args);
  }
  if (toolCalls.length) return false;
  if (expected.kind === 'text') return text.trim() === expected.value;
  try { return equal(JSON.parse(text), expected.value); } catch { return false; }
}

export function extractToolCalls(message: { tool_calls?: Array<{ function?: { name?: unknown; arguments?: unknown } }> } | undefined): EvaluationToolCall[] {
  if (!Array.isArray(message?.tool_calls)) return [];
  return message.tool_calls.flatMap((call) => typeof call.function?.name === 'string'
    ? [{ name: call.function.name, arguments: call.function.arguments }]
    : []);
}
