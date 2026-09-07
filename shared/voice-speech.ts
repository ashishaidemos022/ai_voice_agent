export const ROUTED_VOICES = ['coral', 'alloy', 'sage'] as const;
export const VOICE_AUDIO_LIMIT = 10 * 1024 * 1024;
export const VOICE_SPEECH_LIMIT = 3800;

/** Sentence/word boundaries keep every part of long answers speakable. */
export function speechSegments(value: string): string[] {
  let remaining = spokenText(value);
  const segments: string[] = [];
  while (remaining.length > VOICE_SPEECH_LIMIT) {
    const head = remaining.slice(0, VOICE_SPEECH_LIMIT);
    const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
    const boundary = sentence > 300 ? sentence + 1 : Math.max(head.lastIndexOf(' '), head.lastIndexOf('\n'));
    const end = boundary > 0 ? boundary : VOICE_SPEECH_LIMIT;
    segments.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) segments.push(remaining);
  return segments;
}

/** Deterministic local endpointing; short clicks cannot submit an utterance. */
export class SpeechGate {
  private started = 0;
  private lastLoud = 0;
  private voicedMs = 0;
  private previous = 0;
  sample(rms: number, now: number): 'listen' | 'submit' | 'timeout' {
    if (!this.started) this.started = now;
    const elapsed = this.previous ? Math.min(now - this.previous, 100) : 0;
    this.previous = now;
    if (rms >= 0.025) { this.voicedMs += elapsed; this.lastLoud = now; }
    if (this.voicedMs >= 250 && now - this.lastLoud >= 1000) return 'submit';
    if (now - this.started >= 60000) return this.voicedMs >= 250 ? 'submit' : 'timeout';
    return 'listen';
  }
}

/** Keep source markers and visual formatting in the transcript, not the spoken output. */
export function spokenText(text: string): string {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[memory:[a-f0-9-]+\]|\[K\d+\]|\[M\d+\]/gi, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s*\|?[\s:|-]+\|\s*$/gm, '')
    .replace(/[|]/g, '. ').replace(/[*#`]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}
