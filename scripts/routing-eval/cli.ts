import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { OPENAI_PRICING_EFFECTIVE_DATE } from '../../shared/openai-models.ts';
import { assertWorkflowSplitIntegrity, ROUTING_BENCHMARK_VERSION, ROUTING_EVAL_CASES } from './benchmark.ts';
import { calculateEvalSummary } from './metrics.ts';
import { runLiveMatrix } from './openai-runner.ts';
import { renderMarkdownReport } from './report.ts';
import { createFixtureAutoSelections, createSyntheticResults } from './sample-data.ts';
import type { EvalArtifact } from './types.ts';

const args = new Set(process.argv.slice(2));
const live = args.has('--live');
const includeCalibration = args.has('--include-calibration');
const useJudge = !args.has('--no-judge');

if (live && !args.has('--confirm-spend')) {
  throw new Error('Live mode calls 5 models per case plus the router and judge. Re-run with --confirm-spend to acknowledge API cost.');
}

assertWorkflowSplitIntegrity(ROUTING_EVAL_CASES);
const cases = includeCalibration ? ROUTING_EVAL_CASES : ROUTING_EVAL_CASES.filter((item) => item.split === 'test');
const runId = `routing-${live ? 'live' : 'sample'}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDir = resolve(process.cwd(), 'artifacts/routing-evals', runId);
await mkdir(outputDir, { recursive: true });

async function writeCheckpoint(state: unknown): Promise<void> {
  const target = resolve(outputDir, 'checkpoint.json');
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify({
    schemaVersion: 1,
    runId,
    updatedAt: new Date().toISOString(),
    benchmarkVersion: ROUTING_BENCHMARK_VERSION,
    cases,
    ...state as Record<string, unknown>
  }, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
}

const matrix = live
  ? await runLiveMatrix(cases, (message) => process.stdout.write(`${message}\n`), useJudge, writeCheckpoint)
  : { results: createSyntheticResults(cases), autoSelections: createFixtureAutoSelections(cases) };
const summary = calculateEvalSummary(cases, matrix.results, matrix.autoSelections);
const artifact: EvalArtifact = {
  schemaVersion: 1, runId, createdAt: new Date().toISOString(), source: live ? 'live' : 'synthetic',
  benchmarkVersion: ROUTING_BENCHMARK_VERSION, policyVersion: 'chat-router-v1',
  pricingEffectiveDate: OPENAI_PRICING_EFFECTIVE_DATE, command: process.argv.join(' '),
  cases, results: matrix.results, autoSelections: matrix.autoSelections, summary
};

await Promise.all([
  writeFile(resolve(outputDir, 'results.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8'),
  writeFile(resolve(outputDir, 'report.md'), renderMarkdownReport(artifact), 'utf8')
]);

process.stdout.write(`\nRouting evaluation complete\n`);
process.stdout.write(`Auto quality: ${(summary.auto.quality * 100).toFixed(1)}%\n`);
process.stdout.write(`Fixed Sol quality: ${(summary.fixedFrontier.quality * 100).toFixed(1)}%\n`);
process.stdout.write(`Matched-quality CostSave: ${summary.costSaveVsFrontierPct === null ? 'N/A' : `${summary.costSaveVsFrontierPct.toFixed(1)}%`}\n`);
process.stdout.write(`Report: ${resolve(outputDir, 'report.md')}\n`);
