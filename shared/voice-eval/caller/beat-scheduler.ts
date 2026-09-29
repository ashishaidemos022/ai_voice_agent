import { HEALTHCARE_TOOL_NAME } from '../../healthcare-demo.ts';
import type { VoiceEvalSignal } from '../evidence.ts';
import type { Beat } from '../types.ts';

export type CallerAction =
  | { kind: 'beat'; beatIndex: number; beat: Beat }
  | { kind: 'silence'; beatIndex: number; durationMs: number }
  | { kind: 'brain' };

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined;
}

/** Errors and unverified replies (200 with verification.verified === false) are not successes. */
function hasError(result: unknown): boolean {
  const error = field(result, 'error');
  if (error !== undefined && error !== null && error !== false) return true;
  return field(field(result, 'verification'), 'verified') === false || field(field(result, 'action'), 'status') === 'verification_required';
}

/** Decides, per caller turn, whether a scripted beat overrides the brain; owns barge-in timing. */
export class BeatScheduler {
  private turnsTaken = 0;
  private readonly fired = new Set<number>();
  private readonly anchorsMet = new Set<string>();
  private readonly toolActions = new Map<string, string>();
  private bargeDue: { beatIndex: number; at: number } | null = null;
  private readonly beats: Beat[];

  constructor(beats: Beat[]) {
    this.beats = beats;
  }

  observe(signal: VoiceEvalSignal): void {
    if (signal.kind === 'tool_call' && signal.name === HEALTHCARE_TOOL_NAME) {
      this.toolActions.set(signal.callId, String(signal.args.action ?? ''));
    } else if (signal.kind === 'tool_result' && signal.ok && !hasError(signal.result)) {
      const action = this.toolActions.get(signal.callId);
      if (action) this.anchorsMet.add(action);
    } else if (signal.kind === 'agent_audio_start') {
      const index = this.armedBargeIn();
      if (index !== null) this.bargeDue = { beatIndex: index, at: signal.at + (this.beats[index].afterAgentSpeechMs ?? 0) };
    } else if (signal.kind === 'agent_audio_stop') {
      this.bargeDue = null;
    }
  }

  pollBargeIn(now: number): { beatIndex: number; beat: Beat } | null {
    if (!this.bargeDue || now < this.bargeDue.at) return null;
    const { beatIndex } = this.bargeDue;
    this.bargeDue = null;
    this.fired.add(beatIndex);
    return { beatIndex, beat: this.beats[beatIndex] };
  }

  nextTurnAction(): CallerAction {
    const index = this.beats.findIndex((beat, i) =>
      beat.kind !== 'barge_in' && !this.fired.has(i) && this.turnsTaken >= (beat.afterTurn ?? 0) && this.anchorMet(beat)
    );
    this.turnsTaken += 1;
    if (index === -1) return { kind: 'brain' };
    this.fired.add(index);
    const beat = this.beats[index];
    return beat.kind === 'silence'
      ? { kind: 'silence', beatIndex: index, durationMs: beat.durationMs ?? 0 }
      : { kind: 'beat', beatIndex: index, beat };
  }

  /** Facts the brain must not see yet: the corrected value of a correction that has not fired. */
  hiddenFacts(): string[] {
    return this.beats.flatMap((beat, i) => (beat.kind === 'correction' && beat.correctedFact && !this.fired.has(i) ? [beat.correctedFact] : []));
  }

  firedBeats(): number[] {
    return [...this.fired].sort((a, b) => a - b);
  }

  private anchorMet(beat: Beat): boolean {
    return !beat.anchor || this.anchorsMet.has(beat.anchor.afterTool);
  }

  private armedBargeIn(): number | null {
    const index = this.beats.findIndex((beat, i) => beat.kind === 'barge_in' && !this.fired.has(i) && this.anchorMet(beat));
    return index === -1 ? null : index;
  }
}
