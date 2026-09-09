import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CASES, grade } from './benchmark.ts';
import { complete, listModels, validateConfig } from './provider.ts';
import { renderOpenWeightReport } from './report.ts';

const args = process.argv.slice(2);
let configFile = 'scripts/open-weight-eval/models.example.json';
let mode: 'plan' | 'probe' | 'live' = 'plan';
let explicitMode = false;
let limit = CASES.length;
let delayMs = 0;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--config' || arg === '--limit' || arg === '--delay-ms') {
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    if (arg === '--config') configFile = value;
    else if (arg === '--delay-ms') {
      delayMs = Number(value);
      if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) throw new Error('Delay must be 0–60000 milliseconds');
    } else {
      limit = Number(value);
      if (!Number.isInteger(limit) || limit < 1 || limit > CASES.length) throw new Error(`Limit must be 1–${CASES.length}`);
    }
  } else if (arg === '--live' || arg === '--probe') {
    if (explicitMode) throw new Error('Choose only one mode');
    explicitMode = true;
    mode = arg === '--live' ? 'live' : 'probe';
  } else throw new Error(`Unknown option: ${arg}`);
}
const models = validateConfig(JSON.parse(await readFile(resolve(configFile), 'utf8')));
const cases = CASES.slice(0, limit);
if (mode === 'probe') {
  for (const model of models) {
    const available = await listModels(model);
    const found = available.includes(model.model);
    console.log(`${model.id}: ${found ? 'requested model advertised' : 'requested model NOT advertised'}`);
    if (!found) process.exitCode = 1;
  }
} else {
  const runId = `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const directory = resolve('artifacts/open-weight-evals', runId);
  await mkdir(directory, { recursive: true });
  const results: Array<Record<string, unknown>> = [];
  const manifest = {
    schemaVersion: 1, runId, createdAt: new Date().toISOString(), mode,
    benchmark: 'open-weight-development-smoke-v1', split: 'development',
    benchmarkSha256: createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
    provenance: 'Model revision and precision are operator declarations, not server-verified weight identity.',
    models, cases, results,
    limitations: ['Development cases only; not a capability benchmark or held-out test.', 'Non-streaming; latency includes retry delay and is request completion time, not first-token latency.', 'Tool selection only; no tools executed.', 'No judge, model fallback, RAG, or training; transient HTTP retries are recorded per result.', 'Missing usage or configured pricing remains null.'],
  };
  async function save() {
    const target = resolve(directory, 'results.json');
    await writeFile(`${target}.tmp`, JSON.stringify(manifest, null, 2) + '\n');
    await rename(`${target}.tmp`, target);
  }
  await save();
  if (mode === 'live') {
    for (const model of models) {
      for (const item of cases) {
        if (results.length && delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        try {
          const completion = await complete(model, item.messages, item.tools);
          const assessment = grade(item, completion);
          results.push({ modelId: model.id, caseId: item.id, category: item.category, status: 'ok', ...completion, ...assessment });
          console.log(`${model.id} / ${item.id}: ${assessment.pass ? 'PASS' : 'FAIL'}`);
        } catch (error) {
          results.push({ modelId: model.id, caseId: item.id, category: item.category, status: 'error', pass: false, error: error instanceof Error ? error.message : 'Unknown error', costUsd: null });
          console.log(`${model.id} / ${item.id}: ERROR`);
        }
        await save();
      }
    }
    if (results.some(result => result.pass !== true)) process.exitCode = 1;
  }
  await writeFile(resolve(directory, 'report.md'), renderOpenWeightReport(manifest));
  console.log(`${mode === 'plan' ? 'Prepared plan' : 'Saved results'}: ${directory}`);
}
