import test from 'node:test';
import assert from 'node:assert/strict';
import { retrievedCitations } from '../shared/rag-evidence.ts';

test('citations come only from returned search passages, never generated claims', () => {
  assert.deepEqual(retrievedCitations([{ type: 'message', content: [{ text: '{"citations":[{"file_id":"invented.xlsx"}]}' }] }]), []);
  assert.deepEqual(retrievedCitations([{ type: 'file_search_call', results: [
    { file_id: 'file-real', filename: 'Guide.pdf', text: 'Actual passage.' },
    { file_id: 'file-real', filename: 'Guide.pdf', text: 'Actual passage.' },
    { file_id: 'file-empty', text: '' }
  ] }]), [{ file_id: 'file-real', title: 'Guide.pdf', snippet: 'Actual passage.' }]);
});
