import { percentile } from '../stats.ts';
import type { EvidenceEvent, LatencyResult, LatencyThresholds } from '../types.ts';

export const DEFAULT_LATENCY_THRESHOLDS: LatencyThresholds = { p95PassMs: 1000, p95WarnMs: 1500 };

interface Sample { ms: number; tool: boolean }
type Utterance = Extract<EvidenceEvent, { kind: 'caller_utterance' }>;

// Synthetic runs know exactly when the caller stopped talking: measure to the agent's next audio start.
function utteranceSamples(events: EvidenceEvent[]): Sample[] | null {
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  const utterances = sorted.filter((e): e is Utterance => e.kind === 'caller_utterance');
  if (!utterances.length) return null;
  return utterances.flatMap((utterance, index) => {
    const end = utterance.atMs + utterance.durationMs;
    const nextStart = utterances[index + 1]?.atMs ?? Number.POSITIVE_INFINITY;
    const reply = sorted.find((e) => e.kind === 'agent_audio_start' && e.atMs >= end && e.atMs < nextStart);
    if (!reply) return [];
    const tool = sorted.some((e) => e.kind === 'tool_call' && e.atMs >= end && e.atMs < nextStart);
    return [{ ms: reply.atMs - end, tool }];
  });
}

function metricSamples(events: EvidenceEvent[]): Sample[] {
  return events.flatMap((event) =>
    event.kind === 'turn_metric' && event.firstAudioMs !== null && event.firstAudioMs >= 0
      ? [{ ms: event.firstAudioMs, tool: event.toolCallMs !== null }]
      : []
  );
}

export function scoreLatency(events: EvidenceEvent[], thresholds: LatencyThresholds = DEFAULT_LATENCY_THRESHOLDS): LatencyResult {
  const samples = utteranceSamples(events) ?? metricSamples(events);
  const values = samples.map((sample) => sample.ms);
  if (!values.length) {
    return { status: 'no_data', p50Ms: null, p95Ms: null, maxMs: null, turnCount: 0, toolTurnP95Ms: null };
  }
  const p95 = percentile(values, 0.95) as number;
  return {
    status: p95 <= thresholds.p95PassMs ? 'pass' : p95 <= thresholds.p95WarnMs ? 'warn' : 'fail',
    p50Ms: percentile(values, 0.5),
    p95Ms: p95,
    maxMs: Math.max(...values),
    turnCount: values.length,
    toolTurnP95Ms: percentile(samples.filter((sample) => sample.tool).map((sample) => sample.ms), 0.95)
  };
}
