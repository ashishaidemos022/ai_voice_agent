import type { EvidenceEvent } from '../../shared/voice-eval/types.ts';

export function turnMetric(atMs: number, firstAudioMs: number | null, extra: { bargeInMs?: number | null; toolCallMs?: number | null } = {}): EvidenceEvent {
  return { kind: 'turn_metric', atMs, firstAudioMs, bargeInMs: extra.bargeInMs ?? null, toolCallMs: extra.toolCallMs ?? null };
}

export function toolCall(atMs: number, callId: string, args: Record<string, unknown>, name = 'healthcare_patient_access'): EvidenceEvent {
  return { kind: 'tool_call', atMs, callId, name, args };
}

export function toolResult(atMs: number, callId: string, result: unknown, ok = true): EvidenceEvent {
  return { kind: 'tool_result', atMs, callId, ok, result };
}

export function callerSays(atMs: number, text: string): EvidenceEvent {
  return { kind: 'caller_transcript', atMs, text };
}

export function agentSays(atMs: number, text: string): EvidenceEvent {
  return { kind: 'agent_transcript', atMs, text };
}

export function callerSpeech(startMs: number, stopMs: number): EvidenceEvent[] {
  return [{ kind: 'caller_speech_start', atMs: startMs }, { kind: 'caller_speech_stop', atMs: stopMs }];
}

export function agentAudio(atMs: number): EvidenceEvent {
  return { kind: 'agent_audio_start', atMs };
}
