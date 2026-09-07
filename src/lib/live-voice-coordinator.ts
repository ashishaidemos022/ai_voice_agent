/** Serialize business actions while letting speech interrupt playback immediately. */
export class LiveVoiceCoordinator {
  private epoch = 0;
  private answerEpoch = 0;
  private busy = false;
  private listening = false;
  private pending: string[] = [];
  private seen = new Set<string>();
  private answerId?: string;
  private closed = false;
  private callbacks: {
    submit: (text: string) => void;
    speak: (text: string) => void;
    interrupt: () => void;
    queued: (text: string) => void;
  };
  constructor(callbacks: LiveVoiceCoordinator['callbacks'], initialAnswerId?: string) { this.callbacks = callbacks; this.answerId = initialAnswerId; }
  speechStarted() {
    if (this.closed) return;
    this.epoch++;
    this.listening = true;
    this.callbacks.interrupt();
  }
  transcript(text: string, itemId: string) {
    if (this.closed || this.seen.has(itemId) || !text.trim()) return;
    this.seen.add(itemId);
    this.listening = false;
    this.pending.push(text.trim());
    this.flush();
  }
  sync(busy: boolean, answer?: { id: string; content: string }) {
    if (this.closed) return;
    if (busy && !this.busy) this.callbacks.interrupt();
    this.busy = busy;
    if (answer && answer.id !== this.answerId && !busy) {
      this.answerId = answer.id;
      if (!this.listening && !this.pending.length && this.answerEpoch === this.epoch) this.callbacks.speak(answer.content);
    }
    this.flush();
  }
  private flush() {
    this.callbacks.queued(this.pending.join(' '));
    if (this.busy || this.listening || !this.pending.length) return;
    const text = this.pending.join('\n'); this.pending = [];
    this.busy = true; this.answerEpoch = this.epoch;
    this.callbacks.queued('');
    this.callbacks.submit(text);
  }
  close() { this.closed = true; this.pending = []; this.callbacks.interrupt(); }
}
