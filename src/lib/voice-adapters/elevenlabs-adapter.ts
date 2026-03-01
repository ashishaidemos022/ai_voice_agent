import type { RealtimeConfig } from '../../types/voice-agent';
import { RealtimeAPIClient, type RealtimeEvent } from '../realtime-client';
import type { VoiceAdapter, VoiceEventType } from './types';

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
  'interruption',
  'function_call',
  'conversation.item.created',
  'session.updated'
];

export class ElevenLabsVoiceAdapter implements VoiceAdapter {
  private readonly realtime: RealtimeAPIClient;
  private readonly session: ElevenLabsGatewaySession;
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<(event: any) => void>>();

  constructor(config: RealtimeConfig, session: ElevenLabsGatewaySession, options?: { apiKey?: string }) {
    this.session = session;
    this.realtime = new RealtimeAPIClient(config, {
      apiKey: options?.apiKey,
      allowInterruptions: true,
      textOnly: true
    });

    FORWARDED_EVENTS.forEach((eventType) => {
      this.realtime.on(eventType, (event: RealtimeEvent) => {
        if (eventType === 'text.done' && (event as any)?.text) {
          this.sendTextToGateway((event as any).text);
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
    this.sendGatewayMessage({ type: 'cancel' });
  }

  requestResponse(): void {
    this.realtime.requestResponse();
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

      ws.onopen = () => {
        settled = true;
        resolve();
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Failed to connect ElevenLabs gateway'));
        }
      };
      ws.onclose = () => {
        if (!settled) {
          settled = true;
          reject(new Error('ElevenLabs gateway closed during handshake'));
        }
        this.emit('disconnected', { type: 'disconnected', reason: 'elevenlabs-gateway-closed' });
      };
      ws.onmessage = (event) => {
        this.handleGatewayMessage(event.data);
      };
    });
  }

  private handleGatewayMessage(raw: any): void {
    try {
      const message = typeof raw === 'string' ? JSON.parse(raw) : null;
      if (!message || typeof message !== 'object') return;

      if (message.type === 'audio.delta' && message.delta) {
        this.emit('audio.delta', { type: 'audio.delta', delta: message.delta });
      } else if (message.type === 'audio.done') {
        this.emit('audio.done', { type: 'audio.done' });
      } else if (message.type === 'error') {
        this.emit('error', { type: 'error', error: message.error || 'ElevenLabs gateway error' });
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
    this.ws.send(JSON.stringify(payload));
  }
}
