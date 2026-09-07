import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { spokenText, speechSegments, SpeechGate } from '../shared/voice-speech.ts';

test('speech removes visual citations and images while preserving the actual answer', () => {
  assert.equal(spokenText('**Budget: $600.** [memory:2c770df2-6ad1-414b-8db9-33cc19a30734]\n![Shoe](https://example.com/shoe.png)\n[View shoe](https://example.com) [K1]'), 'Budget: $600. \n\nView shoe');
});

test('audio endpoint isolates owned routed sessions and speaks only persisted answers', async () => {
  const calls: any[] = [];
  const db = { auth: { getUser: async (token: string) => ({ data: { user: token === 'valid' ? { id: 'auth-owner' } : null } }) }, from(table: string) {
    const filters: Record<string, string> = {};
    return { async insert(event: any) { calls.push({ event }); return { error: null }; }, select() { return this; }, eq(key: string, value: string) { filters[key] = value; return this; }, async maybeSingle() {
      if (table === 'va_users') return { data: { id: 'owner' } };
      if (table === 'va_chat_sessions') return { data: filters.user_id === 'owner' && filters.agent_preset_id === 'agent' && ['voice', 'chat'].includes(filters.id) ? { id: filters.id, status: 'active', metadata: filters.id === 'voice' ? { channel: 'routed_voice' } : {} } : null };
      if (table === 'va_chat_messages') return { data: filters.session_id === 'voice' && filters.user_id === 'owner' && filters.sender === 'assistant' && filters['raw->sources->>turnId'] === 'turn' ? { message: 'Your budget is **$600**. [K1]' } : null };
      throw new Error(`Unexpected table ${table}`);
    } };
  } };
  const runtime = globalThis as any;
  const previous = { Deno: runtime.Deno, db: runtime.voiceTestDb, fetch: globalThis.fetch };
  let handler: (request: Request) => Promise<Response>;
  runtime.voiceTestDb = db;
  runtime.Deno = { env: { get: () => 'configured' }, serve: (fn: typeof handler) => { handler = fn; } };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return String(url).endsWith('/transcriptions') ? Response.json({ text: 'Remember my budget is $600.' }) : new Response('test-audio', { headers: { 'Content-Type': 'audio/mpeg' } });
  };
  try {
    const bundle = await build({ entryPoints: ['supabase/functions/voice-audio/index.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'database-mock', setup(builder) {
      builder.onResolve({ filter: /^npm:/ }, () => ({ path: 'db', namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const createClient = () => globalThis.voiceTestDb;' }));
    } }] });
    await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    async function request(session: string, extra = {}, token = 'valid') {
      const form = new FormData();
      for (const [key, value] of Object.entries({ session_id: session, agent_id: 'agent', action: 'speak', turn_id: 'turn', voice: 'coral', ...extra })) form.set(key, value as string);
      return handler!(new Request('https://test.invalid', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }));
    }
    assert.equal((await request('voice', {}, 'invalid')).status, 401);
    assert.equal((await request('someone-elses-session')).status, 403);
    assert.equal((await request('chat')).status, 403, 'ordinary chat sessions cannot call the audio endpoint');
    assert.equal((await request('voice', { turn_id: 'not-saved' })).status, 404);
    assert.equal((await request('voice', { voice: 'unapproved' })).status, 400);
    for (const segment of ['-1', '1.5', 'NaN', '999']) assert.equal((await request('voice', { segment })).status, 400);
    assert.equal(calls.length, 0, 'invalid requests must not call the speech provider');
    assert.equal((await request('voice', { input: 'Untrusted caller text' })).status, 200);
    assert.equal(JSON.parse(calls[0].init.body).input, 'Your budget is $600.');
    assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/speech');
    const speechUsage = calls.find(call => call.event)?.event;
    assert.equal(speechUsage.session_id, 'voice');
    assert.equal(speechUsage.operation, 'speak');
    assert.equal(speechUsage.estimated_cost_usd, null, 'unconfigured rates are unknown, never zero');
    assert.equal((await request('voice', { action: 'transcribe' })).status, 400);
    assert.equal((await request('voice', { action: 'transcribe', audio: new Blob(['bad'], { type: 'text/plain' }) })).status, 400);
    const transcription = await request('voice', { action: 'transcribe', audio: new Blob(['synthetic test recording'], { type: 'audio/webm' }) });
    assert.equal(transcription.status, 200);
    assert.equal((await transcription.json()).text, 'Remember my budget is $600.');
    assert.equal(calls.find(call => String(call.url).endsWith('/transcriptions')).init.body.get('model'), 'gpt-4o-mini-transcribe');
    assert.equal(calls.find(call => String(call.url).endsWith('/transcriptions')).init.body.get('file').name, 'recording.webm');
  } finally { runtime.Deno = previous.Deno; runtime.voiceTestDb = previous.db; globalThis.fetch = previous.fetch; }
});

test('voice usage migration restricts reads by owner and forbids client writes', async () => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table va_users(id uuid primary key); create table va_chat_sessions(id uuid primary key);
      create function current_va_user_id() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id',true),'')::uuid $$;
      insert into va_users values ('${owner}'), ('${other}'); insert into va_chat_sessions values ('${owner}'), ('${other}');`);
    await db.exec(await readFile(new URL('../supabase/migrations/20260907120000_routed_voice_usage.sql', import.meta.url), 'utf8'));
    for (const user of [owner, other]) await db.query('insert into va_voice_audio_events(user_id,session_id,operation,model,latency_ms) values($1,$1,\'speak\',\'tts\',100)', [user]);
    await db.exec(`set role authenticated; set test.user_id='${owner}'`);
    const visible = await db.query('select user_id,estimated_cost_usd from va_voice_audio_events');
    assert.deepEqual(visible.rows, [{ user_id: owner, estimated_cost_usd: null }]);
    await assert.rejects(db.exec('delete from va_voice_audio_events'), /permission denied/);
    await assert.rejects(db.exec('update va_voice_audio_events set estimated_cost_usd=0'), /permission denied/);
    await assert.rejects(db.query('insert into va_voice_audio_events(user_id,session_id,operation,model,latency_ms) values($1,$1,\'speak\',\'tts\',0)', [owner]), /permission denied/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.exec('select * from va_voice_audio_events'), /permission denied/);
  } finally { await db.close(); }
});


test('long answers preserve all words in bounded speech segments', () => {
  const text = 'Here is another sentence. '.repeat(800).trim();
  const parts = speechSegments(text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => part.length <= 3800));
  assert.equal(parts.join(' '), text);
  assert.deepEqual(speechSegments(''), []);
  assert.equal(speechSegments('a'.repeat(9000)).join(''), 'a'.repeat(9000));
});

test('endpointing ignores brief noise and ends sustained speech after silence', () => {
  const gate = new SpeechGate();
  for (let time = 50; time <= 1000; time += 50) assert.equal(gate.sample(time === 100 ? 0.1 : 0, time), 'listen');
  for (let time = 1050; time <= 1400; time += 50) assert.equal(gate.sample(0.05, time), 'listen');
  assert.equal(gate.sample(0, 2300), 'listen');
  assert.equal(gate.sample(0, 2400), 'submit');
  const silent = new SpeechGate();
  assert.equal(silent.sample(0, 1), 'listen');
  assert.equal(silent.sample(0, 60001), 'timeout');
});
