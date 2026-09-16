import { getOpenAIModelPricing, OPENAI_VOICE_DURATION_PRICING, type OpenAIModelId } from './openai-models.ts';

export type VoicePolicyMode = 'rag' | 'adapter' | 'automatic';
export type VoiceTurnRoute = 'voice' | 'rag' | 'adapter';
export type VoiceCostKind = 'reported' | 'estimated' | 'unavailable';

export type VoiceReceiptCheckpoint = {
  id: string;
  name: string;
  backend: 'local' | 'tinker';
  artifactSha256?: string | null;
};

export type VoiceStageReceipt = {
  model: string | null;
  latencyMs: number;
  providerLatencyMs?: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  costKind: VoiceCostKind;
};

export type VoiceModelUsage = {
  responses: number;
  inputTextTokens: number;
  inputAudioTokens: number;
  cachedInputTokens: number;
  outputTextTokens: number;
  outputAudioTokens: number;
  /** Session seconds billed by duration-priced voice models (e.g. GPT-Live). */
  durationSeconds: number;
  /** Null when the voice model has no token pricing (e.g. duration-billed or third-party voice). */
  costUsd: number | null;
};

export type VoiceTurnReceipt = {
  turnId: string;
  startedAt: string;
  query: string | null;
  policyMode: VoicePolicyMode;
  route: VoiceTurnRoute;
  reasonCode: string;
  reason: string;
  voiceModel: string | null;
  checkpoint: VoiceReceiptCheckpoint | null;
  retrieval: VoiceStageReceipt | null;
  adapter: VoiceStageReceipt | null;
  voiceUsage: VoiceModelUsage;
  /** User speech end → first agent audio, as heard by the caller. */
  firstAudioMs: number | null;
  toolCallMs: number | null;
  closed: boolean;
};

type RealtimeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: {
    text_tokens?: number;
    audio_tokens?: number;
    cached_tokens?: number;
    cached_tokens_details?: { text_tokens?: number; audio_tokens?: number };
  };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
};

const count = (value: unknown) => (Number.isFinite(value) ? Math.max(0, Number(value)) : 0);

/** Estimates one realtime response's cost from its text/audio token split. */
export function estimateRealtimeResponseCost(model: string | null | undefined, usage: RealtimeUsage | null | undefined): number | null {
  const pricing = getOpenAIModelPricing(model);
  if (!pricing || !usage || pricing.audioInputPer1M == null || pricing.audioOutputPer1M == null) return null;
  const input = usage.input_token_details || {};
  const output = usage.output_token_details || {};
  const cachedText = count(input.cached_tokens_details?.text_tokens);
  const cachedAudio = count(input.cached_tokens_details?.audio_tokens);
  const inputText = count(input.text_tokens ?? (input.audio_tokens == null ? usage.input_tokens : 0));
  const inputAudio = count(input.audio_tokens);
  const outputText = count(output.text_tokens ?? (output.audio_tokens == null ? usage.output_tokens : 0));
  const outputAudio = count(output.audio_tokens);
  return (
    Math.max(0, inputText - cachedText) * pricing.textInputPer1M +
    cachedText * (pricing.cachedTextInputPer1M ?? pricing.textInputPer1M) +
    Math.max(0, inputAudio - cachedAudio) * pricing.audioInputPer1M +
    cachedAudio * (pricing.cachedAudioInputPer1M ?? pricing.audioInputPer1M) +
    outputText * pricing.textOutputPer1M +
    outputAudio * pricing.audioOutputPer1M
  ) / 1_000_000;
}

export function voicePolicyReason(policyMode: VoicePolicyMode, route: VoiceTurnRoute, fallbackFrom?: VoiceTurnRoute): { reasonCode: string; reason: string } {
  if (fallbackFrom === 'adapter' && route === 'rag') {
    return { reasonCode: 'adapter_failed_rag_fallback', reason: 'The trained adapter request failed, so this turn fell back to knowledge retrieval.' };
  }
  if (route === 'adapter') {
    return policyMode === 'adapter'
      ? { reasonCode: 'fixed_adapter_selected', reason: 'Trained adapter policy is selected, so the checkpoint generated this answer and the voice model only spoke it.' }
      : { reasonCode: 'automatic_knowledge_to_adapter', reason: 'Automatic policy sent this knowledge question to the trained adapter.' };
  }
  if (route === 'rag') {
    return policyMode === 'rag'
      ? { reasonCode: 'rag_policy_knowledge_turn', reason: 'RAG policy retrieved knowledge for this question before the voice model answered.' }
      : { reasonCode: 'automatic_knowledge_to_rag', reason: 'Automatic policy retrieved knowledge because no trained adapter was available.' };
  }
  return { reasonCode: 'voice_model_direct', reason: 'No knowledge was needed, so the live voice model answered directly.' };
}

/** Estimates duration-billed voice cost when a per-minute rate is configured for the model. */
export function estimateVoiceDurationCost(model: string | null | undefined, seconds: number): number | null {
  const perMinute = model ? OPENAI_VOICE_DURATION_PRICING[model.trim() as OpenAIModelId]?.perMinute : undefined;
  return perMinute == null ? null : (seconds / 60) * perMinute;
}

export type VoiceReceiptContext = {
  policyMode: VoicePolicyMode;
  voiceModel: string | null;
  checkpoint: VoiceReceiptCheckpoint | null;
};

/**
 * Assembles one receipt per spoken turn from events that arrive out of order:
 * user transcript, policy routing, retrieval/adapter calls, realtime usage, and
 * audio timing. Events attach to the open turn; a new user transcript or a
 * completed audio turn closes it.
 */
export class VoiceReceiptBuilder {
  private receipts: VoiceTurnReceipt[] = [];
  private getContext: () => VoiceReceiptContext;
  private onChange: (receipts: VoiceTurnReceipt[]) => void;
  private now: () => Date;
  private clock: () => number;
  private userSpeechEndedAt: number | null = null;
  private sessionVoiceSeconds = 0;

  constructor(
    getContext: () => VoiceReceiptContext,
    onChange: (receipts: VoiceTurnReceipt[]) => void = () => {},
    now: () => Date = () => new Date(),
    clock: () => number = () => performance.now()
  ) {
    this.getContext = getContext;
    this.onChange = onChange;
    this.now = now;
    this.clock = clock;
  }

  reset(receipts: VoiceTurnReceipt[] = []) {
    this.userSpeechEndedAt = null;
    this.sessionVoiceSeconds = 0;
    this.receipts = receipts.map((receipt) => ({ ...receipt }));
    this.emit();
  }

  snapshot(): VoiceTurnReceipt[] {
    return this.receipts.map((receipt) => ({ ...receipt }));
  }

  userTurn(query: string) {
    const text = query.trim();
    if (!text) return;
    const open = this.openReceipt();
    const last = this.receipts[this.receipts.length - 1];
    if (open && !open.query) {
      open.query = text;
    } else if (!open && last && !last.query) {
      // Input transcription can finish after the agent already spoke; label that turn.
      last.query = text;
    } else {
      if (open) open.closed = true;
      this.receipts.push(this.create(text));
    }
    this.emit();
  }

  route(route: VoiceTurnRoute, fallbackFrom?: VoiceTurnRoute) {
    const receipt = this.current();
    const { reasonCode, reason } = voicePolicyReason(receipt.policyMode, route, fallbackFrom);
    Object.assign(receipt, { route, reasonCode, reason });
    this.emit();
  }

  retrieval(stage: VoiceStageReceipt, query?: string | null) {
    const receipt = this.current();
    if (!receipt.query && query) receipt.query = query;
    receipt.retrieval = stage;
    if (receipt.route === 'voice') this.route('rag');
    else this.emit();
  }

  adapter(stage: VoiceStageReceipt, query?: string | null) {
    const receipt = this.current();
    if (!receipt.query && query) receipt.query = query;
    receipt.adapter = stage;
    if (receipt.route !== 'adapter') this.route('adapter');
    else this.emit();
  }

  responseUsage(usage: RealtimeUsage | null | undefined) {
    if (!usage) return;
    const receipt = this.current();
    const input = usage.input_token_details || {};
    const output = usage.output_token_details || {};
    const cost = estimateRealtimeResponseCost(receipt.voiceModel, usage);
    const prior = receipt.voiceUsage;
    receipt.voiceUsage = {
      ...prior,
      responses: prior.responses + 1,
      inputTextTokens: prior.inputTextTokens + count(input.text_tokens ?? (input.audio_tokens == null ? usage.input_tokens : 0)),
      inputAudioTokens: prior.inputAudioTokens + count(input.audio_tokens),
      cachedInputTokens: prior.cachedInputTokens + count(input.cached_tokens),
      outputTextTokens: prior.outputTextTokens + count(output.text_tokens ?? (output.audio_tokens == null ? usage.output_tokens : 0)),
      outputAudioTokens: prior.outputAudioTokens + count(output.audio_tokens),
      costUsd: cost == null ? prior.costUsd : (prior.costUsd ?? 0) + cost
    };
    this.emit();
  }

  /** Provider-event fallback for first-audio timing: the caller stopped speaking. */
  userSpeechStarted() {
    this.userSpeechEndedAt = null;
  }

  userSpeechEnded() {
    this.userSpeechEndedAt = this.clock();
  }

  /** The agent began speaking; measures first audio from the last end of caller speech. */
  agentAudioStarted() {
    if (this.userSpeechEndedAt == null) return;
    const elapsed = Math.max(0, Math.round(this.clock() - this.userSpeechEndedAt));
    this.userSpeechEndedAt = null;
    const receipt = this.current();
    if (receipt.firstAudioMs == null) receipt.firstAudioMs = elapsed;
    this.emit();
  }

  /** Cumulative session seconds reported by duration-billed voice models. */
  voiceDuration(cumulativeSeconds: number | null | undefined) {
    if (!Number.isFinite(cumulativeSeconds)) return;
    const delta = Math.max(0, Number(cumulativeSeconds) - this.sessionVoiceSeconds);
    this.sessionVoiceSeconds = Math.max(this.sessionVoiceSeconds, Number(cumulativeSeconds));
    if (!delta) return;
    const receipt = this.current();
    const durationSeconds = (receipt.voiceUsage.durationSeconds ?? 0) + delta;
    const durationCost = estimateVoiceDurationCost(receipt.voiceModel, delta);
    receipt.voiceUsage = {
      ...receipt.voiceUsage,
      durationSeconds,
      costUsd: durationCost == null ? receipt.voiceUsage.costUsd : (receipt.voiceUsage.costUsd ?? 0) + durationCost
    };
    this.emit();
  }

  audioTurnCompleted(metric: { firstAudioMs: number | null; toolCallMs: number | null }) {
    const receipt = this.openReceipt();
    if (!receipt) return;
    // The audio-level measurement is preferred, but a missed detection must not erase event timing.
    receipt.firstAudioMs = metric.firstAudioMs ?? receipt.firstAudioMs;
    receipt.toolCallMs = metric.toolCallMs ?? receipt.toolCallMs;
    receipt.closed = true;
    this.emit();
  }

  private openReceipt(): VoiceTurnReceipt | null {
    const last = this.receipts[this.receipts.length - 1];
    return last && !last.closed ? last : null;
  }

  private current(): VoiceTurnReceipt {
    const open = this.openReceipt();
    if (open) return open;
    const receipt = this.create(null);
    this.receipts.push(receipt);
    return receipt;
  }

  private create(query: string | null): VoiceTurnReceipt {
    const context = this.getContext();
    return {
      turnId: crypto.randomUUID(),
      startedAt: this.now().toISOString(),
      query,
      policyMode: context.policyMode,
      ...voicePolicyReason(context.policyMode, 'voice'),
      route: 'voice',
      voiceModel: context.voiceModel,
      checkpoint: context.checkpoint,
      retrieval: null,
      adapter: null,
      voiceUsage: { responses: 0, inputTextTokens: 0, inputAudioTokens: 0, cachedInputTokens: 0, outputTextTokens: 0, outputAudioTokens: 0, durationSeconds: 0, costUsd: null },
      firstAudioMs: null,
      toolCallMs: null,
      closed: false
    };
  }

  private emit() {
    this.onChange(this.snapshot());
  }
}

export function voiceReceiptCost(receipt: VoiceTurnReceipt) {
  const retrieval = receipt.retrieval?.costUsd ?? 0;
  const adapter = receipt.adapter?.costUsd ?? 0;
  const voice = receipt.voiceUsage.costUsd ?? 0;
  const unpriced = [
    receipt.retrieval && receipt.retrieval.costUsd == null,
    receipt.adapter && receipt.adapter.costUsd == null,
    (receipt.voiceUsage.responses > 0 || (receipt.voiceUsage.durationSeconds ?? 0) > 0) && receipt.voiceUsage.costUsd == null
  ].filter(Boolean).length;
  const estimated = [receipt.retrieval, receipt.adapter].some((stage) => stage?.costKind === 'estimated') || receipt.voiceUsage.costUsd != null;
  return { total: retrieval + adapter + voice, retrieval, adapter, voice, unpriced, estimated };
}

/** Splits the caller-perceived wait into retrieval, adapter generation, and voice model/network time. */
export function voiceReceiptLatency(receipt: VoiceTurnReceipt) {
  const retrieval = receipt.retrieval?.latencyMs ?? 0;
  const adapter = receipt.adapter?.latencyMs ?? 0;
  const total = receipt.firstAudioMs;
  return {
    measured: total != null,
    total: total ?? retrieval + adapter,
    retrieval,
    adapter,
    voice: total != null ? Math.max(0, total - retrieval - adapter) : 0
  };
}

export function voiceWorkflowFingerprint(queries: string[]): string {
  const normalized = queries
    .map((query) => query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('␞');
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return normalized ? `voice-${(hash >>> 0).toString(16)}` : '';
}

export function summarizeVoiceReceipts(receipts: VoiceTurnReceipt[]) {
  const costs = receipts.map(voiceReceiptCost);
  const latencies = receipts.map(voiceReceiptLatency);
  const measured = latencies.filter((latency) => latency.measured);
  const retrievalTurns = receipts.filter((receipt) => receipt.retrieval);
  const adapterTurns = receipts.filter((receipt) => receipt.adapter);
  const routes = receipts.reduce<Record<VoiceTurnRoute, number>>((mix, receipt) => {
    mix[receipt.route] += 1;
    return mix;
  }, { voice: 0, rag: 0, adapter: 0 });
  const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
  return {
    turns: receipts.length,
    costUsd: costs.reduce((sum, cost) => sum + cost.total, 0),
    voiceCostUsd: costs.reduce((sum, cost) => sum + cost.voice, 0),
    retrievalCostUsd: costs.reduce((sum, cost) => sum + cost.retrieval, 0),
    adapterCostUsd: costs.reduce((sum, cost) => sum + cost.adapter, 0),
    unpricedStages: costs.reduce((sum, cost) => sum + cost.unpriced, 0),
    avgFirstAudioMs: average(measured.map((latency) => latency.total)),
    measuredTurns: measured.length,
    avgRetrievalLatencyMs: average(retrievalTurns.map((receipt) => receipt.retrieval!.latencyMs)),
    avgAdapterLatencyMs: average(adapterTurns.map((receipt) => receipt.adapter!.latencyMs)),
    routes,
    workflowKey: voiceWorkflowFingerprint(receipts.map((receipt) => receipt.query || ''))
  };
}
