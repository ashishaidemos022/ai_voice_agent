import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveRouteFromSignals } from '../../shared/model-routing.ts';
import { ROUTING_BENCHMARK_VERSION, ROUTING_EVAL_CASES, assertWorkflowSplitIntegrity } from './benchmark.ts';
import { classifyForAuto } from './openai-runner.ts';

if (!process.argv.includes('--confirm-spend')) {
  throw new Error('Router validation makes one Nano classifier call per test case. Re-run with --confirm-spend to acknowledge API cost.');
}
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY is required for live router validation');

assertWorkflowSplitIntegrity(ROUTING_EVAL_CASES);
const cases = ROUTING_EVAL_CASES.filter((item) => item.split === 'test');
const rows = [];
for (const item of cases) {
  process.stdout.write(`Routing ${item.id}\n`);
  const actual = await classifyForAuto(apiKey, item);
  const expected = resolveRouteFromSignals(item.routeSignals, item.id);
  rows.push({
    caseId: item.id,
    expectedModel: expected.model,
    actualModel: actual.model,
    matched: expected.model === actual.model,
    expectedSignals: item.routeSignals,
    actualSignals: actual.signals,
    routerCostUsd: actual.routerCostUsd,
    routerLatencyMs: actual.routerLatencyMs
  });
}

const runId = `router-check-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = resolve(process.cwd(), 'artifacts/routing-evals', runId);
const accuracy = rows.filter((row) => row.matched).length / rows.length;
const artifact = {
  schemaVersion: 1,
  runId,
  createdAt: new Date().toISOString(),
  benchmarkVersion: ROUTING_BENCHMARK_VERSION,
  policyVersion: 'chat-router-v1',
  accuracy,
  totalCostUsd: rows.reduce((sum, row) => sum + row.routerCostUsd, 0),
  totalLatencyMs: rows.reduce((sum, row) => sum + row.routerLatencyMs, 0),
  rows
};
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'router-check.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

process.stdout.write('\nCase                     Expected          Actual            Match\n');
for (const row of rows) {
  process.stdout.write(`${row.caseId.padEnd(24)} ${row.expectedModel.padEnd(17)} ${row.actualModel.padEnd(17)} ${row.matched ? 'yes' : 'NO'}\n`);
}
process.stdout.write(`\nRoute accuracy: ${(accuracy * 100).toFixed(1)}%\n`);
process.stdout.write(`Router cost: $${artifact.totalCostUsd.toFixed(6)}\n`);
process.stdout.write(`Artifact: ${resolve(outputDir, 'router-check.json')}\n`);
