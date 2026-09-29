import type { TranscriptTurn } from '../../../../shared/voice-eval/caller/brain-prompt.ts';

export interface CallerSource {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface MicLike {
  readonly track: MediaStreamTrack;
  /** Plays one utterance; resolves with performance.now() times, also when stopPlayback() cuts it short. */
  play(samples: Float32Array): Promise<{ startedAt: number; endedAt: number }>;
  stopPlayback(): void;
  close(): Promise<void>;
}

export interface RenderedLine { beatIndex: number; text: string; audioB64: string }
export interface NextTurnResult { action: 'say' | 'hang_up'; text: string; audioB64: string | null }

export interface CallerApi {
  renderBeats(runId: string): Promise<RenderedLine[]>;
  nextTurn(input: { runId: string; transcript: TranscriptTurn[]; beatsFired: number[] }): Promise<NextTurnResult>;
}

/** The eval run is no longer running (it is being scored or was aborted); the caller should stop quietly. */
export class CallerRunClosedError extends Error {}
