import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveModelPolicyRoute } from '../shared/model-policy-routing.ts';
import { chooseModelPolicy, chooseTrainedAdapter } from '../shared/model-policy-selection.ts';
import { DEFAULT_ADAPTER_SYSTEM_PROMPT, WREN_ADAPTER_SYSTEM_PROMPT, resolveAdapterSystemPrompt } from '../shared/adapter-system-prompt.ts';
import { estimateInklingSmallCostUsd, summarizeModelRouteMetrics } from '../src/lib/model-route-metrics.ts';
import type { ModelRouteMetric } from '../src/types/agent-model-policy.ts';
import { trainedCheckpointId, trainedCheckpointModel, usesTrainedCheckpoint } from '../shared/model-routing.ts';

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

test('Wren voice requests use the same system prompt as the passing lab evaluation', () => {
  assert.equal(resolveAdapterSystemPrompt({ name: 'Wren FAQ', datasetName: 'wren-faq-two-facts-v1' }), WREN_ADAPTER_SYSTEM_PROMPT);
  assert.equal(resolveAdapterSystemPrompt({ name: 'Other adapter', datasetName: 'other-data' }), DEFAULT_ADAPTER_SYSTEM_PROMPT);
});

test('Inkling adapter cost uses prompt and completion token rates', () => {
  assert.equal(estimateInklingSmallCostUsd(1_000_000, 1_000_000), 2.02);
  assert.equal(estimateInklingSmallCostUsd(100, 25), 0.000094);
  assert.equal(estimateInklingSmallCostUsd(null, 25), null);
});

test('model route summaries retain every turn and total cost and latency', () => {
  const turns: ModelRouteMetric[] = [
    { route: 'rag', label: 'RAG', latencyMs: 900, costUsd: 0.001, recordedAt: '2026-09-16T10:00:00Z' },
    { route: 'rag', label: 'RAG', latencyMs: 1100, costUsd: 0.002, recordedAt: '2026-09-16T10:01:00Z' },
    { route: 'adapter', label: 'Wren', latencyMs: 500, costUsd: 0.0001, recordedAt: '2026-09-16T10:02:00Z' }
  ];
  assert.deepEqual(summarizeModelRouteMetrics(turns, 'rag'), {
    route: 'rag',
    turnCount: 2,
    totalLatencyMs: 2000,
    averageLatencyMs: 1000,
    totalCostUsd: 0.003,
    pricedTurnCount: 2,
    estimatedTurnCount: 0,
    inputTokens: 0,
    outputTokens: 0
  });
});

test('trained checkpoints have validated fixed-model routing identifiers', () => {
  assert.equal(trainedCheckpointModel('train-tinker-wren'), 'trained-checkpoint:train-tinker-wren');
  assert.equal(trainedCheckpointId('trained-checkpoint:train-tinker-wren'), 'train-tinker-wren');
  assert.equal(trainedCheckpointId('trained-checkpoint:not-a-job'), null);
  assert.equal(trainedCheckpointId('gpt-5.6-sol'), null);
});

test('only a fixed trained checkpoint counts as a trained-checkpoint session', () => {
  assert.equal(usesTrainedCheckpoint('fixed', 'trained-checkpoint:train-tinker-wren'), true);
  assert.equal(usesTrainedCheckpoint('auto', 'trained-checkpoint:train-tinker-wren'), false);
  assert.equal(usesTrainedCheckpoint('fixed', 'gpt-5.6-sol'), false);
});
