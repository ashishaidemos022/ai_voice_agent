import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Postgres memory migration: scoped reads, versioned correction, stale-write rejection and forgetting', async () => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
  const agent = '33333333-3333-4333-8333-333333333333', alienAgent = '44444444-4444-4444-8444-444444444444';
  const alex = '55555555-5555-4555-8555-555555555555', sam = '66666666-6666-4666-8666-666666666666';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table va_users(id uuid primary key);
      create table va_agent_configs(id uuid primary key,user_id uuid references va_users);
      create table va_chat_sessions(id uuid primary key,user_id uuid,agent_preset_id uuid);
      create table va_chat_messages(id uuid primary key,user_id uuid,session_id uuid);
      create function current_va_user_id() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id',true),'')::uuid $$;
      insert into va_users values ('${owner}'),('${other}');
      insert into va_agent_configs values ('${agent}','${owner}'),('${alienAgent}','${other}');`);
    await db.exec(await readFile(new URL('../supabase/migrations/20260905120000_add_agent_memory.sql', import.meta.url), 'utf8'));
    await db.query('insert into va_memory_subjects(id,user_id,name) values($1,$2,$3),($4,$5,$6)', [alex, owner, 'Alex', sam, other, 'Sam']);
    const record = { kind: 'semantic', memory_key: 'shoe_budget', title: 'Usual shoe budget', content: '$250', source: 'owner' };
    const write = async (value: object, expected: number | null = null, user = owner, customer = alex, agentId = agent) => {
      const result = await db.query<{ record: { id: string; content: string; status: string; version: number } }>('select to_jsonb(va_write_memory($1,$2,$3,$4,$5)) as record', [user, agentId, customer, JSON.stringify(value), expected]);
      return result.rows[0].record;
    };
    const first = await write(record, 0); assert.equal(first.version, 1);
    const same = await write(record); assert.equal(same.version, 1, 'identical retried save is idempotent');
    const changed = await write({ ...record, content: '$350' }, 1);
    assert.equal(changed.id, first.id); assert.equal(changed.version, 2);
    assert.equal((await db.query('select * from va_memories where status=\'active\'')).rows.length, 1);
    assert.equal((await db.query('select * from va_memory_versions')).rows.length, 2);
    await assert.rejects(write({ ...record, content: '$400' }, 1), /Memory changed/);
    await assert.rejects(write(record, null, owner, sam), /Profile not found/);
    await assert.rejects(write(record, null, owner, alex, alienAgent), /Agent not found/);
    await assert.rejects(write({ ...record, source_session_id: '77777777-7777-4777-8777-777777777777' }), /Invalid source session/);
    await write(record, 0, other, sam, alienAgent);
    await db.exec(`set role authenticated; set test.user_id='${owner}';`);
    const visible = await db.query<{ user_id: string }>('select user_id from va_memories');
    assert.equal(visible.rows.length, 1); assert.equal(visible.rows[0].user_id, owner);
    assert.equal((await db.query('select * from va_memory_subjects')).rows.length, 1);
    assert.equal((await db.query('select * from va_memory_versions')).rows.length, 2);
    await assert.rejects(db.query('update va_memories set content=\'forged\''), /permission denied/);
    await assert.rejects(write({ ...record, content: 'forged' }), /permission denied/);
    await db.exec('reset role');
    const forgotten = await write({ ...record, content: '$350', status: 'forgotten' }, 2);
    assert.equal(forgotten.status, 'forgotten'); assert.equal(forgotten.version, 3);
    assert.equal((await db.query('select * from va_memories where user_id=$1 and status=\'active\'', [owner])).rows.length, 0);
  } finally { await db.close(); }
});
