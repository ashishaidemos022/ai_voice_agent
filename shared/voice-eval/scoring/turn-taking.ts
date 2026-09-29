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

export function scoreTurnTaking(events: EvidenceEvent[]): TurnTakingResult {
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  const bargeIns = sorted.flatMap((e) => (e.kind === 'turn_metric' && e.bargeInMs !== null ? [e.bargeInMs] : []));
  const bargeInPass = bargeIns.length ? bargeIns.every((ms) => ms <= BARGE_IN_MAX_MS) : null;

  let callerSpeaking = false;
  let talkOverCount = 0;
  for (const event of sorted) {
    if (event.kind === 'caller_speech_start') callerSpeaking = true;
    else if (event.kind === 'caller_speech_stop') callerSpeaking = false;
    else if (event.kind === 'agent_audio_start' && callerSpeaking) talkOverCount += 1;
  }

  const lastEventAt = sorted.length ? sorted[sorted.length - 1].atMs : 0;
  let silenceViolations = 0;
  for (const event of sorted) {
    if (event.kind !== 'agent_transcript') continue;
    const windowEnd = event.atMs + SILENCE_REPROMPT_MS;
    const callerSpokeInWindow = sorted.some((e) => {
      const start = e.atMs > event.atMs ? callerActivityStart(e) : null;
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
