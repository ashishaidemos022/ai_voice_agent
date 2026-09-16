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

test('fixed trained checkpoint receives chat context and emits a checkpoint receipt', async () => {
  const bundled = await build({ entryPoints: ['src/lib/chat-realtime-client.ts'], bundle: true, write: false, format: 'esm', platform: 'node',
    define: { 'import.meta.env.VITE_SUPABASE_URL': '"https://test.invalid"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"test"' },
    plugins: [{ name: 'isolate-network', setup(builder) {
      builder.onResolve({ filter: /^\.\/(supabase|tools-registry)$/ }, args => ({ path: args.path, namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path.endsWith('supabase')
        ? 'export const supabase = {auth:{getSession:async()=>({data:{session:{access_token:"test-token"}}})}}'
        : 'export const getToolSchemas = () => [];' }));
    } }]
  });
  const { ChatRealtimeClient } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  const requests: Array<{ url: string; body: any; authorization: string | null }> = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(options?.body)),
      authorization: new Headers(options?.headers).get('authorization')
    });
    return Response.json({
      model: 'thinkingmachines/Inkling-Small',
      choices: [{ message: { content: 'Wren opens at 11:30 a.m.' } }],
      usage: { prompt_tokens: 100, completion_tokens: 25 },
      viaana: { latency_ms: 123 }
    });
  };
  const client = new ChatRealtimeClient({
    agentId: 'agent', sessionId: 'session', model: 'unused', instructions: 'Answer for Wren Restaurants.',
    routingStrategy: 'fixed', fixedModel: 'trained-checkpoint:train-tinker-wren',
    fixedCheckpoint: { id: 'train-tinker-wren', name: 'Wren FAQ', datasetName: 'wren-faq', backend: 'tinker' }
  });
  try {
    await client.connect();
    client.sendSystemMessage('Knowledge retrieved for this turn: Wren opens at 11:30 a.m.');
    const completed = new Promise<any>(resolve => client.on('response.completed', resolve));
    client.sendUserMessage('When does Wren open?', {
      startedAt: performance.now() - 400,
      rag: { costUsd: 0.002, modelCostUsd: 0.0015, toolCostUsd: 0.0005, latencyMs: 350 }
    });
    const event = await completed;
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /jobId=train-tinker-wren&action=completion/);
    assert.equal(requests[0].authorization, 'Bearer test-token');
    assert.match(requests[0].body.messages[0].content, /Answer for Wren Restaurants/);
    assert.match(requests[0].body.messages[0].content, /Knowledge retrieved/);
    assert.equal(event.text, 'Wren opens at 11:30 a.m.');
    assert.equal(event.route.routeKind, 'trained_checkpoint');
    assert.equal(event.route.checkpointName, 'Wren FAQ');
    assert.equal(event.route.checkpointBackend, 'tinker');
    assert.equal(event.route.answerCostUsd, 0.000094);
    assert.equal(event.route.costKind, 'estimated');
    assert.equal(event.route.ragLatencyMs, 350);
    assert.equal(event.route.ragCostUsd, 0.002);
    assert.ok(event.route.turnLatencyMs >= 400, `turn latency ${event.route.turnLatencyMs} includes retrieval time`);
    assert.ok(event.route.turnLatencyMs >= event.route.ragLatencyMs + event.route.answerLatencyMs);
  } finally { client.disconnect(); globalThis.fetch = previousFetch; }
});

test('hosted routes report retrieval time and end-to-end turn time in the receipt', async () => {
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
    return Response.json({
      output_text: 'Wren opens at 11:30 a.m.',
      output: [],
      _routing: { turnId: 't', strategy: 'fixed', model: 'gpt-5.6-sol', reasoningEffort: 'low', reasonCode: 'fixed_model_selected', reason: '', policyVersion: 'chat-router-v1', taskType: 'grounded_answer', complexity: 0, confidence: 1, requiresTools: false, consequential: false, answerLatencyMs: 120 }
    });
  };
  const client = new ChatRealtimeClient({ agentId: 'agent', sessionId: 'session', model: 'test', instructions: '', routingStrategy: 'fixed', fixedModel: 'gpt-5.6-sol' });
  try {
    await client.connect();
    const completed = new Promise<any>(resolve => client.on('response.completed', resolve));
    client.sendUserMessage('When does Wren open?', {
      startedAt: performance.now() - 900,
      rag: { costUsd: 0.003, modelCostUsd: 0.002, toolCostUsd: 0.001, latencyMs: 800 }
    });
    const event = await completed;
    assert.equal(requests[0].route_decision, undefined);
    assert.equal(event.route.answerLatencyMs, 120);
    assert.equal(event.route.ragLatencyMs, 800);
    assert.equal(event.route.ragCostUsd, 0.003);
    assert.ok(event.route.turnLatencyMs >= 900, `turn latency ${event.route.turnLatencyMs} includes retrieval time`);
  } finally { client.disconnect(); globalThis.fetch = previousFetch; }
});
