import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceActivity } from '../src/lib/source-activity.ts';

const sources = { turnId: 'turn', question: 'Compare these', instructions: '', rag: null, ragStatus: 'skipped', tools: [], carriedTools: [] };
const event = (kind: string, turn_id = 'turn') => ({ kind, turn_id, payload: {} });

test('memory pulses only after a real search request, and stops when results arrive', () => {
  assert.equal(sourceActivity(sources as any, undefined, true).memory.state, 'idle');
  assert.equal(sourceActivity({ ...sources, memoryEvents: [event('search_requested')] } as any, undefined, true).memory.state, 'active');
  assert.equal(sourceActivity({ ...sources, memoryEvents: [event('search_requested'), event('retrieved')] } as any, undefined, true).memory.state, 'complete');
  assert.equal(sourceActivity({ ...sources, memoryEvents: [event('search_requested', 'old-turn')] } as any, undefined, true).memory.state, 'idle');
});

test('carried memories are not presented as a new search; updates and failures are explicit', () => {
  const receipt = { records: [], carriedRecords: [{}], playbooks: [], lookup: 'skipped' };
  assert.equal(sourceActivity(sources as any, receipt as any, true).memory.state, 'carried');
  assert.equal(sourceActivity({ ...sources, memoryEvents: [event('updated')] } as any).memory.label, 'Memory updated');
  assert.equal(sourceActivity({ ...sources, memoryEvents: [event('failed')] } as any).memory.state, 'failed');
});

test('RAG and SQL reflect live, completed, failed, and carried states independently', () => {
  const active = { ...sources, ragStatus: 'searching', tools: [{ toolName: 'execute_sql', status: 'running' }] };
  assert.equal(sourceActivity(active as any, undefined, true).knowledge.state, 'active');
  assert.equal(sourceActivity(active as any, undefined, true).data.state, 'active');
  assert.notEqual(sourceActivity(active as any, undefined, false).data.state, 'active');
  assert.equal(sourceActivity({ ...sources, tools: [{ toolName: 'execute_sql', status: 'succeeded' }] } as any).data.state, 'complete');
  assert.equal(sourceActivity({ ...sources, tools: [{ toolName: 'execute_sql', status: 'failed' }] } as any).data.state, 'failed');
  assert.equal(sourceActivity({ ...sources, carriedTools: [{ toolName: 'execute_sql', status: 'succeeded' }] } as any).data.state, 'carried');
});
