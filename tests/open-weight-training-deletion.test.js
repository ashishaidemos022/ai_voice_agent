import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/open-weight-training.js';

test('registry uses the owning runtime before and after deleting a Tinker job', async (t) => {
  const env = {
    VITE_SUPABASE_URL: 'https://auth.example.test', VITE_SUPABASE_ANON_KEY: 'test-key',
    HUGGING_FACE_TOKEN: 'hf-test', OPEN_WEIGHT_RUNTIME_KEY: 'runtime-test',
    TINKER_RUNTIME_ENDPOINT: 'https://runtime.hf.space/tinker',
    OPEN_WEIGHT_MODELS_JSON: JSON.stringify([{
      id: 'base', model: 'test/base', revision: 'test', precision: 'fp16',
      transport: 'openai-compatible', endpoint: 'https://runtime.hf.space', runtimeModel: 'base',
    }]),
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const local = { id: 'train-local-one', name: 'Local adapter', status: 'completed', created_at: 1 };
  const stale = { id: 'train-tinker-one', name: 'Stale Tinker copy', status: 'completed', created_at: 2 };
  const owner = { ...stale, name: 'Authoritative Tinker adapter', backend: 'tinker' };
  let deleted = false;
  let tinkerUnavailable = false;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (String(url).startsWith(env.VITE_SUPABASE_URL)) return Response.json({ id: 'test-user' });
    if (options.method === 'DELETE') {
      assert.equal(url, `https://runtime.hf.space/tinker/v1/training/jobs/${owner.id}`);
      deleted = true;
      return Response.json({ deleted: true, job_id: owner.id });
    }
    if (url === 'https://runtime.hf.space/v1/training/jobs') return Response.json({ jobs: [local, stale] });
    assert.equal(url, 'https://runtime.hf.space/tinker/v1/training/jobs');
    if (tinkerUnavailable) return Response.json({ detail: 'Unavailable' }, { status: 401 });
    return Response.json({ jobs: deleted ? [] : [owner, local] });
  });
  const request = async (method = 'GET', query = {}) => {
    const res = { status(code) { this.statusCode = code; return this; }, setHeader() { return this; }, end(body) { this.body = JSON.parse(body); } };
    await handler({ method, query, headers: { authorization: 'Bearer test-token' } }, res);
    assert.equal(res.statusCode, 200);
    return res.body;
  };
  assert.deepEqual((await request()).jobs, [owner, local]);
  assert.equal((await request('DELETE', { jobId: owner.id })).deleted, true);
  assert.deepEqual((await request()).jobs, [local], 'the stale copy must not resurrect a deleted job');
  tinkerUnavailable = true;
  assert.deepEqual((await request()).jobs, [local], 'an unavailable owner must not fall back to a stale copy');
});
