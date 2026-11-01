import { supabase } from './supabase';
import {
  base64Pcm16ToFloat32,
  inputAudioChunkMessage,
  isFatalTranslationError,
  isTranslationError,
  parseTranslationMessage,
  Pcm16Batcher,
  TRANSLATION_INPUT_SAMPLE_RATE,
  type TranslationServerMessage,
  type TranslationSessionConfig
} from '../../shared/realtime-translation';

export type TranslationTokenResponse = {
  token: string;
  gateway_ws_url: string;
  expires_in: number;
};

function functionUrl(): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!supabaseUrl) throw new Error('Supabase URL is not configured');
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/elevenlabs-translation`;
}

export async function requestTranslationToken(params: {
  providerKeyId: string | null;
  sessionId: string;
  config: TranslationSessionConfig;
}): Promise<TranslationTokenResponse> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const { data: { session } } = await supabase.auth.getSession();
  if (!anonKey || !session?.access_token) throw new Error('Your session expired. Please sign in again.');
  const response = await fetch(functionUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({
      action: 'token',
      provider_key_id: params.providerKeyId || undefined,
      session_id: params.sessionId,
      origin: window.location.origin,
      config: params.config
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.token || !payload?.gateway_ws_url) {
    throw new Error(payload?.error || `Unable to start translation (${response.status})`);
  }
  return payload as TranslationTokenResponse;
}

export type TranslationStreamState = 'idle' | 'connecting' | 'live' | 'closed' | 'error';

type StreamCallbacks = {
  onState: (state: TranslationStreamState, detail?: string) => void;
  onMessage: (message: TranslationServerMessage) => void;
};

/** One direction of a conversation: mic audio in one language → translated speech in another. */
export class TranslationStream {
  private socket: WebSocket | null = null;
  private batcher = new Pcm16Batcher();
  private pending: string[] = [];
  private generation = 0;
  state: TranslationStreamState = 'idle';
  fatal = false;

  constructor(
    private readonly getToken: () => Promise<TranslationTokenResponse>,
    private readonly callbacks: StreamCallbacks
  ) {}

  private setState(state: TranslationStreamState, detail?: string) {
    this.state = state;
    this.callbacks.onState(state, detail);
  }

  async connect(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'live') return;
    const generation = ++this.generation;
    this.fatal = false;
    this.setState('connecting');
    let token: TranslationTokenResponse;
    try {
      token = await this.getToken();
    } catch (error) {
      if (generation !== this.generation) return;
      this.setState('error', error instanceof Error ? error.message : 'Unable to start translation');
      return;
    }
    if (generation !== this.generation) return;

    const url = new URL(token.gateway_ws_url);
    url.searchParams.set('token', token.token);
    const socket = new WebSocket(url.toString());
    this.socket = socket;
    let lastError: string | undefined;

    socket.onmessage = (event) => {
      if (generation !== this.generation || typeof event.data !== 'string') return;
      const message = parseTranslationMessage(event.data);
      if (!message) return;
      const started = message.message_type === 'session_started'
        || (message.message_type === 'status' && message.status === 'started');
      if (started && this.state !== 'live') {
        this.setState('live');
        this.drainPending();
      }
      if (isTranslationError(message)) {
        lastError = message.error;
        if (isFatalTranslationError(message.message_type)) this.fatal = true;
      }
      this.callbacks.onMessage(message);
    };
    socket.onclose = (event) => {
      if (generation !== this.generation) return;
      this.socket = null;
      this.pending = [];
      const detail = lastError || (event.code !== 1000 ? `Connection closed (${event.code}${event.reason ? `: ${event.reason}` : ''})` : undefined);
      this.setState(event.code === 1000 && !lastError ? 'closed' : 'error', detail);
    };
    socket.onerror = () => {
      lastError = lastError || 'Translation gateway connection failed';
    };
  }

  private drainPending() {
    while (this.pending.length && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(this.pending.shift()!);
    }
  }

  private send(payload: string) {
    if (this.state === 'live' && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(payload);
    } else if (this.state === 'connecting' && this.pending.length < 50) {
      this.pending.push(payload);
    }
  }

  /** Feed 16 kHz mono PCM16 frames of any size; they are re-chunked to ~100 ms. */
  pushPcm(frame: Int16Array) {
    for (const chunk of this.batcher.push(frame)) this.send(inputAudioChunkMessage(chunk));
  }

  /**
   * Sends trailing silence so the server's turn detection finalizes the last phrase
   * when the speaker hands the floor to the other person.
   */
  flushWithSilence(ms = 800) {
    const rest = this.batcher.flush();
    if (rest) this.send(inputAudioChunkMessage(rest));
    const silence = new Int16Array((TRANSLATION_INPUT_SAMPLE_RATE * 100) / 1000);
    for (let elapsed = 0; elapsed < ms; elapsed += 100) this.send(inputAudioChunkMessage(silence));
  }

  close() {
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    this.pending = [];
    this.batcher.reset();
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ message_type: 'end_of_stream' }));
      } catch {
        // ignore
      }
      socket.close(1000, 'client-ended');
    } else if (socket) {
      socket.close();
    }
    this.setState('closed');
  }
}

/** Gapless scheduler for translated PCM16 chunks at whatever sample rate the server reports. */
export class PcmPlayer {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private nextStart = 0;
  private sources = new Set<AudioBufferSourceNode>();

  async resume() {
    if (!this.context) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.context = new Ctor();
      this.gain = this.context.createGain();
      this.gain.connect(this.context.destination);
    }
    if (this.context.state !== 'running') await this.context.resume();
  }

  setVolume(volume: number) {
    if (this.gain) this.gain.gain.value = volume;
  }

  enqueue(base64: string, sampleRate: number): boolean {
    if (!this.context || !this.gain) return false;
    const samples = base64Pcm16ToFloat32(base64);
    if (samples.length === 0) return false;
    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    const now = this.context.currentTime;
    // 40 ms of jitter headroom when starting from silence.
    const startAt = this.nextStart > now ? this.nextStart : now + 0.04;
    source.start(startAt);
    this.nextStart = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
    return true;
  }

  isPlaying(): boolean {
    return !!this.context && this.nextStart > this.context.currentTime;
  }

  stop() {
    for (const source of this.sources) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    this.sources.clear();
    this.nextStart = 0;
  }

  async close() {
    this.stop();
    const context = this.context;
    this.context = null;
    this.gain = null;
    if (context && context.state !== 'closed') await context.close().catch(() => undefined);
  }
}

/** Microphone → 16 kHz PCM16 frames, reusing the app's pcm-downsampler worklet. */
export class TranslationMic {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuffer: Uint8Array<ArrayBuffer> | null = null;

  async start(onFrame: (frame: Int16Array) => void, deviceId?: string) {
    await this.stop();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new Ctor();
    await context.audioWorklet.addModule(new URL('/audio-worklet-processor.js', window.location.origin).toString());
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'pcm-downsampler', {
      processorOptions: { targetSampleRate: TRANSLATION_INPUT_SAMPLE_RATE }
    });
    node.port.onmessage = (event: MessageEvent<Int16Array>) => onFrame(event.data);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    source.connect(node);
    // The worklet must be pulled by the graph; route it through a muted gain.
    const sink = context.createGain();
    sink.gain.value = 0;
    node.connect(sink);
    sink.connect(context.destination);
    if (context.state !== 'running') await context.resume();
    this.context = context;
    this.stream = stream;
    this.node = node;
    this.analyser = analyser;
    this.levelBuffer = new Uint8Array(analyser.fftSize);
  }

  /** 0..1 RMS input level for the meter. */
  level(): number {
    if (!this.analyser || !this.levelBuffer) return 0;
    this.analyser.getByteTimeDomainData(this.levelBuffer);
    let sum = 0;
    for (const value of this.levelBuffer) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    return Math.min(1, Math.sqrt(sum / this.levelBuffer.length) * 4);
  }

  async stop() {
    if (this.node) this.node.port.onmessage = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    const context = this.context;
    this.context = null;
    this.stream = null;
    this.node = null;
    this.analyser = null;
    if (context && context.state !== 'closed') await context.close().catch(() => undefined);
  }
}
