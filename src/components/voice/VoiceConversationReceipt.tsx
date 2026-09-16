import { useEffect, useMemo, useState } from 'react';
import { DollarSign, Gauge } from 'lucide-react';
import {
  summarizeVoiceReceipts,
  voiceReceiptCost,
  voiceReceiptLatency,
  type VoicePolicyMode,
  type VoiceReceiptCheckpoint,
  type VoiceTurnReceipt
} from '../../../shared/voice-receipts';
import { OPENAI_PRICING_EFFECTIVE_DATE } from '../../../shared/openai-models';
import { cn } from '../../lib/utils';

type SavedVoiceRun = {
  runId: string;
  workflowKey: string;
  policyLabel: string;
  costUsd: number;
  avgFirstAudioMs: number;
  turns: number;
  savedAt: string;
};

type Props = {
  receipts: VoiceTurnReceipt[];
  /** True once the call has ended; the run is then saved for matched comparisons. */
  final?: boolean;
  historical?: boolean;
};

const SAVED_RUNS_KEY = 'voice-policy-comparison-runs';

const formatCost = (value = 0) => (value < 0.01 ? `$${value.toFixed(5)}` : `$${value.toFixed(3)}`);
const formatLatency = (ms = 0) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);

function voicePolicyLabel(mode: VoicePolicyMode, checkpoint: VoiceReceiptCheckpoint | null): string {
  if (mode === 'rag') return 'RAG';
  if (mode === 'adapter') return `Adapter · ${checkpoint?.name || 'trained checkpoint'}`;
  return checkpoint ? `Automatic · ${checkpoint.name}` : 'Automatic';
}

const routeLabel = (receipt: VoiceTurnReceipt) => receipt.route === 'adapter'
  ? `Trained · ${receipt.checkpoint?.name || receipt.adapter?.model || 'adapter'}`
  : receipt.route === 'rag' ? 'Knowledge RAG' : 'Voice model';

function readSavedRuns(): SavedVoiceRun[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SAVED_RUNS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stageCost(stage: { costUsd: number | null; costKind: string } | null) {
  if (!stage) return '—';
  if (stage.costUsd == null) return 'Unavailable';
  return `${stage.costKind === 'estimated' ? '~' : ''}${formatCost(stage.costUsd)}`;
}

export function VoiceConversationReceipt({ receipts, final = false, historical = false }: Props) {
  const [savedRuns, setSavedRuns] = useState<SavedVoiceRun[]>(readSavedRuns);
  const summary = useMemo(() => summarizeVoiceReceipts(receipts), [receipts]);
  const latest = receipts[receipts.length - 1];
  const policyLabel = latest ? voicePolicyLabel(latest.policyMode, latest.checkpoint) : '';
  const runId = receipts[0]?.turnId || '';

  useEffect(() => {
    if (!final || historical || !runId || !summary.workflowKey) return;
    const run: SavedVoiceRun = {
      runId,
      workflowKey: summary.workflowKey,
      policyLabel,
      costUsd: summary.costUsd,
      avgFirstAudioMs: summary.avgFirstAudioMs,
      turns: summary.turns,
      savedAt: new Date().toISOString()
    };
    const next = [run, ...readSavedRuns().filter((saved) => saved.runId !== runId)].slice(0, 20);
    setSavedRuns(next);
    try {
      window.localStorage.setItem(SAVED_RUNS_KEY, JSON.stringify(next));
    } catch {
      // Comparison history is a convenience; the receipt still renders without it.
    }
  }, [final, historical, runId, summary.workflowKey, summary.costUsd, summary.avgFirstAudioMs, summary.turns, policyLabel]);

  const comparisonRun = useMemo(() => savedRuns
    .filter((run) => run.runId !== runId && run.workflowKey && run.workflowKey === summary.workflowKey && run.policyLabel !== policyLabel)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0], [policyLabel, runId, savedRuns, summary.workflowKey]);

  if (!receipts.length) {
    return historical ? <p className="text-xs text-white/45">No voice receipts were recorded for this session.</p> : null;
  }

  return (
    <div className="space-y-4 border-t border-white/10 pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/35">
          <Gauge className="h-3.5 w-3.5" /> Conversation receipt
        </span>
        <span className="flex items-center gap-2">
          <span className="rounded-full border border-amber-300/25 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-100">{policyLabel}</span>
          <DollarSign className="h-4 w-4 text-emerald-300" />
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-3 rounded-xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 p-3">
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">{final || historical ? 'Final call' : 'Current call'}</p>
          <p className="mt-1 text-2xl font-semibold text-white">{formatCost(summary.costUsd)}</p>
          <p className="mt-1 text-xs text-white/45">
            {summary.turns} {summary.turns === 1 ? 'turn' : 'turns'}
            {summary.measuredTurns > 0 && ` · avg ${formatLatency(summary.avgFirstAudioMs)} to first audio`}
            {summary.avgRetrievalLatencyMs > 0 && ` · retrieval avg ${formatLatency(summary.avgRetrievalLatencyMs)}`}
            {summary.avgAdapterLatencyMs > 0 && ` · adapter avg ${formatLatency(summary.avgAdapterLatencyMs)}`}
          </p>
          <p className="mt-1 text-[10px] text-white/35">
            Estimated voice model, retrieval, and adapter cost · hosted rates checked {OPENAI_PRICING_EFFECTIVE_DATE} · GPT-Live $0.05/min
            {summary.unpricedStages > 0 && ` · ${summary.unpricedStages} unpriced ${summary.unpricedStages === 1 ? 'stage' : 'stages'} excluded`}
          </p>
        </div>
        {([
          ['Voice model', summary.voiceCostUsd, 'audio + text tokens'],
          ['Knowledge retrieval', summary.retrievalCostUsd, 'model + file search'],
          ['Trained adapter', summary.adapterCostUsd, 'checkpoint tokens']
        ] as const).map(([label, value, note]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-[10px] uppercase tracking-[0.14em] text-white/40">{label}</p>
            <p className="mt-1 text-sm font-semibold text-white">{formatCost(value)}</p>
            <p className="mt-1 text-[10px] text-white/40">{note}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-white/40">Route mix</p>
        <div className="flex flex-wrap gap-1.5">
          {([['voice', 'Voice model'], ['rag', 'Knowledge RAG'], ['adapter', latest?.checkpoint ? `Trained · ${latest.checkpoint.name}` : 'Trained adapter']] as const)
            .filter(([route]) => summary.routes[route] > 0)
            .map(([route, label]) => (
              <span key={route} className="rounded-full border border-cyan-400/20 bg-cyan-500/5 px-2 py-1 text-[10px] text-cyan-100/80">
                {label} × {summary.routes[route]}
              </span>
            ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">Decision ledger</p>
          <span className="text-[10px] text-white/35">one route per spoken turn</span>
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {receipts.map((receipt, index) => {
            const cost = voiceReceiptCost(receipt);
            const latency = voiceReceiptLatency(receipt);
            return (
              <details key={receipt.turnId} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
                      receipt.route === 'adapter'
                        ? 'border-amber-300/40 bg-amber-500/10 text-amber-200'
                        : receipt.route === 'rag'
                          ? 'border-indigo-300/40 bg-indigo-500/10 text-indigo-200'
                          : 'border-emerald-300/30 bg-emerald-500/10 text-emerald-200'
                    )}>{index + 1}</span>
                    <div className="min-w-0">
                      <p className="truncate text-xs text-white/85">{routeLabel(receipt)}{!receipt.closed && ' · in progress'}</p>
                      <p className="truncate text-[10px] text-white/40">{receipt.query || 'Question not captured'}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-emerald-200">{cost.estimated ? '~' : ''}{formatCost(cost.total)}</p>
                    <p className="text-[10px] text-white/35" title="User speech end to first agent audio">{latency.measured || latency.total ? formatLatency(latency.total) : '—'}</p>
                  </div>
                </summary>
                <div className="mt-2 border-t border-white/10 pt-2 text-[11px] text-white/55">
                  <p>{receipt.reason}</p>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                    <span>Voice model</span><span className="break-all text-white/80">{receipt.voiceModel || 'Unknown'}</span>
                    {receipt.checkpoint && receipt.route === 'adapter' && <>
                      <span>Checkpoint</span><span className="break-all text-white/80">{receipt.checkpoint.id}</span>
                      <span>Base model</span><span className="break-all text-white/80">{receipt.adapter?.model || 'Unknown'}</span>
                      <span>Runtime</span><span className="capitalize text-white/80">{receipt.checkpoint.backend}</span>
                    </>}
                    <span>{latency.measured ? 'Time to first audio' : 'Measured stages'}</span><span className="text-white/80">{latency.measured || latency.total ? formatLatency(latency.total) : 'Not measured'}</span>
                    {latency.retrieval > 0 && <><span className="pl-3">Knowledge retrieval</span><span className="text-white/80">{formatLatency(latency.retrieval)}</span></>}
                    {latency.adapter > 0 && <><span className="pl-3">Adapter generation</span><span className="text-white/80">{formatLatency(latency.adapter)}</span></>}
                    {latency.measured && <><span className="pl-3">Voice model &amp; network</span><span className="text-white/80">{formatLatency(latency.voice)}</span></>}
                    <span>Voice model cost</span>
                    <span className="text-white/80">
                      {receipt.voiceUsage.costUsd != null
                        ? `~${formatCost(receipt.voiceUsage.costUsd)}`
                        : (receipt.voiceUsage.durationSeconds ?? 0) > 0
                          ? 'Duration billed · no rate for this model'
                          : receipt.voiceUsage.responses > 0 ? 'Unavailable' : 'No usage reported'}
                    </span>
                    {(receipt.voiceUsage.durationSeconds ?? 0) > 0 && <><span className="pl-3">Voice session time</span><span className="text-white/80">{Math.round(receipt.voiceUsage.durationSeconds)}s</span></>}
                    {receipt.voiceUsage.responses > 0 && <>
                      <span className="pl-3">Audio tokens</span><span className="text-white/80">{receipt.voiceUsage.inputAudioTokens} in / {receipt.voiceUsage.outputAudioTokens} out</span>
                      <span className="pl-3">Text tokens</span><span className="text-white/80">{receipt.voiceUsage.inputTextTokens} in / {receipt.voiceUsage.outputTextTokens} out</span>
                    </>}
                    {receipt.retrieval && <><span>Retrieval cost</span><span className="text-white/80">{stageCost(receipt.retrieval)}</span></>}
                    {receipt.adapter && <><span>Adapter cost</span><span className="text-white/80">{stageCost(receipt.adapter)}</span></>}
                    {receipt.toolCallMs != null && <><span>Tool call</span><span className="text-white/80">{formatLatency(receipt.toolCallMs)}</span></>}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </div>

      {comparisonRun && summary.turns === comparisonRun.turns && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3">
          <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-200/70">Actual matched conversation</p>
          <div className="mt-2 flex items-end justify-between">
            <div>
              <p className="text-xs text-white/50">Previous {comparisonRun.policyLabel} call</p>
              <p className="text-lg font-semibold text-white">{formatCost(comparisonRun.costUsd)}</p>
              <p className="text-[10px] text-white/40">avg {formatLatency(comparisonRun.avgFirstAudioMs)} to first audio</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-white/50">This {policyLabel} call</p>
              <p className="text-lg font-semibold text-emerald-200">{formatCost(summary.costUsd)}</p>
              <p className="text-[10px] text-white/40">avg {formatLatency(summary.avgFirstAudioMs)} to first audio</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/55">
            {summary.costUsd <= comparisonRun.costUsd ? 'Saved' : 'Cost'} {formatCost(Math.abs(comparisonRun.costUsd - summary.costUsd))}
            {comparisonRun.costUsd > 0 && ` (${Math.round(Math.abs(comparisonRun.costUsd - summary.costUsd) / comparisonRun.costUsd * 100)}%)`}
            {' · '}{Math.abs(Math.round(comparisonRun.avgFirstAudioMs - summary.avgFirstAudioMs))}ms {summary.avgFirstAudioMs <= comparisonRun.avgFirstAudioMs ? 'faster' : 'slower'} to first audio
          </p>
        </div>
      )}

      <p className="text-[10px] leading-4 text-white/30">
        Time to first audio runs from the end of the caller's speech to the agent's first audio. ~ marks a token-based estimate. Matched comparisons need the same spoken questions under a different policy.
      </p>
    </div>
  );
}
