import type { RealtimeConfig } from '../../types/voice-agent';
import { RealtimeAPIClient, type RealtimeEvent } from '../realtime-client';
import type { VoiceAdapter, VoiceEventType } from './types';
import { emitBenchmarkEvent, emitBenchmarkMilestone } from '../benchmark-instrumentation';

interface ElevenLabsGatewaySession {
  gatewayUrl: string;
  token: string;
  agentId: string;
  sessionId: string;
}

const FORWARDED_EVENTS: VoiceEventType[] = [
  'connected',
  'disconnected',
  'error',
  'agent_state',
  'transcript.delta',
  'transcript.done',
  'transcript.reset',
  'text.delta',
  'text.done',
  'response.created',
  'response.done',
  'usage.reported',
  'provider.metrics',
  'interruption',
  'function_call',
  'conversation.item.created',
  'session.updated',
  'speech.started',
  'speech.stopped'
];

export class ElevenLabsVoiceAdapter implements VoiceAdapter {
  private readonly realtime: RealtimeAPIClient;
  private readonly session: ElevenLabsGatewaySession;
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<(event: any) => void>>();
  private readonly supportsStreamingInput: boolean;
  private sawTextDelta = false;

  constructor(config: RealtimeConfig, session: ElevenLabsGatewaySession, options?: { apiKey?: string }) {
    this.session = session;
    const providerConfig = config.voice_provider_config || {};
    this.supportsStreamingInput = providerConfig.model_id !== 'eleven_v3' && !providerConfig.expressive_mode;
    this.realtime = new RealtimeAPIClient(config, {
      apiKey: options?.apiKey,
      allowInterruptions: true,
      textOnly: true
    });

    FORWARDED_EVENTS.forEach((eventType) => {
      this.realtime.on(eventType, (event: RealtimeEvent) => {
        if (eventType === 'response.created') {
          this.sawTextDelta = false;
        } else if (eventType === 'text.delta' && this.supportsStreamingInput) {
          const delta = (event as any)?.delta || '';
          if (delta) {
            this.sawTextDelta = true;
            this.sendTextToGateway(delta);
          }
        } else if (eventType === 'text.done') {
          const text = (event as any)?.text || '';
          if (this.supportsStreamingInput && this.sawTextDelta) {
            this.sendGatewayMessage({ type: 'speak', text: '', flush: true });
          } else if (text) {
            this.sendGatewayMessage({ type: 'speak', text, flush: true });
          }
        }
        this.emit(eventType, event);
      });
    });
  }

  async connect(): Promise<void> {
    await this.realtime.connect();
    await this.connectGateway();
  }

  async reconnect(): Promise<void> {
    await this.realtime.reconnect();
    await this.connectGateway();
  }

  disconnect(): void {
    this.realtime.disconnect();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  isConnected(): boolean {
    const wsOpen = this.ws?.readyState === WebSocket.OPEN;
    return this.realtime.isConnected() && !!wsOpen;
  }

  updateSessionConfig(newConfig: RealtimeConfig): void {
    this.realtime.updateSessionConfig(newConfig);
  }

  sendAudio(audioData: Int16Array): void {
    this.realtime.sendAudio(audioData);
  }

  commitAudio(): void {
    this.realtime.commitAudio();
  }

  clearAudioBuffer(): void {
    this.realtime.clearAudioBuffer();
  }

  sendFunctionCallOutput(callId: string, output: any): void {
    this.realtime.sendFunctionCallOutput(callId, output);
  }

  sendUserMessage(text: string): void {
    this.realtime.sendUserMessage?.(text);
  }

  sendSystemMessage(text: string): void {
    this.realtime.sendSystemMessage(text);
  }

  cancelResponse(options?: { suppressState?: boolean }): void {
    this.realtime.cancelResponse(options);
    this.sawTextDelta = false;
    this.sendGatewayMessage({ type: 'cancel' });
  }

  requestResponse(): void {
    this.realtime.requestResponse();
  }

  injectAudio(encodedAudio: ArrayBuffer): Promise<void> {
    return this.realtime.injectAudio(encodedAudio);
  }

  getOutputVolume(): number {
    return this.realtime.getOutputVolume();
  }

  on(eventType: VoiceEventType, handler: (event: any) => void): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
  }

  off(eventType: VoiceEventType, handler: (event: any) => void): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  private emit(eventType: VoiceEventType, payload: any): void {
    this.handlers.get(eventType)?.forEach((handler) => handler(payload));
  }

  private async connectGateway(): Promise<void> {
    if (!this.session.gatewayUrl || !this.session.token) {
      throw new Error('ElevenLabs gateway session missing. Unable to connect.');
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    const url = new URL(this.session.gatewayUrl);
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/ws';
    }
    url.searchParams.set('token', this.session.token);
    url.searchParams.set('agent', this.session.agentId);
    url.searchParams.set('session', this.session.sessionId);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url.toString());
      this.ws = ws;
      let settled = false;
      const handshakeTimeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.close();
        reject(new Error('ElevenLabs gateway initialization timed out'));
      }, 10_000);

      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(handshakeTimeout);
        callback();
      };

      ws.onopen = () => {
        // The gateway confirms readiness after it resolves the stored provider key.
      };
      ws.onerror = () => {
        settle(() => reject(new Error('Failed to connect ElevenLabs gateway')));
      };
      ws.onclose = (event) => {
        settle(() =>
          reject(
            new Error(
              `ElevenLabs gateway closed during handshake (${event.code}${event.reason ? `: ${event.reason}` : ''})`
            )
          )
        );
        this.emit('disconnected', {
          type: 'disconnected',
          reason: event.reason || 'elevenlabs-gateway-closed',
          code: event.code
        });
      };
      ws.onmessage = (event) => {
        try {
          const message = typeof event.data === 'string' ? JSON.parse(event.data) : null;
          if (message?.type === 'ready') {
            settle(resolve);
            return;
          }
        } catch {
          // The normal message handler will ignore malformed gateway frames.
        }
        this.handleGatewayMessage(event.data);
      };
    });
  }

  private handleGatewayMessage(raw: any): void {
    try {
      const message = typeof raw === 'string' ? JSON.parse(raw) : null;
      if (!message || typeof message !== 'object') return;

      if (message.type === 'audio.delta' && message.delta) {
        emitBenchmarkMilestone('tts.first_audio', { provider: 'elevenlabs' });
        if (message.first_chunk && Number.isFinite(message.gateway_monotonic_ms)) {
          emitBenchmarkEvent(
            'tts.first_audio',
            {
              provider: 'elevenlabs',
              gateway_tts_elapsed_ms: message.gateway_tts_elapsed_ms
            },
            {
              clockDomain: 'gateway',
              monotonicMs: message.gateway_monotonic_ms
            }
          );
        }
        emitBenchmarkMilestone('audio.first_chunk', { source: 'elevenlabs' });
        this.emit('audio.delta', { type: 'audio.delta', delta: message.delta });
      } else if (message.type === 'audio.done') {
        this.emit('audio.done', { type: 'audio.done' });
      } else if (message.type === 'error') {
        this.emit('error', {
          type: 'error',
          error: message.error || 'ElevenLabs gateway error'
        });
      }
    } catch {
      // ignore malformed gateway messages
    }
  }

  private sendTextToGateway(text: string): void {
    if (!text || !text.trim()) return;
    this.sendGatewayMessage({ type: 'speak', text });
  }

  private sendGatewayMessage(payload: Record<string, any>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (payload.type === 'speak') {
      emitBenchmarkMilestone('tts.request_started', {
        provider: 'elevenlabs',
        streaming: !payload.flush,
        characters: typeof payload.text === 'string' ? payload.text.length : 0
      });
    } else if (payload.type === 'cancel') {
      emitBenchmarkEvent('interruption.requested', { provider: 'elevenlabs' });
    }
    this.ws.send(JSON.stringify(payload));
  }
}
