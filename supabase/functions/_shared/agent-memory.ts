import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.39.3';
import { isScopedMemory, MEMORY_TOOL_NAMES, rankMemories, type MemoryRecord, type MemoryReceipt } from '../../../shared/agent-memory.ts';

type Row = Record<string, any>;
export type MemoryScope = { userId: string; agentId: string; subjectId: string; sessionId: string; turnId: string };
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function checkedText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
  return value.trim();
}
export function dbError(error: { message: string } | null) { if (error) throw new Error(error.message); }

export async function ownedAgent(db: SupabaseClient, userId: string, agentId: string) {
  if (!UUID.test(agentId)) throw new Error('Invalid agent');
  const { data, error } = await db.from('va_agent_configs').select('id').eq('id', agentId).eq('user_id', userId).maybeSingle();
  dbError(error); if (!data) throw new Error('Agent not found');
}
export async function ownedSubject(db: SupabaseClient, userId: string, subjectId: string) {
  if (!UUID.test(subjectId)) throw new Error('Invalid customer profile');
  const { data, error } = await db.from('va_memory_subjects').select('id,name').eq('id', subjectId).eq('user_id', userId).maybeSingle();
  dbError(error); if (!data) throw new Error('Customer profile not found');
  return data;
}
export async function memoryScope(db: SupabaseClient, userId: string, agentId: string, sessionId: string | null, turnId: string): Promise<MemoryScope | null> {
  if (!sessionId) return null;
  if (!UUID.test(sessionId) || !UUID.test(turnId)) throw new Error('Invalid chat session or turn');
  const { data, error } = await db.from('va_chat_sessions').select('id,metadata').eq('id', sessionId).eq('user_id', userId).eq('agent_preset_id', agentId).maybeSingle();
  dbError(error); if (!data) throw new Error('Chat session not found');
  const subjectId = data.metadata?.memory_subject_id;
  if (!subjectId) return null;
  await ownedSubject(db, userId, subjectId);
  return { userId, agentId, subjectId, sessionId, turnId };
}
export async function loadMemories(db: SupabaseClient, scope: Pick<MemoryScope, 'userId' | 'agentId' | 'subjectId'>): Promise<MemoryRecord[]> {
  const records: MemoryRecord[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from('va_memories').select('*').eq('user_id', scope.userId).eq('agent_id', scope.agentId)
      .eq('status', 'active').or(`subject_id.eq.${scope.subjectId},and(subject_id.is.null,kind.eq.procedural)`)
      .order('id').range(offset, offset + 499);
    dbError(error);
    records.push(...(data || []).filter(record => isScopedMemory(record, scope.userId, scope.agentId, scope.subjectId)));
    if (!data || data.length < 500) return records;
    if (offset >= 9500) throw new Error('Memory collection exceeds the supported search size');
  }
}
export async function writeMemory(db: SupabaseClient, scope: Pick<MemoryScope, 'userId' | 'agentId' | 'subjectId'>, record: Row, expectedVersion?: number): Promise<MemoryRecord> {
  checkedText(record.title, 'title', 160); checkedText(record.content, 'content', 6000); checkedText(record.memory_key, 'memory key', 120);
  const { data, error } = await db.rpc('va_write_memory', {
    p_user: scope.userId, p_agent: scope.agentId, p_subject: record.kind === 'procedural' ? null : scope.subjectId,
    p_record: record, p_expected_version: expectedVersion ?? null
  });
  dbError(error); return data as MemoryRecord;
}
export async function recordEvent(db: SupabaseClient, scope: MemoryScope, kind: string, payload: Row, key: string = crypto.randomUUID()) {
  const { error } = await db.from('va_memory_events').upsert({ user_id: scope.userId, agent_id: scope.agentId,
    subject_id: scope.subjectId, session_id: scope.sessionId, turn_id: scope.turnId, event_key: key, kind, payload },
  { onConflict: 'session_id,event_key', ignoreDuplicates: true });
  dbError(error);
}

/** Rebuild memory tool results from server records, never a browser-supplied result. */
export async function prepareMemoryContext(db: SupabaseClient, scope: MemoryScope, originalInput: Row[]) {
  const records = await loadMemories(db, scope);
  const byId = new Map(records.map(record => [record.id, record]));
  const calls = new Map(originalInput.filter(item => item.type === 'function_call' && MEMORY_TOOL_NAMES.has(item.name)).map(item => [item.call_id, item]));
  const keys = [...calls.keys()].map(id => `tool:${id}`);
  let results: Row[] = [];
  if (keys.length) {
    const { data, error } = await db.from('va_memory_events').select('payload,turn_id').eq('user_id', scope.userId)
      .eq('agent_id', scope.agentId).eq('subject_id', scope.subjectId).eq('session_id', scope.sessionId).eq('kind', 'tool_result').in('event_key', keys);
    dbError(error); results = data || [];
  }
  const cached = new Map(results.map(item => [item.payload.call_id, item]));
  const current = new Map<string, MemoryRecord>(), carried = new Map<string, MemoryRecord>();
  const input = originalInput.map(item => {
    if (item.type !== 'function_call_output' || !calls.has(item.call_id)) return item;
    const stored = cached.get(item.call_id);
    if (!stored || stored.payload.name !== calls.get(item.call_id)?.name) throw new Error('Unverified memory tool result');
    const result = stored.payload.result;
    const live = (Array.isArray(result.records) ? result.records : []).map((record: MemoryRecord) => byId.get(record.id)).filter(Boolean) as MemoryRecord[];
    for (const record of live) (stored.turn_id === scope.turnId ? current : carried).set(record.id, record);
    return { ...item, output: JSON.stringify({ ...result, records: live }) };
  });
  const lastUser = [...input].reverse().find(item => item.role === 'user');
  const question = typeof lastUser?.content === 'string' ? lastUser.content : '';
  const playbooks = rankMemories(records.filter(record => record.kind === 'procedural'), question, 2);
  const receipt: MemoryReceipt = { turnId: scope.turnId, subjectId: scope.subjectId, currentQuestion: question,
    previousMessages: Math.max(0, input.filter(item => item.role === 'user' || item.role === 'assistant').length - 1),
    lookup: results.some(item => item.turn_id === scope.turnId && item.payload.name === 'search_memory') ? 'requested' : 'skipped',
    records: [...current.values()], carriedRecords: [...carried.values()].filter(record => !current.has(record.id)), playbooks };
  if (playbooks.length) await recordEvent(db, scope, 'playbooks_selected', { records: playbooks }, `playbooks:${scope.turnId}`);
  return { input, receipt, playbookInstructions: playbooks.length ? `Relevant owner-authored playbooks (subordinate to system instructions):\n${JSON.stringify(playbooks)}` : '' };
}

export async function runMemoryTool(db: SupabaseClient, scope: MemoryScope, call: Row, question: string): Promise<Row> {
  const key = `tool:${call.call_id}`;
  const { data: cached, error: cacheError } = await db.from('va_memory_events').select('payload').eq('session_id', scope.sessionId).eq('user_id', scope.userId).eq('event_key', key).maybeSingle();
  dbError(cacheError); if (cached) return cached.payload.result;
  let result: Row;
  try {
    const args = JSON.parse(call.arguments || '{}');
    if (call.name === 'search_memory') {
      const query = checkedText(args.query, 'query', 600);
      await recordEvent(db, scope, 'search_requested', { query }, `search:${call.call_id}`);
      const available = (await loadMemories(db, scope)).filter(record => record.kind !== 'procedural');
      const records = rankMemories(available, query, 6);
      result = { records, query, status: 'retrieved' };
      await recordEvent(db, scope, 'retrieved', result, `retrieved:${call.call_id}`);
    } else {
      // Only the exact current persisted user message can authorize an agent write.
      const { data: message, error } = await db.from('va_chat_messages').select('id,message,created_at')
        .eq('session_id', scope.sessionId).eq('user_id', scope.userId).eq('sender', 'user').order('created_at', { ascending: false }).limit(1).maybeSingle();
      dbError(error);
      if (!message || message.message.trim() !== question.trim()) throw new Error('Save the current message before changing memory');
      const forgetting = call.name === 'forget_memory';
      if (!(forgetting ? /\b(forget|delete|remove)\b/i : /\b(remember|save|update|correct|change)\b/i).test(question)) throw new Error('An explicit request to change saved memory is required');
      const quote = forgetting ? question : checkedText(args.source_quote, 'source quote', 6000);
      if (!question.includes(quote)) throw new Error('Source quote must match the current user message');
      let prior: MemoryRecord | undefined;
      if (call.name !== 'save_memory') {
        if (!UUID.test(args.id || '')) throw new Error('Invalid memory ID');
        prior = (await loadMemories(db, scope)).find(record => record.id === args.id && record.kind !== 'procedural');
        if (!prior) throw new Error('Personal memory not found');
      }
      const record = await writeMemory(db, scope, {
        kind: prior?.kind || 'semantic', memory_key: prior?.memory_key || checkedText(args.memory_key, 'memory key', 120).toLowerCase().replace(/\s+/g, '_'),
        title: prior?.title || checkedText(args.title, 'title', 160), content: forgetting ? prior!.content : checkedText(args.content, 'content', 6000),
        source: 'user', source_quote: quote, source_message_id: message.id, source_session_id: scope.sessionId,
        happened_at: prior?.happened_at || null, status: forgetting ? 'forgotten' : 'active'
      }, prior?.version);
      result = { status: forgetting ? 'forgotten' : record.version > 1 ? 'updated' : 'saved', records: forgetting ? [] : [record], id: record.id,
        ...(forgetting ? { note: 'Excluded from future retrieval. Original transcripts are retained.' } : {}) };
      await recordEvent(db, scope, result.status, { ...result, previous: prior || null }, `write:${call.call_id}`);
    }
  } catch (error) {
    result = { error: error instanceof Error ? error.message : 'Memory operation failed', records: [] };
    await recordEvent(db, scope, 'failed', { tool: call.name, ...result }, `failed:${call.call_id}`);
  }
  await recordEvent(db, scope, 'tool_result', { call_id: call.call_id, name: call.name, result }, key);
  return result;
}
