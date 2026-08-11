import type { AgentState } from './realtime-client';

export type VoiceTurnMetric = {
  turn: number;
  capturedAt: string;
  firstAudioMs: number | null;
  deadAirMs: number | null;
  bargeInMs: number | null;
  toolCallMs: number | null;
  speechRateWpm: number | null;
  raw: {
    userSpeechStart: number | null;
    userSpeechEnd: number | null;
    agentAudioFirst: number | null;
    agentAudioLast: number | null;
    toolDispatch: number | null;
    toolReturn: number | null;
  };
};

export type VoiceMetricsSnapshot = {
  turns: VoiceTurnMetric[];
  liveFirstAudioMs: number | null;
  liveDeadAirMs: number | null;
  inputLevels: number[];
  bargeInFlash: number;
};

type ActiveTurn = {
  userSpeechStart: number | null;
  userSpeechEnd: number | null;
  agentAudioFirst: number | null;
  agentAudioLast: number | null;
  silenceStarted: number | null;
  maxDeadAirMs: number;
  bargeInStart: number | null;
  bargeInSawSilence: boolean;
  bargeInMs: number | null;
  toolDispatch: number | null;
  toolReturn: number | null;
  toolCallMs: number | null;
  assistantTranscript: string;
  responseDone: boolean;
};

const INPUT_START_THRESHOLD = 0.025;
const INPUT_STOP_THRESHOLD = 0.015;
const OUTPUT_SPEECH_THRESHOLD = 0.012;
const INPUT_START_SAMPLES = 3;
const INPUT_STOP_SAMPLES = 10;
const TURN_END_SILENCE_MS = 280;
const INPUT_HISTORY_SAMPLES = 250;

const emptyTurn = (): ActiveTurn => ({
  userSpeechStart: null,
  userSpeechEnd: null,
  agentAudioFirst: null,
  agentAudioLast: null,
  silenceStarted: null,
  maxDeadAirMs: 0,
  bargeInStart: null,
  bargeInSawSilence: false,
  bargeInMs: null,
  toolDispatch: null,
  toolReturn: null,
  toolCallMs: null,
  assistantTranscript: '',
  responseDone: false
});

export class VoiceMetricsCollector {
  private active = emptyTurn();
  private turns: VoiceTurnMetric[] = [];
  private inputLevels: number[] = [];
  private inputAbove = 0;
  private inputBelow = 0;
  private userSpeaking = false;
  private outputSpeaking = false;
  private toolStarts = new Map<string, number>();
  private lastEmitAt = 0;
  private bargeInFlash = 0;

  constructor(
    private readonly onUpdate: (snapshot: VoiceMetricsSnapshot) => void,
    private readonly onTurnComplete: (turn: VoiceTurnMetric, turns: VoiceTurnMetric[]) => void
  ) {}

  reset(): void {
    this.active = emptyTurn();
    this.turns = [];
    this.inputLevels = [];
    this.inputAbove = 0;
    this.inputBelow = 0;
    this.userSpeaking = false;
    this.outputSpeaking = false;
    this.toolStarts.clear();
    this.bargeInFlash = 0;
    this.emit(true);
  }

  sample(inputLevel: number, outputLevel: number, micLive: boolean, agentState: AgentState): void {
    const now = performance.now();
    const normalizedInput = Number.isFinite(inputLevel) ? Math.max(0, Math.min(1, inputLevel)) : 0;
    this.inputLevels.push(normalizedInput);
    if (this.inputLevels.length > INPUT_HISTORY_SAMPLES) this.inputLevels.shift();

    if (micLive) this.trackLocalVad(normalizedInput, now, agentState);
    else {
      this.inputAbove = 0;
      this.inputBelow = 0;
      this.userSpeaking = false;
    }

    const hasOutput = outputLevel >= OUTPUT_SPEECH_THRESHOLD;
    if (this.active.bargeInStart !== null && !this.active.bargeInSawSilence) {
      if (!hasOutput) {
        this.active.bargeInSawSilence = true;
        this.outputSpeaking = false;
      }
      this.emit(now - this.lastEmitAt >= 80);
      return;
    }
    if (hasOutput) {
      if (!this.active.agentAudioFirst) {
        this.active.agentAudioFirst = now;
        if (this.active.bargeInStart !== null) {
          this.active.bargeInMs = Math.max(0, now - this.active.bargeInStart);
          this.bargeInFlash += 1;
        }
      }
      if (this.active.silenceStarted !== null && this.active.agentAudioLast !== null) {
        this.active.maxDeadAirMs = Math.max(this.active.maxDeadAirMs, now - this.active.silenceStarted);
      }
      this.active.silenceStarted = null;
      this.active.agentAudioLast = now;
      this.outputSpeaking = true;
    } else if (this.outputSpeaking && this.active.agentAudioFirst !== null) {
      this.outputSpeaking = false;
      this.active.silenceStarted = now;
    }

    if (
      this.active.responseDone &&
      this.active.agentAudioFirst !== null &&
      this.active.silenceStarted !== null &&
      now - this.active.silenceStarted >= TURN_END_SILENCE_MS
    ) {
      this.completeTurn();
      return;
    }
    this.emit(now - this.lastEmitAt >= 80);
  }

  setAssistantTranscript(transcript: string): void {
    if (transcript.trim()) this.active.assistantTranscript = transcript.trim();
  }

  markResponseDone(): void {
    this.active.responseDone = true;
    if (this.active.agentAudioFirst === null) return;
    if (!this.outputSpeaking) this.completeTurn();
  }

  toolDispatched(id: string): void {
    const now = performance.now();
    this.toolStarts.set(id, now);
    this.active.toolDispatch = now;
  }

  toolReturned(id: string): void {
    const now = performance.now();
    const started = this.toolStarts.get(id);
    this.toolStarts.delete(id);
    if (started === undefined) return;
    this.active.toolDispatch = started;
    this.active.toolReturn = now;
    this.active.toolCallMs = Math.max(0, now - started);
    this.emit(true);
  }

  private trackLocalVad(level: number, now: number, agentState: AgentState): void {
    if (!this.userSpeaking) {
      this.inputAbove = level >= INPUT_START_THRESHOLD ? this.inputAbove + 1 : 0;
      if (this.inputAbove >= INPUT_START_SAMPLES) {
        this.userSpeaking = true;
        this.inputBelow = 0;
        const speechStart = now - (INPUT_START_SAMPLES - 1) * 40;
        if (this.active.agentAudioFirst !== null && !this.active.responseDone) {
          this.completeTurn();
        }
        this.active.userSpeechStart = speechStart;
        if (this.outputSpeaking || agentState === 'speaking') {
          this.active.bargeInStart = speechStart;
          this.active.bargeInSawSilence = false;
        }
      }
      return;
    }

    this.inputBelow = level <= INPUT_STOP_THRESHOLD ? this.inputBelow + 1 : 0;
    if (this.inputBelow >= INPUT_STOP_SAMPLES) {
      this.userSpeaking = false;
      this.inputAbove = 0;
      this.active.userSpeechEnd = now - (INPUT_STOP_SAMPLES - 1) * 40;
      this.active.responseDone = false;
      this.emit(true);
    }
  }

  private completeTurn(): void {
    const active = this.active;
    if (active.userSpeechStart === null && active.agentAudioFirst === null && active.toolCallMs === null) {
      this.active = emptyTurn();
      return;
    }
    const audioDurationMs =
      active.agentAudioFirst !== null && active.agentAudioLast !== null
        ? Math.max(0, active.agentAudioLast - active.agentAudioFirst)
        : 0;
    const wordCount = active.assistantTranscript.match(/\b[\p{L}\p{N}'’-]+\b/gu)?.length || 0;
    const metric: VoiceTurnMetric = {
      turn: this.turns.length + 1,
      capturedAt: new Date().toISOString(),
      firstAudioMs:
        active.userSpeechEnd !== null && active.agentAudioFirst !== null
          ? Math.max(0, active.agentAudioFirst - active.userSpeechEnd)
          : null,
      deadAirMs: active.agentAudioFirst !== null ? active.maxDeadAirMs : null,
      bargeInMs: active.bargeInMs,
      toolCallMs: active.toolCallMs,
      speechRateWpm:
        wordCount > 0 && audioDurationMs > 0
          ? Math.round((wordCount / audioDurationMs) * 60_000)
          : null,
      raw: {
        userSpeechStart: active.userSpeechStart,
        userSpeechEnd: active.userSpeechEnd,
        agentAudioFirst: active.agentAudioFirst,
        agentAudioLast: active.agentAudioLast,
        toolDispatch: active.toolDispatch,
        toolReturn: active.toolReturn
      }
    };
    this.turns = [...this.turns, metric];
    this.active = emptyTurn();
    this.onTurnComplete(metric, this.turns);
    this.emit(true);
  }

  private emit(force: boolean): void {
    if (!force) return;
    const now = performance.now();
    this.lastEmitAt = now;
    const liveFirstAudioMs =
      this.active.userSpeechEnd !== null && this.active.agentAudioFirst === null
        ? Math.max(0, now - this.active.userSpeechEnd)
        : null;
    const liveDeadAirMs =
      this.active.agentAudioFirst !== null && this.active.silenceStarted !== null
        ? Math.max(0, now - this.active.silenceStarted)
        : null;
    this.onUpdate({
      turns: this.turns,
      liveFirstAudioMs,
      liveDeadAirMs,
      inputLevels: [...this.inputLevels],
      bargeInFlash: this.bargeInFlash
    });
  }
}

export const EMPTY_VOICE_METRICS: VoiceMetricsSnapshot = {
  turns: [],
  liveFirstAudioMs: null,
  liveDeadAirMs: null,
  inputLevels: [],
  bargeInFlash: 0
};
