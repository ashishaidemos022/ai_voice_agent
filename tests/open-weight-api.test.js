import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllowedModels, parseBearer, validateLabRequest } from '../api/open-weight-chat.js';

test('API requires a strict bearer token shape', () => {
  assert.equal(parseBearer('Bearer header.payload.signature'), 'header.payload.signature');
  assert.equal(parseBearer('Basic abc'), null);
  assert.equal(parseBearer('Bearer token with spaces'), null);
});

test('API model registry is an allowlist', () => {
  const models = getAllowedModels('[{"id":"base","model":"alibaba/qwen-3-14b","revision":"provider-undisclosed","precision":"provider-undisclosed","providerOnly":["deepinfra"]}]');
  assert.equal(models[0].id, 'base');
  assert.deepEqual(models[0].providerOnly, ['deepinfra']);
  assert.throws(() => getAllowedModels('[]'), /nonempty/);
  assert.throws(() => getAllowedModels('[{"id":"x"}]'), /Missing/);
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
