import type { EvidenceEvent } from './types.ts';

type WithoutAt<T> = T extends unknown ? Omit<T, 'atMs'> : never;
/** An evidence event stamped with an absolute performance.now() time. */
export type VoiceEvalSignal = WithoutAt<EvidenceEvent> & { at: number };

export class EvidenceRecorder {
  private readonly startedAt: number;
  private list: EvidenceEvent[] = [];
  private flushed = 0;

  constructor(startedAt: number) {
    this.startedAt = startedAt;
  }

  record(signal: VoiceEvalSignal): EvidenceEvent {
    const { at, ...rest } = signal;
    const event = { ...rest, atMs: Math.max(0, Math.round(at - this.startedAt)) } as EvidenceEvent;
    this.list.push(event);
    return event;
  }

  events(): EvidenceEvent[] {
    return [...this.list];
  }

  takeUnflushed(): { fromSeq: number; events: EvidenceEvent[] } {
    const fromSeq = this.flushed;
    const events = this.list.slice(fromSeq);
    this.flushed = this.list.length;
    return { fromSeq, events };
  }

  markUnflushed(fromSeq: number): void {
    this.flushed = Math.min(this.flushed, fromSeq);
  }

  hasUnflushed(): boolean {
    return this.flushed < this.list.length;
  }
}

export interface ToolExecutionRow {
  id: string;
  tool_name: string;
  input_params: unknown;
  output_result: unknown;
  execution_time_ms: number | null;
  status: string;
  created_at: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Replaces client-observed tool events with the authoritative va_tool_executions log. */
export function mergeToolLog(events: EvidenceEvent[], rows: ToolExecutionRow[], runStartedAtIso: string): EvidenceEvent[] {
  if (!rows.length) return events;
  const base = Date.parse(runStartedAtIso);
  const others = events.filter((e) => e.kind !== 'tool_call' && e.kind !== 'tool_result');
  const derived: EvidenceEvent[] = [...rows]
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .flatMap((row) => {
      const endMs = Math.max(0, Date.parse(row.created_at) - base);
      const startMs = Math.max(0, endMs - (row.execution_time_ms ?? 0));
      return [
        { kind: 'tool_call', atMs: startMs, callId: row.id, name: row.tool_name, args: asRecord(row.input_params) },
        { kind: 'tool_result', atMs: endMs, callId: row.id, ok: row.status !== 'error', result: row.output_result }
      ] as EvidenceEvent[];
    });
  return [...others, ...derived].sort((a, b) => a.atMs - b.atMs);
}

export interface EvidenceRow {
  run_id: string;
  seq: number;
  at_ms: number;
  kind: string;
  payload: Record<string, unknown>;
}

export function toEvidenceRows(runId: string, fromSeq: number, events: EvidenceEvent[]): EvidenceRow[] {
  return events.map((event, index) => {
    const { kind, atMs, ...payload } = event;
    return { run_id: runId, seq: fromSeq + index, at_ms: atMs, kind, payload };
  });
}

export function fromEvidenceRow(row: { at_ms: number; kind: string; payload: unknown }): EvidenceEvent {
  return { ...asRecord(row.payload), kind: row.kind, atMs: row.at_ms } as EvidenceEvent;
}
