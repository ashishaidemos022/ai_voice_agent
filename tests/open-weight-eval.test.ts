import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { complete, listModels, requestBody, validateConfig, type Completion, type ModelConfig } from '../scripts/open-weight-eval/provider.ts';
import { CASES, grade } from '../scripts/open-weight-eval/benchmark.ts';
import { renderOpenWeightReport } from '../scripts/open-weight-eval/report.ts';

const config: ModelConfig = { id: 'test', model: 'test-model', baseUrl: 'http://localhost:8000/v1', revision: 'abc', precision: 'bf16' };
const result: Completion = { text: '', toolCalls: [], finishReason: 'stop', usage: null, latencyMs: 1, responseModel: 'test-model', costUsd: null, attempts: 1 };

test('registry rejects ambiguous or credential-bearing config', () => {
  assert.throws(() => validateConfig([config, config]), /Duplicate/);
  assert.throws(() => validateConfig([{ ...config, baseUrl: 'https://user:secret@example.org/v1' }]), /credentials/);
  assert.throws(() => validateConfig([{ ...config, apiKey: 'secret' }]), /Unknown/);
  assert.throws(() => validateConfig([{ ...config, maxTokens: -1 }]), /maxTokens/);
  assert.throws(() => validateConfig([{ ...config, apiKeyEnv: [] }]), /apiKeyEnv/);
  assert.throws(() => validateConfig([{ ...config, providerOnly: [] }]), /providerOnly/);
  assert.throws(() => validateConfig([{ ...config, reasoningEffort: 'maximum' }]), /reasoningEffort/);
  assert.throws(() => validateConfig([{ ...config, maxRetries: 6 }]), /maxRetries/);
  assert.deepEqual(validateConfig([config]), [config]);
});

test('requests preserve inputs, model identity, tool schema and mode controls', () => {
  const item = CASES.find(item => item.expected.kind === 'tool')!;
  const body = requestBody({ ...config, chatTemplateKwargs: { enable_thinking: false } }, item.messages, item.tools);
  assert.equal(body.model, config.model);
  assert.deepEqual(body.messages, item.messages);
  assert.equal(body.tools?.[0].function.name, 'lookup_product');
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(body.stream, false);
});

test('requests can pin Gateway providers without configuring fallbacks', () => {
  const body = requestBody({ ...config, providerOnly: ['deepinfra'] }, [{ role: 'user', content: 'hello' }]);
  assert.deepEqual(body.providerOptions, { gateway: { only: ['deepinfra'] } });
  assert.equal('models' in body.providerOptions.gateway, false);
});

test('requests can explicitly disable model reasoning', () => {
  const body = requestBody({ ...config, reasoningEffort: 'none' }, [{ role: 'user', content: 'hello' }]);
  assert.deepEqual(body.reasoning, { effort: 'none', enabled: false });
});

test('30 development checks fail empty, truncated, extra-field, and wrong-tool outputs', () => {
  assert.equal(CASES.length, 30);
  assert.equal(new Set(CASES.map(item => item.id)).size, 30);
  for (const item of CASES) {
    assert.equal(grade(item, result).pass, false, item.id);
    const expected = item.expected;
    const correct = expected.kind === 'tool'
      ? { ...result, toolCalls: [{ id: '1', name: expected.name, arguments: expected.args }], finishReason: 'tool_calls' }
      : { ...result, text: expected.kind === 'json' ? JSON.stringify(expected.value) : expected.value };
    assert.equal(grade(item, correct).pass, true, item.id);
    assert.equal(grade(item, { ...correct, finishReason: 'length' }).pass, false, item.id);
  }
  assert.equal(grade(CASES[0], { ...result, text: '{"size":39,"budget":120,"extra":true}' }).pass, false);
  const tool = CASES.find(item => item.expected.kind === 'tool')!;
  assert.equal(grade(tool, { ...result, toolCalls: [{ id: '1', name: 'invented', arguments: { sku: 'VN-1' } }] }).pass, false);
});

test('HTTP adapter handles discovery, tools, missing usage, errors and malformed arguments', async () => {
  let behavior = 'valid';
  let received: unknown;
  const server = createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'test-model' }] })); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString());
    if (behavior === 'error') { res.writeHead(401); res.end('secret-upstream-body'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: 'test-model', usage: { prompt_tokens: 10, completion_tokens: 4 }, choices: [{ finish_reason: 'tool_calls', message: {
      content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup_product', arguments: behavior === 'malformed' ? '{' : '{"sku":"VN-1"}' } }],
    } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const local = { ...config, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` };
  try {
    assert.deepEqual(await listModels(local), ['test-model']);
    const output = await complete({ ...local, inputCostPerToken: 0.01, outputCostPerToken: 0.02 }, [{ role: 'user', content: 'lookup' }]);
    assert.equal((received as { model: string }).model, 'test-model');
    assert.deepEqual(output.toolCalls[0].arguments, { sku: 'VN-1' });
    assert.deepEqual(output.usage, { inputTokens: 10, outputTokens: 4 });
    assert.equal(output.costUsd, 0.18);
    assert.equal(output.attempts, 1);
    behavior = 'error';
    await assert.rejects(complete(local, []), /^Error: Completion returned HTTP 401$/);
    behavior = 'malformed';
    await assert.rejects(complete(local, []), SyntaxError);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('requests are bounded by timeout', async () => {
  const server = createServer(() => { /* Deliberately never respond. */ });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(complete({ ...config, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, timeoutMs: 25 }, []), { name: 'TimeoutError' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('report shows strict category scores, latency and token totals', () => {
  const report = renderOpenWeightReport({
    mode: 'live', models: [config], limitations: ['Development only.'], results: [
      { modelId: 'test', category: 'reasoning', status: 'ok', pass: true, latencyMs: 100, usage: { inputTokens: 10, outputTokens: 4 }, costUsd: 0.02 },
      { modelId: 'test', category: 'reasoning', status: 'ok', pass: false, latencyMs: 300, usage: { inputTokens: 12, outputTokens: 6 }, costUsd: 0.03 }
    ]
  });
  assert.match(report, /1\/2 \| 50\.0% \| 200/);
  assert.match(report, /Tokens reported: 22 input \/ 10 output/);
  assert.match(report, /\$0\.050000/);
});
