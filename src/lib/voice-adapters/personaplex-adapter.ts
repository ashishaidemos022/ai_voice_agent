import Recorder from 'opus-recorder';
import encoderPath from 'opus-recorder/dist/encoderWorker.min.js?url';
import type { RealtimeConfig } from '../../types/voice-agent';
import type { VoiceAdapter, VoiceEventType } from './types';
import { createDecoderWorker, initDecoder } from '../personaplex/decoderWorker';

type PersonaPlexGatewaySession = {
  gatewayUrl: string;
  token: string;
  agentId: string;
  sessionId: string;
};

type AudioPlaybackState = {
  lastAudioAt: number;
  speakingTimeout?: number | null;
};

export class PersonaPlexVoiceAdapter implements VoiceAdapter {
  private ws: WebSocket | null = null;
  private config: RealtimeConfig;
  private gatewaySession: PersonaPlexGatewaySession | null = null;
  private eventHandlers: Map<string, Set<(event: any) => void>> = new Map();
  private recorder: any | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private audioContext: AudioContext | null = null;
  private decoderWorker: Worker | null = null;
  private transcriptBuffer = '';
  private transcriptTimer: number | null = null;
  private playbackState: AudioPlaybackState = { lastAudioAt: 0 };
  private bytesIn = 0;
  private bytesOut = 0;
  private connected = false;

  constructor(config: RealtimeConfig, session?: PersonaPlexGatewaySession) {
    this.config = config;
    if (session) {
      this.gatewaySession = session;
    }
  }

  updateGatewaySession(session: PersonaPlexGatewaySession): void {
    this.gatewaySession = session;
  }

  updateSessionConfig(newConfig: RealtimeConfig): void {
    this.config = newConfig;
  }

  async connect(): Promise<void> {
    if (!this.gatewaySession?.gatewayUrl || !this.gatewaySession?.token) {
      const error = 'PersonaPlex gateway session missing. Unable to connect.';
      this.emit({ type: 'error', error });
      throw new Error(error);
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    const url = new URL(this.gatewaySession.gatewayUrl);
    url.searchParams.set('token', this.gatewaySession.token);
    url.searchParams.set('agent', this.gatewaySession.agentId);
    url.searchParams.set('session', this.gatewaySession.sessionId);

    await this.ensureDecoderReady();

    this.ws = new WebSocket(url.toString());
    this.ws.binaryType = 'arraybuffer';

    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error('WebSocket not created'));
      let handshakeTimeout: number | null = null;
      let resolved = false;
      const failConnect = (message: string) => {
        const error = 'PersonaPlex unavailable. Try again or switch to OpenAI Realtime.';
        this.emit({ type: 'error', error });
        reject(new Error(message));
      };

      this.ws.onopen = () => {
        this.connected = false;
        handshakeTimeout = window.setTimeout(() => {
          if (!this.connected) {
            this.ws?.close(4000, 'handshake-timeout');
            failConnect('handshake-timeout');
          }
        }, 5000);
      };

    this.ws.onerror = () => {
        failConnect('socket-error');
      };

      this.ws.onclose = (event) => {
        this.connected = false;
        this.emit({ type: 'disconnected', reason: event.reason || `code:${event.code}` });
        this.emit({ type: 'agent_state', state: 'idle', reason: 'socket-closed' });
      };

      this.ws.onmessage = (event) => {
        if (!resolved) {
          resolved = true;
          if (handshakeTimeout) {
            window.clearTimeout(handshakeTimeout);
            handshakeTimeout = null;
          }
          resolve();
        }
        this.handleMessage(event.data);
      };
    });
  }

  async reconnect(): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    return this.connect();
  }

  disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
    this.ws = null;
    this.connected = false;
    this.stopCapture?.();
    if (this.decoderWorker) {
      this.decoderWorker.terminate();
      this.decoderWorker = null;
    }
    this.eventHandlers.clear();
    this.emit({ type: 'agent_state', state: 'idle', reason: 'disconnect' });
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.connected;
  }

  sendAudio(_audioData: Int16Array): void {
    // PersonaPlex uses Opus frames; raw PCM is ignored.
  }

  commitAudio(): void {
    // Opus streaming is continuous; no explicit commit.
  }

  clearAudioBuffer(): void {
    // No-op for Opus streaming.
  }

  sendFunctionCallOutput(_callId: string, _output: any): void {
    // PersonaPlex does not support tool calling yet.
  }

  sendSystemMessage(_text: string): void {
    // PersonaPlex text prompt is provided at connection time only.
  }

  cancelResponse(_options?: { suppressState?: boolean }): void {
    this.emit({ type: 'interruption' });
  }

  requestResponse(): void {
    // No-op: PersonaPlex streams continuously.
  }

  on(eventType: VoiceEventType, handler: (event: any) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);
  }

  off(eventType: VoiceEventType, handler: (event: any) => void): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  async startCapture(): Promise<void> {
    if (this.recorder || !navigator?.mediaDevices?.getUserMedia) {
      return;
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      },
      video: false
    });

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const targetSampleRate = this.config.voice_sample_rate_hz ?? 24000;
    try {
      this.audioContext = new AudioContextClass({ sampleRate: targetSampleRate });
    } catch {
      this.audioContext = new AudioContextClass();
    }

    if (this.audioContext && this.stream) {
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      source.connect(this.analyser);
    }

    const recorderOptions = {
      encoderPath,
      mediaTrackConstraints: { audio: true },
      bufferLength: Math.round(960 * (this.audioContext?.sampleRate ?? targetSampleRate) / targetSampleRate),
      encoderFrameSize: 20,
      encoderSampleRate: targetSampleRate,
      maxFramesPerPage: 2,
      numberOfChannels: 1,
      recordingGain: 1,
      resampleQuality: 5,
      encoderComplexity: 5,
      encoderApplication: 2049,
      streamPages: true,
    };

    this.recorder = new Recorder(recorderOptions);
    this.recorder.ondataavailable = (data: Uint8Array) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const message = new Uint8Array(1 + data.length);
      message[0] = 0x01;
      message.set(data, 1);
      this.bytesOut += message.byteLength;
      this.ws.send(message);
    };
    this.recorder.onstart = () => {
      this.emit({ type: 'agent_state', state: 'listening' });
    };
    this.recorder.onstop = () => {
      this.emit({ type: 'agent_state', state: 'idle' });
    };

    if (this.recorder) {
      this.recorder.start();
    }
  }

  stopCapture(): void {
    if (this.recorder) {
      this.recorder.stop();
      this.recorder = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    this.audioContext = null;
    this.analyser = null;
    this.dataArray = null;
  }

  getWaveformData(): Uint8Array | null {
    if (!this.analyser || !this.dataArray) return null;
    const dataArray = this.dataArray as Uint8Array<ArrayBuffer>;
    this.analyser.getByteTimeDomainData(dataArray);
    return dataArray;
  }

  getVolume(): number {
    if (!this.analyser || !this.dataArray) return 0;
    const dataArray = this.dataArray as Uint8Array<ArrayBuffer>;
    this.analyser.getByteTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / dataArray.length);
  }

  private async ensureDecoderReady(): Promise<void> {
    if (this.decoderWorker) return;
    this.decoderWorker = createDecoderWorker();
    this.decoderWorker.onmessage = (event: MessageEvent<Float32Array[]>) => {
      const payload = event.data?.[0];
      if (!payload) return;
      this.handleDecodedAudio(payload);
    };
    const sampleRate = this.config.voice_sample_rate_hz ?? 24000;
    await initDecoder(this.decoderWorker, sampleRate);
  }

  private handleMessage(data: ArrayBuffer | Blob): void {
    if (data instanceof Blob) {
      data.arrayBuffer().then(buffer => this.handleMessage(buffer));
      return;
    }
    const bytes = new Uint8Array(data);
    if (bytes.length === 0) return;
    const kind = bytes[0];
    const payload = bytes.slice(1);
    this.bytesIn += bytes.byteLength;

    switch (kind) {
      case 0x00:
        this.connected = true;
        this.emit({ type: 'connected' });
        this.emit({ type: 'agent_state', state: 'idle' });
        break;
      case 0x01:
        if (this.decoderWorker) {
          const payloadCopy = new Uint8Array(
            payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength)
          );
          this.decoderWorker.postMessage(
            { command: 'decode', pages: payloadCopy },
            [payloadCopy.buffer as ArrayBuffer]
          );
        }
        break;
      case 0x02: {
        const token = new TextDecoder().decode(payload as Uint8Array).replace(/▁/g, ' ');
        this.handleTranscriptToken(token);
        break;
      }
      case 0x05: {
        const errorMessage = new TextDecoder().decode(payload as Uint8Array);
        this.emit({ type: 'error', error: errorMessage });
        break;
      }
      case 0x06:
        // ping; ignore or respond if needed
        break;
      default:
        break;
    }
  }

  private handleDecodedAudio(samples: Float32Array): void {
    const int16 = new Int16Array(samples.length);
    const gain = 0.85;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i] * gain));
      int16[i] = s < 0 ? s * 32768 : s * 32767;
    }
    const base64 = this.arrayBufferToBase64(int16.buffer);
    const sampleRate = this.config.voice_sample_rate_hz ?? 24000;
    this.emit({ type: 'audio.delta', delta: base64, sampleRate });
    this.markSpeaking();
  }

  private markSpeaking(): void {
    const now = Date.now();
    this.playbackState.lastAudioAt = now;
    this.emit({ type: 'agent_state', state: 'speaking' });
    if (this.playbackState.speakingTimeout) {
      window.clearTimeout(this.playbackState.speakingTimeout);
    }
    this.playbackState.speakingTimeout = window.setTimeout(() => {
      if (Date.now() - this.playbackState.lastAudioAt >= 300) {
        this.emit({ type: 'agent_state', state: 'idle' });
      }
    }, 400);
  }

  private handleTranscriptToken(token: string): void {
    if (!token) return;
    this.transcriptBuffer += token;
    this.emit({ type: 'transcript.delta', delta: token, role: 'assistant' });
    if (this.transcriptTimer) {
      window.clearTimeout(this.transcriptTimer);
    }
    this.transcriptTimer = window.setTimeout(() => {
      const transcript = this.transcriptBuffer.trim();
      if (transcript) {
        this.emit({ type: 'transcript.done', transcript, role: 'assistant' });
      }
      this.transcriptBuffer = '';
    }, 1200);
  }

  private emit(event: any): void {
    const handlers = this.eventHandlers.get(event.type);
    if (handlers) {
      handlers.forEach(handler => handler(event));
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer | ArrayBufferLike): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
