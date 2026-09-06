import type { AnswerSources } from '../types/chat';
import type { MemoryReceipt } from '../../shared/agent-memory';

export type SourceActivity = { state: 'idle' | 'active' | 'complete' | 'failed' | 'carried'; label: string };

export function sourceActivity(sources?: AnswerSources, memory?: MemoryReceipt, busy = false): Record<'memory' | 'knowledge' | 'data', SourceActivity> {
  const events = (sources?.memoryEvents || []).filter(event => event.turn_id === sources?.turnId);
  const searching = events.some(event => event.kind === 'search_requested');
  const returned = events.some(event => event.kind === 'retrieved');
  const writes = events.filter(event => ['saved', 'updated', 'forgotten'].includes(event.kind));
  const memoryFailed = events.some(event => event.kind === 'failed');
  const currentCount = memory?.records.length || 0;
  const carried = memory?.carriedRecords.length || 0;
  let personal: SourceActivity = { state: 'idle', label: 'Not accessed this turn' };
  if (carried) personal = { state: 'carried', label: 'Available from earlier in this conversation' };
  if (memory?.playbooks.length) personal = { state: 'complete', label: `${memory.playbooks.length} playbooks supplied` };
  if (searching || memory?.lookup === 'requested') personal = {
    state: busy && searching && !returned ? 'active' : 'complete',
    label: busy && searching && !returned ? 'Searching memories…' : `${currentCount || events.filter(event => event.kind === 'retrieved').flatMap(event => (event.payload.records as unknown[]) || []).length} memories retrieved`
  };
  if (writes.length) personal = { state: 'complete', label: writes.some(event => event.kind === 'updated') ? 'Memory updated' : writes.some(event => event.kind === 'forgotten') ? 'Memory forgotten' : 'Memory saved' };
  if (memoryFailed) personal = { state: 'failed', label: 'Memory operation failed' };

  const sql = (sources?.tools || []).filter(tool => /execute_sql/i.test(tool.toolName));
  const earlierSql = (sources?.carriedTools || []).some(tool => /execute_sql/i.test(tool.toolName));
  const pending = sql.some(tool => ['pending', 'running'].includes(tool.status));
  const failed = sql.some(tool => tool.status === 'failed');
  return {
    memory: personal,
    knowledge: sources?.ragStatus === 'searching'
      ? { state: busy ? 'active' : 'idle', label: busy ? 'Reading product guide…' : 'Retrieval incomplete' }
      : sources?.ragStatus === 'failed' ? { state: 'failed', label: 'Document retrieval failed' }
      : sources?.ragStatus === 'retrieved' ? { state: 'complete', label: `${sources.rag?.citations.length || 0} passages retrieved` }
      : { state: 'idle', label: 'Not accessed this turn' },
    data: pending && busy ? { state: 'active', label: 'Checking catalog…' }
      : failed ? { state: 'failed', label: 'Database lookup failed' }
      : sql.some(tool => tool.status === 'succeeded') ? { state: 'complete', label: `${sql.filter(tool => tool.status === 'succeeded').length} database results returned` }
      : earlierSql ? { state: 'carried', label: 'Available from earlier in this conversation' }
      : { state: 'idle', label: pending ? 'Lookup incomplete' : 'Not accessed this turn' }
  };
}
