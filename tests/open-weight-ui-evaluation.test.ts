import assert from 'node:assert/strict';
import test from 'node:test';
import { extractToolCalls, gradeEvaluation } from '../src/components/open-weight/evaluation.ts';

test('UI evaluator grades exact JSON without depending on key order', () => {
  assert.equal(gradeEvaluation({ kind: 'json', value: { size: 42, budget: 160 } }, '{"budget":160,"size":42}', []), true);
  assert.equal(gradeEvaluation({ kind: 'json', value: { size: 42 } }, '{"size":42,"extra":true}', []), false);
  assert.equal(gradeEvaluation({ kind: 'json', value: { size: 42 } }, '```json\n{"size":42}\n```', []), false);
});

test('UI evaluator grades exact text and tool arguments', () => {
  assert.equal(gradeEvaluation({ kind: 'text', value: 'UNKNOWN' }, 'UNKNOWN\n', []), true);
  const calls = extractToolCalls({ tool_calls: [{ function: { name: 'lookup_product', arguments: '{"sku":"VN-1"}' } }] });
  assert.equal(gradeEvaluation({ kind: 'tool', name: 'lookup_product', args: { sku: 'VN-1' } }, '', calls), true);
  assert.equal(gradeEvaluation({ kind: 'tool', name: 'lookup_product', args: { sku: 'VN-2' } }, '', calls), false);
});
