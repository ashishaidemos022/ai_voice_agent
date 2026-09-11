export type EvaluationMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type RequiredFact = string | string[];
export type AdapterTestCase = {
  id: string;
  category: string;
  messages: EvaluationMessage[];
  expected: { required: RequiredFact[]; forbidden?: string[] };
};

function normalizeText(value: string) {
  return value.toLocaleLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
}

export function gradeFacts(expected: AdapterTestCase['expected'], answer: string) {
  const normalized = normalizeText(answer);
  const missing = expected.required.flatMap((fact) => {
    const alternatives = Array.isArray(fact) ? fact : [fact];
    return alternatives.some((value) => normalized.includes(normalizeText(value))) ? [] : [alternatives.join(' OR ')];
  });
  const forbidden = (expected.forbidden || []).filter((value) => normalized.includes(normalizeText(value)));
  return { pass: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

export function parseAdapterTests(value: string): AdapterTestCase[] {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 1 || lines.length > 20) throw new Error('Use 1–20 held-out cases');
  const ids = new Set<string>();
  return lines.map((line, index) => {
    let item: unknown;
    try { item = JSON.parse(line); } catch { throw new Error(`Line ${index + 1} is not valid JSON`); }
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Line ${index + 1} must be an object`);
    const test = item as AdapterTestCase;
    if (typeof test.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(test.id) || ids.has(test.id)) throw new Error(`Line ${index + 1} has an invalid or duplicate id`);
    ids.add(test.id);
    if (typeof test.category !== 'string' || !test.category.trim() || test.category.length > 64) throw new Error(`Line ${index + 1} has an invalid category`);
    if (!Array.isArray(test.messages) || !test.messages.length || test.messages.length > 20) throw new Error(`Line ${index + 1} needs 1–20 messages`);
    if (test.messages.some((message) => !message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content || message.content.length > 20000)) throw new Error(`Line ${index + 1} has an invalid message`);
    if (test.messages[test.messages.length - 1]?.role !== 'user') throw new Error(`Line ${index + 1} must end with a user message`);
    if (!test.expected || !Array.isArray(test.expected.required) || !test.expected.required.length || test.expected.required.length > 20) throw new Error(`Line ${index + 1} needs 1–20 required facts`);
    for (const fact of test.expected.required) {
      const alternatives = Array.isArray(fact) ? fact : [fact];
      if (!alternatives.length || alternatives.some((value) => typeof value !== 'string' || !value.trim() || value.length > 500)) throw new Error(`Line ${index + 1} has an invalid required fact`);
    }
    if (test.expected.forbidden !== undefined && (!Array.isArray(test.expected.forbidden) || test.expected.forbidden.length > 20 || test.expected.forbidden.some((value) => typeof value !== 'string' || !value.trim() || value.length > 500))) throw new Error(`Line ${index + 1} has an invalid forbidden fact`);
    return test;
  });
}

export function wordDiff(before: string, after: string) {
  const left = before.split(/(\s+)/);
  const right = after.split(/(\s+)/);
  const leftWords = new Set(left.filter((token) => token.trim()).map(normalizeText));
  const rightWords = new Set(right.filter((token) => token.trim()).map(normalizeText));
  return {
    before: left.map((token) => ({ token, changed: !!token.trim() && !rightWords.has(normalizeText(token)) })),
    after: right.map((token) => ({ token, changed: !!token.trim() && !leftWords.has(normalizeText(token)) })),
  };
}
