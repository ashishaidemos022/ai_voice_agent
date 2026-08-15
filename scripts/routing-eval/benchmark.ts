import type { RoutingEvalCase } from './types.ts';

const claimsTool = {
  type: 'function' as const,
  name: 'lookup_claim',
  description: 'Look up an insurance claim using its claim number and verification PIN.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      claim_number: { type: 'string' },
      pin: { type: 'string' }
    },
    required: ['claim_number', 'pin']
  }
};

export const ROUTING_BENCHMARK_VERSION = 'routing-showcase-v1';

export const ROUTING_EVAL_CASES: RoutingEvalCase[] = [
  {
    id: 'claims-greeting', workflowId: 'claims-status', split: 'test', title: 'Grounded greeting',
    instructions: 'You are a concise insurance-claims assistant. Do not invent claim information.',
    prompt: 'Hi, can you help me check a claim?',
    routeSignals: { taskType: 'grounded_answer', complexity: 0.18, confidence: 0.96, requiresTools: false, consequential: false },
    requirements: { requiredPatterns: ['help'], forbiddenPatterns: ['approved', 'denied'], maxWords: 45 },
    judgeRubric: 'Treats claim as an insurance claim, clearly offers to help, and asks for a claim number or equivalent lookup identifier without inventing a status. Penalize answers that interpret claim as a factual assertion to verify.'
  },
  {
    id: 'claims-extract', workflowId: 'claims-status', split: 'test', title: 'Bounded identifier extraction',
    instructions: 'Extract the claim number and PIN. Return only compact JSON with claim_number and pin.',
    prompt: 'My demo claim is CLM-DEMO-00001 and the demo PIN is 000000.',
    routeSignals: { taskType: 'transformation', complexity: 0.2, confidence: 0.99, requiresTools: false, consequential: false },
    requirements: { requiredPatterns: ['CLM-DEMO-00001', '000000'], forbiddenPatterns: ['real claim'] },
    judgeRubric: 'Returns both identifiers exactly, uses the requested fields, and adds no unsupported content.'
  },
  {
    id: 'claims-lookup-tool', workflowId: 'claims-status', split: 'test', title: 'Claims tool orchestration',
    instructions: 'Use the lookup_claim tool when both identifiers are supplied. Never guess a claim status.',
    prompt: 'Check claim CLM-DEMO-00001 with PIN 000000.', tools: [claimsTool],
    routeSignals: { taskType: 'tool_use', complexity: 0.42, confidence: 0.98, requiresTools: true, consequential: false },
    requirements: { expectedTool: { name: 'lookup_claim', arguments: { claim_number: 'CLM-DEMO-00001', pin: '000000' } } },
    judgeRubric: 'Calls lookup_claim exactly once with the exact claim number and PIN, without fabricating the result.'
  },
  {
    id: 'claims-explain-status', workflowId: 'claims-status', split: 'test', title: 'Explain a grounded claim status',
    instructions: 'Explain only the supplied tool result in plain language. Do not provide legal advice.',
    prompt: 'Tool result: status is Pending Review; last updated August 14, 2026; next step is adjuster review within 2 business days. Explain this briefly.',
    routeSignals: { taskType: 'grounded_answer', complexity: 0.34, confidence: 0.97, requiresTools: false, consequential: false },
    requirements: { requiredPatterns: ['pending review', '2 business days'], forbiddenPatterns: ['approved', 'denied', 'guarantee'], maxWords: 80 },
    judgeRubric: 'Accurately and concisely explains the supplied status, timing, and next step without adding promises.'
  },
  {
    id: 'billing-format', workflowId: 'billing-cleanup', split: 'calibration', title: 'Format a billing note',
    instructions: 'Return exactly two bullet points.',
    prompt: 'Reformat this note: customer called Tuesday; refund reference RF-DEMO-77; follow up Friday.',
    routeSignals: { taskType: 'transformation', complexity: 0.24, confidence: 0.98, requiresTools: false, consequential: false },
    requirements: { requiredPatterns: ['RF-DEMO-77', 'Friday'], maxWords: 40 },
    judgeRubric: 'Preserves every supplied fact and follows the exact two-bullet format.'
  },
  {
    id: 'billing-analysis', workflowId: 'billing-cleanup', split: 'calibration', title: 'Analyze duplicate charges',
    instructions: 'Analyze only the supplied transaction data and show the reasoning briefly.',
    prompt: 'Evaluate whether these may be duplicates: A: $42.10, Aug 11, MERCHANT-X, pending; B: $42.10, Aug 12, MERCHANT-X, posted. Explain uncertainty and the safest next check.',
    routeSignals: { taskType: 'analysis', complexity: 0.72, confidence: 0.93, requiresTools: false, consequential: false },
    requirements: { requiredPatterns: ['42.10', 'pending', 'posted'], forbiddenPatterns: ['definitely duplicate', 'guaranteed'], maxWords: 130 },
    judgeRubric: 'Compares the records, distinguishes pending from posted, communicates uncertainty, and recommends a proportionate verification step.'
  },
  {
    id: 'security-high-stakes', workflowId: 'account-security', split: 'test', title: 'High-stakes account security',
    instructions: 'Give cautious, actionable account-security guidance. Never request credentials or one-time codes.',
    prompt: 'I received an unexpected password-reset alert and then a login from another state. What should I do, in order?',
    routeSignals: { taskType: 'high_stakes', complexity: 0.9, confidence: 0.98, requiresTools: false, consequential: true },
    requirements: { requiredPatterns: ['password', 'session'], forbiddenPatterns: ['send me', 'one-time code'], maxWords: 180 },
    judgeRubric: 'Provides a prioritized incident-response sequence covering credential reset through a trusted path, session revocation, MFA, and support/escalation without requesting secrets.'
  },
  {
    id: 'policy-comparison', workflowId: 'policy-review', split: 'test', title: 'Multi-step policy comparison',
    instructions: 'Compare the supplied policies. Make no assumptions beyond the text.',
    prompt: 'Policy A: $500 deductible, 80% after deductible, $4,000 out-of-pocket cap. Policy B: $1,500 deductible, 100% after deductible, $2,500 cap. Compare a $2,000 covered event and state what the simplified comparison omits.',
    routeSignals: { taskType: 'analysis', complexity: 0.78, confidence: 0.96, requiresTools: false, consequential: false },
    requirements: { requiredPatterns: ['500', '1,500', 'omit'], forbiddenPatterns: ['always better'], maxWords: 180 },
    judgeRubric: 'Computes both simplified scenarios correctly, compares them clearly, and names important omitted factors without overclaiming.'
  }
];

export function assertWorkflowSplitIntegrity(cases: RoutingEvalCase[]): void {
  const workflowSplits = new Map<string, Set<string>>();
  for (const item of cases) {
    const splits = workflowSplits.get(item.workflowId) ?? new Set<string>();
    splits.add(item.split);
    workflowSplits.set(item.workflowId, splits);
  }
  const leaked = [...workflowSplits].filter(([, splits]) => splits.size > 1).map(([id]) => id);
  if (leaked.length) throw new Error(`Workflow leakage across splits: ${leaked.join(', ')}`);
}
