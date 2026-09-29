import type { VoiceEvalSignal } from '../evidence.ts';

export type TurnSignal = 'agent_turn_ended' | 'agent_quiet';

export interface TurnDetectorOptions {
  startedAt: number;
  /** Human reply gap, drawn once per agent turn. */
  gapMs: () => number;
  quietMs?: number;
  openingMs?: number;
  staleToolMs?: number;
}

/**
 * Decides when the synthetic caller may speak, from the same signals the scorer reads.
 * An agent turn has ended when the agent stopped speaking, no tool call is in flight,
 * and a human gap has passed with no new agent audio.
 */
export class TurnDetector {
  private agentSpeaking = false;
  private anyAgentActivity = false;
  private agentSpokeSinceCaller = false;
  private emitted = false;
  private callerSpeaking = false;
  private lastAgentActivity: number;
  private lastQuietAnchor: number;
  private currentGap: number;
  private readonly openTools = new Map<string, number>();
  private readonly options: TurnDetectorOptions;

  constructor(options: TurnDetectorOptions) {
    this.options = options;
    this.lastAgentActivity = options.startedAt;
    this.lastQuietAnchor = options.startedAt;
    this.currentGap = options.gapMs();
  }

  observe(signal: VoiceEvalSignal): void {
    switch (signal.kind) {
      case 'agent_audio_start':
        this.agentSpeaking = true;
        this.anyAgentActivity = true;
        this.agentSpokeSinceCaller = true;
        this.emitted = false;
        this.touch(signal.at);
        break;
      case 'agent_audio_stop':
        if (this.agentSpeaking) this.currentGap = this.options.gapMs();
        this.agentSpeaking = false;
        this.touch(signal.at);
        break;
      case 'tool_call':
        this.openTools.set(signal.callId, signal.at);
        this.anyAgentActivity = true;
        // Speech before a tool call ("one moment") is not the agent's answer.
        this.agentSpokeSinceCaller = this.agentSpeaking;
        this.emitted = false;
        this.touch(signal.at);
        break;
      case 'tool_result':
        this.openTools.delete(signal.callId);
        this.agentSpokeSinceCaller = this.agentSpeaking;
        this.emitted = false;
        this.touch(signal.at);
        break;
      default:
        break;
    }
  }

  callerStarted(_at: number): void {
    this.callerSpeaking = true;
  }

  callerEnded(at: number): void {
    this.callerSpeaking = false;
    // Agent audio that started and stopped under the caller is not a turn to answer.
    this.agentSpokeSinceCaller = this.agentSpeaking;
    this.emitted = false;
    this.lastQuietAnchor = Math.max(this.lastQuietAnchor, at);
  }

  poll(now: number): TurnSignal | null {
    if (this.callerSpeaking || this.agentSpeaking || this.toolsInFlight(now)) return null;
    if (this.agentSpokeSinceCaller && !this.emitted && now - this.lastAgentActivity >= this.currentGap) {
      this.emitted = true;
      this.lastQuietAnchor = now;
      return 'agent_turn_ended';
    }
    const quietMs = this.anyAgentActivity ? this.options.quietMs ?? 10000 : this.options.openingMs ?? 4000;
    if (now - Math.max(this.lastAgentActivity, this.lastQuietAnchor) >= quietMs) {
      this.lastQuietAnchor = now;
      return 'agent_quiet';
    }
    return null;
  }

  private toolsInFlight(now: number): boolean {
    const staleMs = this.options.staleToolMs ?? 30000;
    for (const [callId, at] of this.openTools) if (now - at >= staleMs) this.openTools.delete(callId);
    return this.openTools.size > 0;
  }

  private touch(at: number): void {
    this.lastAgentActivity = Math.max(this.lastAgentActivity, at);
  }
}
