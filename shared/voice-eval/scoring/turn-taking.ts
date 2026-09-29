import type { EvidenceEvent, TurnTakingResult } from '../types.ts';

export const BARGE_IN_MAX_MS = 500;
export const SILENCE_REPROMPT_MS = 8000;
const REPROMPT_GRACE_MS = 2000;

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
    // Providers without VAD (GPT-Live, ElevenLabs agent) emit no caller_speech_start, so a
    // caller transcript also counts as caller activity. VAD providers are unaffected: their
    // speech start precedes the transcript.
    const nextCallerActivity = sorted.find(
      (e) => (e.kind === 'caller_speech_start' || e.kind === 'caller_transcript') && e.atMs > event.atMs
    );
    const callerStayedSilent = !nextCallerActivity || nextCallerActivity.atMs > windowEnd;
    const callContinued = lastEventAt > windowEnd + REPROMPT_GRACE_MS;
    if (!callerStayedSilent || !callContinued) continue;
    const reprompted = sorted.some((e) => e.kind === 'agent_audio_start' && e.atMs > event.atMs + 250 && e.atMs <= windowEnd);
    if (!reprompted) silenceViolations += 1;
  }

  const status = !sorted.length
    ? 'no_data'
    : bargeInPass === false || silenceViolations > 0
      ? 'fail'
      : talkOverCount > 0 ? 'warn' : 'pass';
  return { status, bargeIns, bargeInPass, talkOverCount, silenceViolations };
}
