import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const built = await build({
  entryPoints: ['src/components/open-weight/OpenWeightLab.tsx'], bundle: true, write: false,
  format: 'esm', platform: 'node', jsx: 'automatic',
  plugins: [{ name: 'lab-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(react(?:\/.*)?|lucide-react)$/ }, (args) => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
    builder.onResolve({ filter: /\/(AuthContext|MainLayout|Sidebar|EvaluationRunner|AdapterEvaluation)$/ }, (args) => ({ path: args.path.split('/').at(-1), namespace: 'stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: path === 'AuthContext'
      ? 'export const useAuth = () => ({session: {access_token: "test"}, signOut() {}});'
      : `export const ${path} = (props) => ${path === 'MainLayout' ? 'props.children' : 'null'};` }));
  } }],
});
const { OpenWeightLab } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const job = {
  id: 'train-tinker-example', backend: 'tinker', name: 'Example adapter', dataset_name: 'test-data',
  status: 'completed', promotion_status: 'promoted', promoted_checkpoint_path: 'tinker://checkpoint',
  rank: 8, max_steps: 20, example_count: 12,
};
const base = { id: 'base', model: 'test/base', transport: 'openai-compatible', runtimeModel: 'base' };
const text = (node) => typeof node === 'string' ? node : (node.children || []).map(text).join('');

async function mountLab(t, fetchImpl) {
  for (const [key, value] of Object.entries({ localStorage: { getItem: () => null, setItem() {} }, window: { confirm: () => true } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  t.mock.method(globalThis, 'fetch', fetchImpl);
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(OpenWeightLab, {})); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const click = async (label) => {
    const button = renderer.root.findAllByType('button').find((node) => text(node) === label || node.props['aria-label'] === label);
    assert.ok(button, `Missing ${label} button`);
    await act(async () => { await button.props.onClick(); });
  };
  return { renderer, click };
}

test('deletion removes adapter and promotion selections even when an older registry request finishes late', async (t) => {
  let reads = 0;
  let resolveStale;
  const { renderer, click } = await mountLab(t, async (url, options = {}) => {
    if (options.method === 'DELETE') return Response.json({ deleted: true, job_id: job.id });
    if (url === '/api/open-weight-chat') return Response.json({ models: [base] });
    assert.equal(url, '/api/open-weight-training');
    reads++;
    // Child's initial load is read #2; hold the parent's refresh (#3).
    if (reads === 3) return new Promise((resolve) => { resolveStale = resolve; });
    return Response.json({ jobs: [job] });
  });
  const promoted = renderer.root.findAllByType('label').find((node) => node.props.title === `${job.name} · promoted`);
  await act(async () => promoted.findByType('input').props.onChange());
  assert.ok(renderer.root.findAllByType('button').some((node) => text(node).trim() === 'Run 3 models'));
  await click('Train');
  assert.equal(typeof resolveStale, 'function');
  const row = renderer.root.findAllByType('button').find((node) => text(node).includes(job.name) && !node.props['aria-label']);
  await act(async () => row.props.onClick());
  await click(`Delete ${job.name}`);
  assert.equal(renderer.root.findAllByProps({ 'aria-label': `Delete ${job.name}` }).length, 0);
  assert.ok(!JSON.stringify(renderer.toJSON()).includes('Current job'));
  await act(async () => resolveStale(Response.json({ jobs: [job] })));
  await click('Prompt');
  assert.equal(renderer.root.findAllByType('label').filter((node) => node.props.title?.startsWith(job.name)).length, 0);
  assert.ok(renderer.root.findAllByType('button').some((node) => text(node).trim() === 'Run 1 model'));
  await click('Models');
  assert.ok(!JSON.stringify(renderer.toJSON()).includes(job.name));
});

test('a failed deletion keeps the registry entry and reports the error', async (t) => {
  const { renderer, click } = await mountLab(t, async (url, options = {}) => {
    if (options.method === 'DELETE') return Response.json({ error: 'Storage unavailable' }, { status: 502 });
    return Response.json(url === '/api/open-weight-chat' ? { models: [base] } : { jobs: [job] });
  });
  await click('Train');
  await click(`Delete ${job.name}`);
  assert.equal(renderer.root.findAllByProps({ 'aria-label': `Delete ${job.name}` }).length, 1);
  assert.ok(JSON.stringify(renderer.toJSON()).includes('Storage unavailable'));
});
