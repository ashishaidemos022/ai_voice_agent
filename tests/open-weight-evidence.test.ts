import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const evidence = JSON.parse(readFileSync(new URL('../src/data/openWeightEvidence.json', import.meta.url), 'utf8'));

test('published baseline evidence contains complete frozen runs', () => {
  const { hosted, local } = evidence.baselineRuns;
  assert.equal(hosted.cases.length, 30);
  assert.equal(hosted.results.length, 30);
  assert.equal(local.results.length, 30);
  assert.equal(hosted.results.filter((result: { pass: boolean }) => result.pass).length, 25);
  assert.equal(local.results.filter((result: { pass: boolean }) => result.pass).length, 20);
  assert.deepEqual(hosted.cases.map((item: { id: string }) => item.id), local.cases.map((item: { id: string }) => item.id));
});

test('published weight proof verifies adapter and fused behavior', () => {
  const { base, lora, fused } = evidence.weightExperiment.variants;
  assert.equal(base.passed, 0);
  assert.equal(lora.passed, 6);
  assert.equal(fused.passed, 6);
  assert.notEqual(base.modelWeightSha256, fused.modelWeightSha256);
  assert.match(lora.adapterSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    lora.results.map((result: { answer: string }) => result.answer),
    fused.results.map((result: { answer: string }) => result.answer)
  );
});
