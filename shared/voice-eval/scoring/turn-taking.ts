import type { EvidenceEvent, TurnTakingResult } from '../types.ts';

export const BARGE_IN_MAX_MS = 500;
export const SILENCE_REPROMPT_MS = 8000;
const REPROMPT_GRACE_MS = 2000;
// Typical conversational pace (~150 wpm), used to back-date a caller transcript to when the caller started talking.
const CALLER_MS_PER_WORD = 400;

// When the caller started talking. Providers without VAD (GPT-Live, ElevenLabs agent) emit no
// caller_speech_start, only the finished transcript, so its start is estimated from its length.
function callerActivityStart(event: EvidenceEvent): number | null {
  if (event.kind === 'caller_speech_start') return event.atMs;
  if (event.kind === 'caller_transcript') {
    const words = event.text.trim().split(/\s+/).filter(Boolean).length;
    return event.atMs - words * CALLER_MS_PER_WORD;
  }
  return null;
}

export const BARGE_IN_STOP_WINDOW_MS = 5000;

type Utterance = Extract<EvidenceEvent, { kind: 'caller_utterance' }>;

function bargeInBeatIndexes(sorted: EvidenceEvent[]): Set<number> {
  return new Set(sorted.flatMap((e) => (e.kind === 'beat' && e.beatKind === 'barge_in' ? [e.beatIndex] : [])));
}

function isBargeUtterance(utterance: Utterance, bargeBeats: Set<number>): boolean {
  return utterance.source === 'beat' && utterance.beatIndex !== null && bargeBeats.has(utterance.beatIndex);
}

function agentSpeakingAt(sorted: EvidenceEvent[], atMs: number): boolean {
  let speaking = false;
  for (const e of sorted) {
    if (e.atMs > atMs) break;
    if (e.kind === 'agent_audio_start') speaking = true;
    else if (e.kind === 'agent_audio_stop') speaking = false;
  }
  return speaking;
}

// Cutoff = first agent audio stop after the caller started interrupting; no stop within the window fails.
function syntheticBargeIns(sorted: EvidenceEvent[], utterances: Utterance[], bargeBeats: Set<number>): number[] {
  return utterances
    .filter((u) => isBargeUtterance(u, bargeBeats) && agentSpeakingAt(sorted, u.atMs))
    .map((u) => {
      const stop = sorted.find((e) => e.kind === 'agent_audio_stop' && e.atMs >= u.atMs && e.atMs <= u.atMs + BARGE_IN_STOP_WINDOW_MS);
      return stop ? stop.atMs - u.atMs : BARGE_IN_STOP_WINDOW_MS;
    });
}

export function scoreTurnTaking(events: EvidenceEvent[]): TurnTakingResult {
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  const utterances = sorted.filter((e): e is Utterance => e.kind === 'caller_utterance');
  const synthetic = utterances.length > 0;
  const bargeBeats = bargeInBeatIndexes(sorted);

  const bargeIns = synthetic
    ? syntheticBargeIns(sorted, utterances, bargeBeats)
    : sorted.flatMap((e) => (e.kind === 'turn_metric' && e.bargeInMs !== null ? [e.bargeInMs] : []));
  const bargeInPass = bargeIns.length ? bargeIns.every((ms) => ms <= BARGE_IN_MAX_MS) : null;

  let talkOverCount = 0;
  if (synthetic) {
    for (const u of utterances) {
      if (isBargeUtterance(u, bargeBeats)) continue;
      const end = u.atMs + u.durationMs;
      talkOverCount += sorted.filter((e) => e.kind === 'agent_audio_start' && e.atMs > u.atMs && e.atMs < end).length;
    }
  } else {
    let callerSpeaking = false;
    for (const event of sorted) {
      if (event.kind === 'caller_speech_start') callerSpeaking = true;
      else if (event.kind === 'caller_speech_stop') callerSpeaking = false;
      else if (event.kind === 'agent_audio_start' && callerSpeaking) talkOverCount += 1;
    }
  }

  // Synthetic runs know the exact caller start; human runs estimate it from the transcript.
  const activityStart = synthetic
    ? (e: EvidenceEvent) => (e.kind === 'caller_utterance' ? e.atMs : null)
    : callerActivityStart;

  const lastEventAt = sorted.length ? sorted[sorted.length - 1].atMs : 0;
  let silenceViolations = 0;
  for (const event of sorted) {
    if (event.kind !== 'agent_transcript') continue;
    const windowEnd = event.atMs + SILENCE_REPROMPT_MS;
    const callerSpokeInWindow = sorted.some((e) => {
      const start = e.atMs > event.atMs ? activityStart(e) : null;
      return start !== null && start <= windowEnd;
    });
    const callContinued = lastEventAt > windowEnd + REPROMPT_GRACE_MS;
    if (callerSpokeInWindow || !callContinued) continue;
    // Any agent speech after the pause counts: a new audio start or the agent simply continuing its turn.
    const reprompted = sorted.some(
      (e) => (e.kind === 'agent_audio_start' || e.kind === 'agent_transcript') && e.atMs > event.atMs + 250 && e.atMs <= windowEnd
    );
    if (!reprompted) silenceViolations += 1;
  }

  const status = !sorted.length
    ? 'no_data'
    : bargeInPass === false || silenceViolations > 0
      ? 'fail'
      : talkOverCount > 0 ? 'warn' : 'pass';
  return { status, bargeIns, bargeInPass, talkOverCount, silenceViolations };
}
