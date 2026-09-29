import { percentile } from '../stats.ts';
import type { EvidenceEvent, LatencyResult, LatencyThresholds } from '../types.ts';

export const DEFAULT_LATENCY_THRESHOLDS: LatencyThresholds = { p95PassMs: 1000, p95WarnMs: 1500 };

export function scoreLatency(events: EvidenceEvent[], thresholds: LatencyThresholds = DEFAULT_LATENCY_THRESHOLDS): LatencyResult {
  const turns = events.flatMap((event) =>
    event.kind === 'turn_metric' && event.firstAudioMs !== null && event.firstAudioMs >= 0 ? [event] : []
  );
  const values = turns.map((turn) => turn.firstAudioMs as number);
  const toolValues = turns.filter((turn) => turn.toolCallMs !== null).map((turn) => turn.firstAudioMs as number);
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
    toolTurnP95Ms: percentile(toolValues, 0.95)
  };
}
