import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('document context survives memory tool continuations and clears for the next question', async () => {
  const bundled = await build({ entryPoints: ['src/lib/chat-realtime-client.ts'], bundle: true, write: false, format: 'esm', platform: 'node',
    define: { 'import.meta.env.VITE_SUPABASE_URL': '"https://test.invalid"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"test"' },
    plugins: [{ name: 'isolate-network', setup(builder) {
      builder.onResolve({ filter: /^\.\/(supabase|tools-registry)$/ }, args => ({ path: args.path, namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path.endsWith('supabase')
        ? 'export const supabase = {auth:{getSession:async()=>({data:{session:{access_token:"test"}}})}}'
        : 'export const getToolSchemas = () => [];' }));
    } }]
  });
  const { ChatRealtimeClient } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  const requests: any[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(String(options?.body)));
    return new Response(JSON.stringify(requests.length === 1
      ? { output: [{ type: 'function_call', name: 'search_memory', call_id: 'call-1', arguments: '{}' }], _memory_tool_outputs: [{ call_id: 'call-1', output: [] }] }
      : { output_text: 'Answer', output: [] }), { status: 200 });
  };
  const client = new ChatRealtimeClient({ agentId: 'agent', sessionId: 'session', model: 'test', instructions: '', routingStrategy: 'auto', fixedModel: 'test' });
  try {
    await client.connect();
    const completed = () => new Promise<void>(resolve => { const handler = () => { client.off('response.completed', handler); resolve(); }; client.on('response.completed', handler); });
    client.sendSystemMessage('Verified passage [K1]');
    const first = completed(); client.sendUserMessage('Compare these shoes'); await first;
    assert.equal(requests.length, 2);
    assert.equal(requests[0].instructions_suffix, 'Verified passage [K1]');
    assert.equal(requests[1].instructions_suffix, 'Verified passage [K1]');
    const next = completed(); client.sendUserMessage('Thanks'); await next;
    assert.equal(requests[2].instructions_suffix, undefined);
  } finally { client.disconnect(); globalThis.fetch = previousFetch; }
});
