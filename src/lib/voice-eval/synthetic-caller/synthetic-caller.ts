import { BeatScheduler } from '../../../../shared/voice-eval/caller/beat-scheduler.ts';
import type { TranscriptTurn } from '../../../../shared/voice-eval/caller/brain-prompt.ts';
import { seededRandom } from '../../../../shared/voice-eval/caller/random.ts';
import { TurnDetector } from '../../../../shared/voice-eval/caller/turn-detector.ts';
import type { VoiceEvalSignal } from '../../../../shared/voice-eval/evidence.ts';
import type { Beat, BeatKind, Scenario } from '../../../../shared/voice-eval/types.ts';
import type { VoiceAdapter } from '../../voice-adapters/types';
import { decodePcm16Base64 } from './pcm.ts';
import { CallerRunClosedError, type CallerApi, type CallerSource, type MicLike, type NextTurnResult } from './types.ts';

export type CallerStatus = 'starting' | 'waiting' | 'thinking' | 'speaking' | 'silent' | 'hanging_up' | 'stopped';

export const CALLER_LIMITS = {
  maxCallMs: 240_000,
  maxTurns: 30,
  hangUpDelayMs: 1500,
  retryDelayMs: 500,
  quietVolume: 0.02,
  quietHoldMs: 300,
  maxGuardMs: 8000,
  guardPollMs: 50,
  tickMs: 50
};

export interface SyntheticCallerDeps {
  runId: string;
  scenario: Scenario;
  adapter: Pick<VoiceAdapter, 'attachSyntheticInput' | 'detachSyntheticInput' | 'getOutputVolume'>;
  api: CallerApi;
  createMic: (noise: Scenario['persona']['noise'], seed: string) => Promise<MicLike>;
  subscribe: (listener: (signal: VoiceEvalSignal) => void) => () => void;
  publish: (signal: VoiceEvalSignal) => void;
  hangUp: () => void;
  onStatus?: (status: CallerStatus) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  startTicker?: (tick: () => void) => () => void;
  limits?: Partial<typeof CALLER_LIMITS>;
}

const defaultTicker = (tick: () => void) => {
  const id = window.setInterval(tick, CALLER_LIMITS.tickMs);
  return () => window.clearInterval(id);
};

export class SyntheticCaller implements CallerSource {
  private readonly limits: typeof CALLER_LIMITS;
  private readonly scheduler: BeatScheduler;
  private readonly beatAudio = new Map<number, Float32Array>();
  private readonly transcript: TranscriptTurn[] = [];
  private detector: TurnDetector | null = null;
  private mic: MicLike | null = null;
  private attached = false;
  private stopped = false;
  private finishing = false;
  private busy = false;
  private turnsTaken = 0;
  private startedAt = 0;
  private silenceUntil: number | null = null;
  private unsubscribe: () => void = () => undefined;
  private stopTicker: () => void = () => undefined;

  private readonly deps: SyntheticCallerDeps;

  constructor(deps: SyntheticCallerDeps) {
    this.deps = deps;
    this.limits = { ...CALLER_LIMITS, ...deps.limits };
    this.scheduler = new BeatScheduler(deps.scenario.beats);
  }

  /** Resolves quietly, with nothing left attached, when stop() lands while it is still starting. */
  async start(): Promise<void> {
    this.setStatus('starting');
    try {
      const lines = await this.deps.api.renderBeats(this.deps.runId);
      if (this.stopped) return;
      for (const line of lines) this.beatAudio.set(line.beatIndex, decodePcm16Base64(line.audioB64));
      this.mic = await this.deps.createMic(this.deps.scenario.persona.noise, this.deps.runId);
      if (this.stopped) {
        await this.release();
        return;
      }
      if (!this.deps.adapter.attachSyntheticInput) throw new Error('This voice provider does not support the synthetic caller');
      await this.deps.adapter.attachSyntheticInput(this.mic.track);
      this.attached = true;
      if (this.stopped) {
        await this.release();
        return;
      }
    } catch (error) {
      this.stopped = true;
      await this.release();
      throw error;
    }
    const random = seededRandom(this.deps.runId);
    this.startedAt = this.now();
    this.detector = new TurnDetector({ startedAt: this.startedAt, gapMs: () => 600 + Math.round(random() * 300) });
    this.unsubscribe = this.deps.subscribe((signal) => this.onSignal(signal));
    this.stopTicker = (this.deps.startTicker ?? defaultTicker)(() => this.tick());
    this.setStatus('waiting');
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.setStatus('stopped');
    await this.release();
  }

  tick(): void {
    if (this.stopped || this.finishing || !this.detector) return;
    const now = this.now();
    if (now - this.startedAt >= this.limits.maxCallMs) {
      void this.finish();
      return;
    }
    if (this.busy) return;
    const barge = this.scheduler.pollBargeIn(now);
    if (barge) {
      void this.runTurn(() => this.speakBeat(barge.beatIndex, barge.beat, false));
      return;
    }
    if (this.silenceUntil !== null) {
      if (now < this.silenceUntil) return;
      this.silenceUntil = null;
    }
    if (!this.detector.poll(now)) return;
    if (this.turnsTaken >= this.limits.maxTurns) {
      void this.finish();
      return;
    }
    void this.runTurn(() => this.takeTurn());
  }

  private onSignal(signal: VoiceEvalSignal): void {
    this.detector?.observe(signal);
    this.scheduler.observe(signal);
    if (signal.kind === 'agent_transcript' && signal.text.trim()) this.transcript.push({ role: 'agent', text: signal.text.trim() });
  }

  private async runTurn(turn: () => Promise<void>): Promise<void> {
    this.busy = true;
    try {
      await turn();
    } catch (error) {
      await this.harnessFailure(error);
    } finally {
      this.busy = false;
    }
  }

  private async takeTurn(): Promise<void> {
    this.turnsTaken += 1;
    const action = this.scheduler.nextTurnAction();
    if (action.kind === 'silence') {
      this.publishBeat(action.beatIndex, 'silence');
      this.silenceUntil = this.now() + action.durationMs;
      this.setStatus('silent');
      return;
    }
    if (action.kind === 'beat') {
      await this.speakBeat(action.beatIndex, action.beat, true);
      return;
    }
    await this.brainTurn();
  }

  private async speakBeat(beatIndex: number, beat: Beat, guard: boolean): Promise<void> {
    const audio = this.beatAudio.get(beatIndex);
    if (!audio || !beat.line) throw new Error(`Beat ${beatIndex} has no pre-rendered audio`);
    this.publishBeat(beatIndex, beat.kind);
    await this.speak(audio, beat.line, 'beat', beatIndex, guard);
  }

  private async brainTurn(): Promise<void> {
    this.setStatus('thinking');
    const result = await this.nextTurnWithRetry();
    if (!result || this.stopped) return;
    if (result.action === 'hang_up') {
      if (result.text && result.audioB64) await this.speak(decodePcm16Base64(result.audioB64), result.text, 'brain', null, true, true);
      await this.finish();
      return;
    }
    if (!result.audioB64) throw new Error('Caller brain returned a line without audio');
    await this.speak(decodePcm16Base64(result.audioB64), result.text, 'brain', null, true);
  }

  private async nextTurnWithRetry(): Promise<NextTurnResult | null> {
    const input = { runId: this.deps.runId, transcript: [...this.transcript], beatsFired: this.scheduler.firedBeats() };
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.deps.api.nextTurn(input);
      } catch (error) {
        if (error instanceof CallerRunClosedError) {
          await this.stop();
          return null;
        }
        if (attempt >= 1) throw error;
        await this.sleep(this.limits.retryDelayMs);
        if (this.stopped) return null;
      }
    }
  }

  private async speak(
    samples: Float32Array,
    text: string,
    source: 'brain' | 'beat',
    beatIndex: number | null,
    guard: boolean,
    allowWhileFinishing = false
  ): Promise<void> {
    if (guard) await this.waitForAgentQuiet();
    const mic = this.mic;
    if (this.stopped || !mic || !this.detector) return;
    // Once the call is ending (cap or hang-up), only a hang-up farewell may still play.
    if (this.finishing && !allowWhileFinishing) return;
    // Once finishing, the only status left to report is 'stopped'.
    if (!this.finishing) this.setStatus('speaking');
    this.detector.callerStarted(this.now());
    const timing = await mic.play(samples);
    this.detector.callerEnded(timing.endedAt);
    if (this.stopped) return;
    this.transcript.push({ role: 'caller', text });
    this.deps.publish({
      kind: 'caller_utterance',
      at: timing.startedAt,
      durationMs: Math.max(0, Math.round(timing.endedAt - timing.startedAt)),
      text,
      source,
      beatIndex
    });
    if (!this.finishing) this.setStatus('waiting');
  }

  // The agent's "not speaking" event can precede the end of its audio; don't clip its last words.
  private async waitForAgentQuiet(): Promise<void> {
    const deadline = this.now() + this.limits.maxGuardMs;
    let quietSince: number | null = null;
    while (!this.stopped && this.now() < deadline) {
      const now = this.now();
      if ((this.deps.adapter.getOutputVolume?.() ?? 0) < this.limits.quietVolume) {
        quietSince ??= now;
        if (now - quietSince >= this.limits.quietHoldMs) return;
      } else {
        quietSince = null;
      }
      await this.sleep(this.limits.guardPollMs);
    }
  }

  private async harnessFailure(error: unknown): Promise<void> {
    // A call that is already ending normally is not a harness failure.
    if (this.stopped || this.finishing) return;
    const message = error instanceof Error ? error.message : String(error);
    this.deps.publish({ kind: 'harness_error', at: this.now(), message: `synthetic caller: ${message}` });
    await this.finish();
  }

  private async finish(): Promise<void> {
    if (this.finishing || this.stopped) return;
    this.finishing = true;
    this.setStatus('hanging_up');
    await this.sleep(this.limits.hangUpDelayMs);
    if (this.stopped) return;
    await this.stop();
    this.deps.hangUp();
  }

  private publishBeat(beatIndex: number, beatKind: BeatKind): void {
    this.deps.publish({ kind: 'beat', at: this.now(), beatIndex, beatKind });
  }

  private async release(): Promise<void> {
    this.unsubscribe();
    this.unsubscribe = () => undefined;
    this.stopTicker();
    this.stopTicker = () => undefined;
    this.mic?.stopPlayback();
    if (this.attached) {
      this.attached = false;
      try {
        await this.deps.adapter.detachSyntheticInput?.();
      } catch (error) {
        console.warn('[SyntheticCaller] detach failed', error);
      }
    }
    const mic = this.mic;
    this.mic = null;
    await mic?.close().catch(() => undefined);
  }

  private setStatus(status: CallerStatus): void {
    this.deps.onStatus?.(status);
  }

  private now(): number {
    return (this.deps.now ?? (() => performance.now()))();
  }

  private sleep(ms: number): Promise<void> {
    return (this.deps.sleep ?? ((delay: number) => new Promise<void>((resolve) => window.setTimeout(resolve, delay))))(ms);
  }
}
