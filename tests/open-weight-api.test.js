import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRuntimeWarmup, getAllowedModels, getGatewayToken, getUpstreamRequest, parseBearer, validateLabRequest } from '../api/open-weight-chat.js';

test('API requires a strict bearer token shape', () => {
  assert.equal(parseBearer('Bearer header.payload.signature'), 'header.payload.signature');
  assert.equal(parseBearer('Basic abc'), null);
  assert.equal(parseBearer('Bearer token with spaces'), null);
});

test('API reads durable Gateway authentication from the Vercel runtime request', () => {
  assert.equal(getGatewayToken({ headers: { 'x-vercel-oidc-token': 'runtime-token' } }, {}), 'runtime-token');
  assert.equal(getGatewayToken({ headers: { 'x-vercel-oidc-token': 'runtime-token' } }, { AI_GATEWAY_API_KEY: 'api-key' }), 'api-key');
  assert.equal(getGatewayToken({ headers: {} }, {}), null);
});

test('API model registry is an allowlist', () => {
  const models = getAllowedModels('[{"id":"base","model":"alibaba/qwen-3-14b","revision":"provider-undisclosed","precision":"provider-undisclosed","providerOnly":["deepinfra"]}]');
  assert.equal(models[0].id, 'base');
  assert.deepEqual(models[0].providerOnly, ['deepinfra']);
  assert.throws(() => getAllowedModels('[]'), /nonempty/);
  assert.throws(() => getAllowedModels('[{"id":"x"}]'), /Missing/);
});

test('API registry accepts approved private Hugging Face runtimes and rejects arbitrary hosts', () => {
  const raw = JSON.stringify([{
    id: 'fused', model: 'bhatsy/fused', revision: 'abc123', precision: 'bf16',
    transport: 'openai-compatible', endpoint: 'https://bhatsy-runtime.hf.space', runtimeModel: 'fused'
  }]);
  const [model] = getAllowedModels(raw);
  assert.equal(model.endpoint, 'https://bhatsy-runtime.hf.space');
  assert.equal(model.supportsTools, false);
  assert.throws(() => getAllowedModels(raw.replace('bhatsy-runtime.hf.space', 'example.com')), /approved Hugging Face host/);
});

test('API sends runtime credentials only to an allowlisted model endpoint', () => {
  const [model] = getAllowedModels(JSON.stringify([{
    id: 'base', model: 'bhatsy/base', revision: 'abc123', precision: 'bf16',
    transport: 'openai-compatible', endpoint: 'https://bhatsy-runtime.hf.space', runtimeModel: 'base'
  }]));
  const request = validateLabRequest({ modelId: 'base', messages: [{ role: 'user', content: 'Hello' }] }, [model]);
  const upstream = getUpstreamRequest(request, { headers: {} }, { HUGGING_FACE_TOKEN: 'hf-secret', OPEN_WEIGHT_RUNTIME_KEY: 'runtime-secret' });
  assert.equal(upstream.url, 'https://bhatsy-runtime.hf.space/v1/chat/completions');
  assert.equal(upstream.headers.Authorization, 'Bearer hf-secret');
  assert.equal(upstream.headers['x-runtime-key'], 'runtime-secret');
  assert.equal(upstream.body.model, 'base');
});

test('API retries a warming private runtime and preserves the request', async () => {
  const statuses = [503, 503, 200];
  const bodies = [];
  const response = await fetchWithRuntimeWarmup({
    transport: 'openai-compatible', url: 'https://runtime.hf.space/v1/chat/completions',
    headers: { Authorization: 'Bearer secret' }, body: { model: 'fused' }
  }, async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return new Response('{}', { status: statuses.shift() });
  }, async () => undefined);
  assert.equal(response.status, 200);
  assert.equal(bodies.length, 3);
  assert.deepEqual(bodies[2], { model: 'fused' });
});

test('API accepts bounded prompts and rejects arbitrary model access', () => {
  const models = getAllowedModels();
  const result = validateLabRequest({
    modelId: models[0].id,
    messages: [{ role: 'user', content: 'Hello' }],
    maxTokens: 100,
    temperature: 0
  }, models);
  assert.equal(result.model.id, models[0].id);
  assert.throws(() => validateLabRequest({ modelId: 'arbitrary', messages: [{ role: 'user', content: 'Hello' }] }, models), /Unknown modelId/);
  assert.throws(() => validateLabRequest({ modelId: models[0].id, messages: [{ role: 'user', content: 'x'.repeat(20001) }] }, models), /content/);
  assert.throws(() => validateLabRequest({ modelId: models[0].id, messages: [{ role: 'user', content: 'Hello' }], extra: true }, models), /Unknown request field/);
});
