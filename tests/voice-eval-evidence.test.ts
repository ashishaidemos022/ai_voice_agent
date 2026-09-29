import test from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceRecorder, fromEvidenceRow, mergeToolLog, toEvidenceRows } from '../shared/voice-eval/evidence.ts';
import { configFingerprint } from '../shared/voice-eval/fingerprint.ts';
import { applyEvalContext } from '../shared/voice-eval/eval-context.ts';
import { agentSays, toolCall } from './helpers/voice-eval-fixtures.ts';

test('recorder converts absolute times and tracks unflushed events', () => {
  const recorder = new EvidenceRecorder(1000);
  recorder.record({ kind: 'agent_audio_start', at: 1500.4 });
  recorder.record({ kind: 'caller_transcript', at: 900, text: 'hi' });
  assert.deepEqual(recorder.events().map((e) => e.atMs), [500, 0]);
  const first = recorder.takeUnflushed();
  assert.equal(first.fromSeq, 0);
  assert.equal(first.events.length, 2);
  assert.equal(recorder.hasUnflushed(), false);
});

test('a failed flush is retried from the same sequence without duplicates', () => {
  const recorder = new EvidenceRecorder(0);
  recorder.record({ kind: 'agent_audio_start', at: 1 });
  const batch = recorder.takeUnflushed();
  recorder.record({ kind: 'agent_audio_start', at: 2 });
  recorder.markUnflushed(batch.fromSeq);
  const retry = recorder.takeUnflushed();
  assert.equal(retry.fromSeq, 0);
  assert.deepEqual(retry.events.map((e) => e.atMs), [1, 2]);
  assert.equal(recorder.takeUnflushed().events.length, 0);
});

test('evidence rows round-trip', () => {
  const rows = toEvidenceRows('run-1', 5, [agentSays(10, 'hello'), toolCall(20, 'c1', { action: 'lookup_appointments' })]);
  assert.deepEqual(rows.map((r) => r.seq), [5, 6]);
  assert.deepEqual(rows[0].payload, { text: 'hello' });
  assert.deepEqual(fromEvidenceRow(rows[1]), toolCall(20, 'c1', { action: 'lookup_appointments' }));
});

test('mergeToolLog replaces client tool events with the server log', () => {
  const merged = mergeToolLog(
    [agentSays(100, 'one moment'), toolCall(150, 'client', { action: 'x' })],
    [{ id: 'row1', tool_name: 'healthcare_patient_access', input_params: { action: 'book_appointment' }, output_result: { change: {} }, execution_time_ms: 400, status: 'success', created_at: '2026-09-29T15:00:01.000Z' }],
    '2026-09-29T15:00:00.000Z'
  );
  assert.deepEqual(merged.map((e) => e.kind), ['agent_transcript', 'tool_call', 'tool_result']);
  assert.equal(merged[1].atMs, 600);
  assert.equal(merged[2].atMs, 1000);
  assert.equal(mergeToolLog([agentSays(1, 'x')], [], '2026-09-29T15:00:00.000Z').length, 1);
});

test('fingerprint is stable and order-insensitive for tools', async () => {
  const base = { instructions: 'be nice', model: 'gpt-realtime', voice: 'alloy', provider: 'openai_realtime', toolNames: ['b', 'a'] };
  const a = await configFingerprint(base);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, await configFingerprint({ ...base, toolNames: ['a', 'b'] }));
  assert.notEqual(a, await configFingerprint({ ...base, voice: 'verse' }));
});

test('eval context overrides patient reference and adds run id only when active', () => {
  const params = { action: 'book_appointment', patient_reference: 'DEMO-1001' };
  assert.deepEqual(applyEvalContext(params, null), params);
  assert.deepEqual(applyEvalContext(params, { evalRunId: 'r', patientReference: 'EVAL-0001' }), {
    action: 'book_appointment', patient_reference: 'EVAL-0001', eval_run_id: 'r'
  });
});
