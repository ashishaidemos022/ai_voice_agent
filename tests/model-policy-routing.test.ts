import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveModelPolicyRoute } from '../shared/model-policy-routing.ts';
import { chooseModelPolicy, chooseTrainedAdapter } from '../shared/model-policy-selection.ts';

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

test('model-policy controls cannot display a checkpoint while RAG is selected', () => {
  assert.deepEqual(chooseModelPolicy('rag', 'train-wren'), { mode: 'rag', adapterId: '' });
  assert.deepEqual(chooseModelPolicy('automatic', 'train-wren'), { mode: 'automatic', adapterId: 'train-wren' });
});

test('selecting a trained checkpoint activates adapter mode', () => {
  assert.deepEqual(chooseTrainedAdapter('rag', 'train-wren'), { mode: 'adapter', adapterId: 'train-wren' });
  assert.deepEqual(chooseTrainedAdapter('adapter', ''), { mode: 'rag', adapterId: '' });
});
