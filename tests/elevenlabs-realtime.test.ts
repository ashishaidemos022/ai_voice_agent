import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { effectiveElevenLabsRealtimeModel, resolveElevenLabsRealtimeModel, validateElevenLabsRealtimeTokens } from '../shared/elevenlabs-realtime-models.ts';

test('Realtime model identifiers and Max token constraints', () => {
  for (const value of [undefined, null, '']) assert.equal(resolveElevenLabsRealtimeModel(value), null);
  assert.throws(() => resolveElevenLabsRealtimeModel('eleven_flash_v2_5'), /Unsupported/);
  for (const value of [0, 512, 1023, NaN, 1024.5]) {
    assert.throws(() => validateElevenLabsRealtimeTokens('eleven_realtime_v1_max', value), /1,024/);
  }
  for (const value of [-1, 1024, 4096]) validateElevenLabsRealtimeTokens('eleven_realtime_v1_max', value);
  validateElevenLabsRealtimeTokens('eleven_realtime_v1_mini', 512);
  assert.equal(effectiveElevenLabsRealtimeModel({ realtime_model: 'eleven_realtime_v1_max', app_managed: { effective_realtime_model: null } }), null);
  assert.equal(effectiveElevenLabsRealtimeModel({ realtime_model: null, app_managed: { effective_realtime_model: 'eleven_realtime_v1_mini' } }), 'eleven_realtime_v1_mini');
});

test('agent publishing uses Realtime on create/update and verifies provider acceptance', async (t) => {
  t.mock.method(console, 'error', () => {});
  const runtime = globalThis as any;
  const original = { Deno: runtime.Deno, fetch: runtime.fetch, fixture: runtime.elevenFixture };
  let handler: (request: Request) => Promise<Response>;
  let config: any;
  let remote: any;
  let saved: any;
  let rejection = '';
  let ignoreRealtime = false;
  const writes: any[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'auth' } } }) },
    from(table: string) {
      let update: any;
      const result = () => ({ data:
        table === 'va_users' ? { id: 'owner' } :
        table === 'va_provider_keys' ? { provider: 'elevenlabs', user_id: 'owner', encrypted_key: btoa('test-key') } :
        table === 'va_agent_config_tools' ? [{ tool_name: 'check_order', metadata: { parameters: { type: 'object', properties: {} } } }] :
        update ? (saved = update, null) : config,
        error: null });
      const query: any = {
        select: () => query, eq: () => query,
        update: (value: any) => { update = value; return query; },
        single: async () => result(),
        then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject)
      };
      return query;
    }
  };
  runtime.elevenFixture = { client };
  runtime.Deno = { env: { get: (name: string) => name.endsWith('URL') ? 'https://provider.test' : 'test' }, serve: (fn: typeof handler) => { handler = fn; } };
  runtime.fetch = async (url: URL, init: RequestInit = {}) => {
    if (init.method === 'POST' || init.method === 'PATCH') {
      const body = JSON.parse(init.body as string);
      writes.push({ path: url.pathname, method: init.method, body });
      if (url.pathname === '/v1/convai/tools') return Response.json({ id: 'tool-order' });
      if (rejection) return Response.json({ detail: { message: rejection } }, { status: 400 });
      remote = { agent_id: 'remote', version_id: 'v1', conversation_config: body.conversation_config };
      if (ignoreRealtime) delete remote.conversation_config.realtime_model;
      return Response.json(remote);
    }
    return Response.json(remote);
  };
  const reset = (model: any, existing = false, tokens = 4096) => {
    writes.length = 0; saved = null; rejection = ''; ignoreRealtime = false;
    config = {
      id: 'preset', user_id: 'owner', name: 'Support', instructions: 'Help customers',
      temperature: 0.7, max_response_output_tokens: tokens, voice_provider: 'elevenlabs_agent',
      voice_provider_key_id: 'key', voice_id: 'voice-customer',
      voice_provider_config: {
        configuration_authority: 'app_managed', realtime_model: model,
        agent_id: existing ? 'remote' : undefined, llm: 'gpt-5.4-mini', model_id: 'eleven_v3',
        first_message: 'Welcome', turn_eagerness: 'high'
      }
    };
    remote = { conversation_config: {
      realtime_model: 'eleven_realtime_v1_mini',
      agent: { prompt: { knowledge_base: [{ id: 'kb' }], tools: [{ legacy: true }] } },
      tts: { voice_id: 'old' }
    } };
  };
  const publish = async () => {
    const response = await handler(new Request('https://function.test', {
      method: 'POST', headers: { Authorization: 'Bearer test' },
      body: JSON.stringify({ action: 'sync_agent', config_id: 'preset' })
    }));
    return { status: response.status, body: await response.json() };
  };
  try {
    const built = await build({
      entryPoints: ['supabase/functions/elevenlabs-agent-session/index.ts'], bundle: true,
      write: false, platform: 'node', format: 'esm', plugins: [{ name: 'supabase-fixture', setup(builder) {
        builder.onResolve({ filter: /^npm:/ }, () => ({ path: 'supabase', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const createClient = () => globalThis.elevenFixture.client;' }));
      } }]
    });
    await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
    for (const model of ['eleven_realtime_v1_mini', 'eleven_realtime_v1_max']) {
      for (const existing of [false, true]) await t.test(`${model}: ${existing ? 'update' : 'create'}`, async () => {
        reset(model, existing);
        const result = await publish();
        assert.equal(result.status, 200);
        const request = writes.find((item) => item.path.includes('/agents'));
        assert.equal(request.method, existing ? 'PATCH' : 'POST');
        const conversation = request.body.conversation_config;
        assert.equal(conversation.realtime_model, model);
        assert.equal(conversation.agent.prompt.prompt, 'Help customers');
        assert.deepEqual(conversation.agent.prompt.tool_ids, ['tool-order']);
        assert.equal(conversation.tts.voice_id, 'voice-customer');
        assert.equal(conversation.agent.first_message, 'Welcome');
        assert.equal(conversation.turn.turn_eagerness, 'high');
        if (existing) assert.deepEqual(conversation.agent.prompt.knowledge_base, [{ id: 'kb' }]);
        assert.equal(conversation.agent.prompt.tools, undefined);
        assert.equal(saved.voice_provider_config.app_managed.effective_realtime_model, model);
      });
    }
    await t.test('switching to Custom sends null and restores stored choices', async () => {
      reset(null, true);
      assert.equal((await publish()).status, 200);
      const conversation = writes.find((item) => item.path.includes('/agents')).body.conversation_config;
      assert.equal(conversation.realtime_model, null);
      assert.equal(conversation.agent.prompt.llm, 'gpt-5.4-mini');
      assert.equal(conversation.tts.model_id, 'eleven_v3_conversational');
      assert.equal(saved.voice_provider_config.app_managed.effective_realtime_model, null);
    });
    await t.test('low Max token limits fail before provider writes', async () => {
      reset('eleven_realtime_v1_max', true, 512);
      const result = await publish();
      assert.match(result.body.error, /1,024/);
      assert.equal(writes.length, 0);
      assert.equal(saved, null);
    });
    await t.test('workspace rollout rejection is returned and never recorded as synced', async () => {
      reset('eleven_realtime_v1_mini', true);
      rejection = 'Realtime models are not available for this workspace.';
      const result = await publish();
      assert.equal(result.status, 500);
      assert.equal(result.body.error, rejection);
      assert.equal(saved, null);
    });
    await t.test('provider ignoring the setting cannot produce a false sync success', async () => {
      reset('eleven_realtime_v1_max', true);
      ignoreRealtime = true;
      assert.match((await publish()).body.error, /did not apply/);
      assert.equal(saved, null);
    });
  } finally {
    runtime.Deno = original.Deno; runtime.fetch = original.fetch; runtime.elevenFixture = original.fixture;
  }
});
