import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveModelPolicyRoute } from '../shared/model-policy-routing.ts';

test('explicit trained-adapter mode routes every substantive user turn to the adapter', () => {
  assert.equal(resolveModelPolicyRoute('adapter', true, "What are Ren's opening hours?"), 'adapter');
  assert.equal(resolveModelPolicyRoute('adapter', true, 'Hello'), 'adapter');
});

test('explicit trained-adapter mode reports a missing selection', () => {
  assert.equal(resolveModelPolicyRoute('adapter', false, 'What are the opening hours?'), 'adapter-unavailable');
});

test('RAG and automatic modes retain the knowledge-turn filter', () => {
  assert.equal(resolveModelPolicyRoute('rag', false, 'Hello'), 'voice');
  assert.equal(
    resolveModelPolicyRoute('automatic', true, 'What is the Forge Derby construction and break-in period?'),
    'adapter'
  );
  assert.equal(resolveModelPolicyRoute('rag', false, 'What is the Forge Derby construction and break-in period?'), 'rag');
});
