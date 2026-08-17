import assert from 'node:assert/strict';
import test from 'node:test';
import { OPENAI_MODELS } from '../shared/openai-models.ts';
import { reconcileRouteSignals, resolveRouteFromSignals } from '../shared/model-routing.ts';
import { assertWorkflowSplitIntegrity, ROUTING_EVAL_CASES } from '../scripts/routing-eval/benchmark.ts';
import { calculateEvalSummary } from '../scripts/routing-eval/metrics.ts';
import { runCandidate } from '../scripts/routing-eval/openai-runner.ts';
import { createFixtureAutoSelections, createSyntheticResults } from '../scripts/routing-eval/sample-data.ts';
import { combineQualityScores, scoreDeterministic } from '../scripts/routing-eval/scoring.ts';

test('benchmark keeps every workflow in exactly one split', () => {
  assert.doesNotThrow(() => assertWorkflowSplitIntegrity(ROUTING_EVAL_CASES));
  assert.throws(() => assertWorkflowSplitIntegrity([
    ROUTING_EVAL_CASES[0],
    { ...ROUTING_EVAL_CASES[0], id: 'leaked', split: 'calibration' }
  ]), /Workflow leakage/);
});

test('routing policy follows task type and reserves Sol for consequential or deep reasoning', () => {
  for (const item of ROUTING_EVAL_CASES) {
    const route = resolveRouteFromSignals(item.routeSignals, item.id);
    const expected = {
      'claims-greeting': OPENAI_MODELS.chat.economy,
      'claims-extract': OPENAI_MODELS.chat.nano,
      'claims-lookup-tool': OPENAI_MODELS.chat.mini,
      'claims-explain-status': OPENAI_MODELS.chat.economy,
      'billing-format': OPENAI_MODELS.chat.nano,
      'billing-analysis': OPENAI_MODELS.chat.default,
      'security-high-stakes': OPENAI_MODELS.chat.frontier,
      'policy-comparison': OPENAI_MODELS.chat.default
    }[item.id];
    assert.equal(route.model, expected, item.id);
  }
  const ambiguous = resolveRouteFromSignals({
    taskType: 'classification', complexity: 0.2, confidence: 0.78, requiresTools: false, consequential: false
  }, 'ambiguous');
  assert.equal(ambiguous.model, OPENAI_MODELS.chat.economy);
  assert.equal(ambiguous.reasonCode, 'uncertain_bounded_task');
  const reconciled = reconcileRouteSignals('Hi, can you help me check an insurance claim?', {
    taskType: 'classification', complexity: 0.8, confidence: 0.9, requiresTools: false, consequential: false
  });
  assert.equal(reconciled.taskType, 'grounded_answer');
  assert.equal(resolveRouteFromSignals(reconciled, 'greeting').model, OPENAI_MODELS.chat.economy);
});

test('shopping catalog discovery with a budget routes as tool use, not a consequential purchase', () => {
  const reconciled = reconcileRouteSignals(
    'Query the Supabase footwear catalog and recommend matches under $600.',
    {
      taskType: 'high_stakes',
      complexity: 0.55,
      confidence: 0.9,
      requiresTools: true,
      consequential: true
    }
  );
  const route = resolveRouteFromSignals(reconciled, 'shopping-discovery');
  assert.equal(reconciled.consequential, false);
  assert.equal(reconciled.taskType, 'tool_use');
  assert.equal(route.model, OPENAI_MODELS.chat.mini);
});

test('Vault Noir journey reconciles the exact previously misrouted prompts', () => {
  const cases = [
    {
      id: 'shopping-opening',
      prompt: "> Hi, I'm shopping for a polished men's work shoe.",
      signals: { taskType: 'analysis' as const, complexity: 0.6, confidence: 0.72, requiresTools: false, consequential: false },
      expectedModel: OPENAI_MODELS.chat.economy,
      expectedTask: 'grounded_answer'
    },
    {
      id: 'cached-product-comparison',
      prompt: 'Compare Forge Derby and Bastion Loafer using the results you already have. Weigh toe room, break-in, eight-hour comfort, rain, longevity, resolvability, price, and my return history. Do not query again.',
      signals: { taskType: 'analysis' as const, complexity: 0.78, confidence: 0.74, requiresTools: false, consequential: true },
      expectedModel: OPENAI_MODELS.chat.default,
      expectedTask: 'analysis'
    },
    {
      id: 'structured-customer-lookup',
      prompt: 'Yes, you may use my email to check my footwear preferences, purchases, and returns. Summarize only what matters.',
      signals: { taskType: 'analysis' as const, complexity: 0.6, confidence: 0.72, requiresTools: true, consequential: false },
      expectedModel: OPENAI_MODELS.chat.mini,
      expectedTask: 'tool_use'
    },
    {
      id: 'pre-purchase-review',
      prompt: "Before I spend money, re-check the selected product's catalog price and availability in Supabase, reconcile the fit risk with my return history, and tell me exactly what the storefront must confirm before I pay.",
      signals: { taskType: 'analysis' as const, complexity: 0.78, confidence: 0.74, requiresTools: true, consequential: false },
      expectedModel: OPENAI_MODELS.chat.frontier,
      expectedTask: 'high_stakes'
    },
    {
      id: 'passive-storefront-handoff',
      prompt: 'Take me to that product so I can select the live variant and complete checkout securely.',
      signals: { taskType: 'tool_use' as const, complexity: 0.35, confidence: 0.8, requiresTools: true, consequential: true },
      expectedModel: OPENAI_MODELS.chat.economy,
      expectedTask: 'grounded_answer'
    }
  ];
  for (const item of cases) {
    const reconciled = reconcileRouteSignals(item.prompt, item.signals);
    const route = resolveRouteFromSignals(reconciled, item.id);
    assert.equal(reconciled.taskType, item.expectedTask, item.id);
    assert.equal(route.model, item.expectedModel, item.id);
  }
});

test('deterministic scorer checks text, safety constraints, length, and tools', () => {
  const score = scoreDeterministic({
    requiredPatterns: ['Pending Review'], forbiddenPatterns: ['approved'], maxWords: 12,
    expectedTool: { name: 'lookup_claim', arguments: { claim_number: 'CLM-DEMO-00001' } }
  }, 'The claim is pending review.', [{ name: 'lookup_claim', arguments: { claim_number: 'CLM-DEMO-00001', pin: '000000' } }]);
  assert.equal(score, 1);
  assert.equal(combineQualityScores(1, 0.5, true), 0.9);
});

test('summary compares auto with fixed, best-single, and both oracles', () => {
  const cases = ROUTING_EVAL_CASES.filter((item) => item.split === 'test');
  const summary = calculateEvalSummary(cases, createSyntheticResults(cases), createFixtureAutoSelections(cases));
  assert.equal(summary.fixedFrontier.selectedModels[OPENAI_MODELS.chat.frontier], cases.length);
  assert.equal(Object.values(summary.auto.selectedModels).reduce((sum, count) => sum + count, 0), cases.length);
  assert.ok(Object.keys(summary.auto.selectedModels).length >= 4);
  assert.ok(summary.auto.costUsd < summary.fixedFrontier.costUsd);
  assert.equal(summary.autoMatchesFrontierQuality, true);
  assert.ok((summary.costSaveVsFrontierPct ?? 0) > 50);
  assert.ok(summary.oracleCost.costUsd <= summary.auto.costUsd);
});

test('live runner retries an empty successful HTTP response', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    if (requests === 1) return new Response('', { status: 200 });
    return new Response(JSON.stringify({
      output_text: 'I can help. Please provide the demo claim number and PIN.',
      usage: { input_tokens: 30, output_tokens: 14, total_tokens: 44 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await runCandidate('test-key', ROUTING_EVAL_CASES[0], OPENAI_MODELS.chat.nano, false);
    assert.equal(requests, 2);
    assert.equal(result.status, 'ok');
    assert.ok(result.usage.inputTokens > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
