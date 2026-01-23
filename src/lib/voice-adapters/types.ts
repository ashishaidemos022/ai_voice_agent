import type { RealtimeConfig } from '../../types/voice-agent';
import type { RealtimeEvent } from '../realtime-client';

export type VoiceEventType = RealtimeEvent['type'];

export interface VoiceAdapter {
  connect(): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  updateSessionConfig(newConfig: RealtimeConfig): void;
  sendAudio(audioData: Int16Array): void;
  commitAudio(): void;
  clearAudioBuffer(): void;
  sendFunctionCallOutput(callId: string, output: any): void;
  sendSystemMessage(text: string): void;
  cancelResponse(options?: { suppressState?: boolean }): void;
  requestResponse(): void;
  on(eventType: VoiceEventType, handler: (event: any) => void): void;
  off(eventType: VoiceEventType, handler: (event: any) => void): void;
  startCapture?: () => Promise<void>;
  stopCapture?: () => void;
  getWaveformData?: () => Uint8Array | null;
  getVolume?: () => number;
}
