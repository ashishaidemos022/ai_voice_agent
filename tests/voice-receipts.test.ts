import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimateRealtimeResponseCost,
  summarizeVoiceReceipts,
  VoiceReceiptBuilder,
  voiceReceiptLatency,
  voiceWorkflowFingerprint,
  type VoiceReceiptContext,
  type VoiceTurnReceipt
} from '../shared/voice-receipts.ts';

const realtimeUsage = {
  input_tokens: 1200,
  output_tokens: 300,
  input_token_details: { text_tokens: 1000, audio_tokens: 200, cached_tokens: 500, cached_tokens_details: { text_tokens: 500, audio_tokens: 0 } },
  output_token_details: { text_tokens: 100, audio_tokens: 200 }
};

function builder(context: Partial<VoiceReceiptContext> = {}) {
  let latest: VoiceTurnReceipt[] = [];
  const receipts = new VoiceReceiptBuilder(
    () => ({ policyMode: 'rag', voiceModel: 'gpt-realtime-2.1', checkpoint: null, ...context }),
    (next) => { latest = next; }
  );
  return { receipts, latest: () => latest };
}

test('realtime response cost prices text, cached text, and audio tokens separately', () => {
  // 500 text × $4 + 500 cached × $0.4 + 200 audio in × $32 + 100 text out × $24 + 200 audio out × $64, per million.
  assert.equal(estimateRealtimeResponseCost('gpt-realtime-2.1', realtimeUsage), 0.0238);
  assert.equal(estimateRealtimeResponseCost('gpt-live-1', realtimeUsage), null);
});

test('RAG turn receipt carries retrieval cost, voice model cost, and first-audio latency breakdown', () => {
  const { receipts, latest } = builder();
  receipts.userTurn('When does Wren open?');
  receipts.retrieval({ model: 'gpt-5.4-mini', latencyMs: 900, inputTokens: 800, outputTokens: 60, costUsd: 0.002, costKind: 'estimated' });
  receipts.responseUsage(realtimeUsage);
  receipts.audioTurnCompleted({ firstAudioMs: 1600, toolCallMs: null });

  const [turn] = latest();
  assert.equal(turn.route, 'rag');
  assert.equal(turn.reasonCode, 'rag_policy_knowledge_turn');
  assert.equal(turn.closed, true);
  assert.deepEqual(voiceReceiptLatency(turn), { measured: true, total: 1600, retrieval: 900, adapter: 0, voice: 700 });
  const summary = summarizeVoiceReceipts(latest());
  assert.equal(summary.retrievalCostUsd, 0.002);
  assert.equal(summary.voiceCostUsd, 0.0238);
  assert.equal(summary.routes.rag, 1);
});

test('adapter turn records checkpoint identity and a transcript arriving after the response fills the same turn', () => {
  const checkpoint = { id: 'train-tinker-wren', name: 'Wren FAQ', backend: 'tinker' as const };
  const { receipts, latest } = builder({ policyMode: 'automatic', checkpoint });
  receipts.responseUsage(realtimeUsage);
  receipts.adapter({ model: 'thinkingmachines/Inkling-Small', latencyMs: 450, inputTokens: 100, outputTokens: 25, costUsd: 0.000094, costKind: 'estimated' });
  receipts.userTurn('What are the hours?');
  receipts.audioTurnCompleted({ firstAudioMs: 1100, toolCallMs: 460 });
  receipts.userTurn('Thanks');

  const [adapterTurn, smallTalk] = latest();
  assert.equal(latest().length, 2);
  assert.equal(adapterTurn.query, 'What are the hours?');
  assert.equal(adapterTurn.route, 'adapter');
  assert.equal(adapterTurn.reasonCode, 'automatic_knowledge_to_adapter');
  assert.equal(adapterTurn.checkpoint?.name, 'Wren FAQ');
  assert.equal(smallTalk.route, 'voice');
  assert.equal(smallTalk.closed, false);
});

test('adapter failure fallback is explained and workflow fingerprints ignore transcript punctuation and case', () => {
  const { receipts, latest } = builder({ policyMode: 'automatic' });
  receipts.userTurn('Where is parking?');
  receipts.route('rag', 'adapter');
  assert.equal(latest()[0].reasonCode, 'adapter_failed_rag_fallback');
  assert.equal(voiceWorkflowFingerprint(['Where is parking?', 'Thanks!']), voiceWorkflowFingerprint(['where is parking', 'thanks']));
  assert.notEqual(voiceWorkflowFingerprint(['Where is parking?']), voiceWorkflowFingerprint(['When do you open?']));
});

test('a user transcript that lands after the spoken answer labels that turn instead of opening a new one', () => {
  const { receipts, latest } = builder();
  receipts.responseUsage(realtimeUsage);
  receipts.audioTurnCompleted({ firstAudioMs: 800, toolCallMs: null });
  receipts.userTurn('Hello there');
  receipts.userTurn('Do you have parking?');
  assert.equal(latest().length, 2);
  assert.equal(latest()[0].query, 'Hello there');
  assert.equal(latest()[0].voiceUsage.responses, 1);
  assert.equal(latest()[1].query, 'Do you have parking?');
});
