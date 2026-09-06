import test from 'node:test';
import assert from 'node:assert/strict';
import { rankMemories, isScopedMemory, memoryReferences, MEMORY_TOOLS, type MemoryRecord, type MemoryReceipt } from '../shared/agent-memory.ts';

const base: MemoryRecord = { id: '11111111-1111-4111-8111-111111111111', user_id: 'owner', agent_id: 'agent', subject_id: 'alex',
  kind: 'semantic', memory_key: 'shoe_size', title: 'Shoe size and fit', content: 'US 10 wide', source_quote: 'Remember my size is US 10 wide',
  source_message_id: null, source_session_id: null, source: 'user', happened_at: null, status: 'active', version: 1,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' };
const records: MemoryRecord[] = [base,
  { ...base, id: '22222222-2222-4222-8222-222222222222', memory_key: 'shoe_budget', title: 'Shoe budget', content: '$250' },
  { ...base, id: '33333333-3333-4333-8333-333333333333', memory_key: 'past_fit', kind: 'episodic', title: 'Past shoe comfort', content: 'Pointed toes pinched at the conference', happened_at: '2026-08-01T00:00:00Z' },
  { ...base, id: '44444444-4444-4444-8444-444444444444', memory_key: 'receipts', title: 'Receipt preference', content: 'Email receipts' }
];
test('footwear search retrieves relevant facts and experience, leaving receipt preference out', () => {
  const found = rankMemories(records, 'shoe size fit budget comfort');
  assert.equal(found.length, 3); assert(!found.some(record => record.memory_key === 'receipts'));
});
test('unrelated or empty queries never fall back to arbitrary recent memories', () => {
  for (const query of ['', 'What is 12 × 8?', 'please tell me about it']) assert.deepEqual(rankMemories(records, query), []);
});
test('forgotten facts are excluded; singular/plural topic words match', () => {
  assert.equal(rankMemories([{ ...base, status: 'forgotten' }], 'shoes size').length, 0);
  assert.equal(rankMemories([base], 'shoes').length, 1);
});
test('customer memories require owner, agent and subject matches', () => {
  assert(isScopedMemory(base, 'owner', 'agent', 'alex'));
  assert(!isScopedMemory(base, 'other', 'agent', 'alex'));
  assert(!isScopedMemory(base, 'owner', 'other', 'alex'));
  assert(!isScopedMemory(base, 'owner', 'agent', 'sam'));
});
test('only agent-scoped playbooks can be shared across customer profiles', () => {
  assert(isScopedMemory({ ...base, kind: 'procedural', subject_id: null }, 'owner', 'agent', 'sam'));
  assert(!isScopedMemory({ ...base, kind: 'procedural' }, 'owner', 'agent', 'sam'));
});
test('recency breaks equal relevance for episodes and retrieval is bounded', () => {
  const older = records[2]; const newer = { ...older, id: 'new', happened_at: '2026-09-02T00:00:00Z' };
  assert.deepEqual(rankMemories([older, newer], 'comfort', 1).map(record => record.id), ['new']);
});
test('answer references are validated against supplied records and deduplicated', () => {
  const receipt: MemoryReceipt = { turnId: 'turn', subjectId: 'alex', currentQuestion: 'Shoes?', previousMessages: 0, lookup: 'requested', records: [base], carriedRecords: [], playbooks: [] };
  assert.deepEqual(memoryReferences(`[memory:${base.id}] [memory:${records[1].id}] [memory:${base.id}]`, receipt), [base]);
  assert.deepEqual(memoryReferences(`[memory:${base.id}]`), []);
});
test('tool schemas require all declared fields and prohibit undeclared scope overrides', () => {
  for (const tool of MEMORY_TOOLS) {
    assert.equal(tool.strict, true); assert.equal(tool.parameters.additionalProperties, false);
    assert.deepEqual(tool.parameters.required, Object.keys(tool.parameters.properties));
    assert(!Object.keys(tool.parameters.properties).some(key => /user_id|subject_id|agent_id/.test(key)));
  }
});
