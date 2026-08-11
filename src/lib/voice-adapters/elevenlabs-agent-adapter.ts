import { Conversation, type VoiceConversation } from '@elevenlabs/client';
import type { RealtimeConfig } from '../../types/voice-agent';
import { getToolSchemas } from '../tools-registry';
import type { VoiceAdapter, VoiceEventType } from './types';
import { beginBenchmarkTurn, emitBenchmarkEvent, emitBenchmarkMilestone } from '../benchmark-instrumentation';

type DirectAgentSession = {
  getSignedUrl: () => Promise<string>;
  finalizeUsage?: (conversationId: string) => Promise<void>;
  userId?: string;
};

type PendingToolCall = {
  resolve: (value: string | number | void) => void;
  timer: number;
};

export class ElevenLabsAgentAdapter implements VoiceAdapter {
  private config: RealtimeConfig;
  private readonly session: DirectAgentSession;
  private conversation: VoiceConversation | null = null;
  private handlers = new Map<string, Set<(event: any) => void>>();
  private pendingTools = new Map<string, PendingToolCall>();
  private responseActive = false;
  private interrupted = false;
  private assistantText = '';
  private assistantItemId: string | null = null;
  private sawStreamingAssistantText = false;
  private conversationId: string | null = null;
  private usageFinalized = false;

  constructor(config: RealtimeConfig, session: DirectAgentSession) {
    this.config = config;
    this.session = session;
  }

  async connect(): Promise<void> {
    emitBenchmarkEvent('session.connect_started', {
      provider: 'elevenlabs_agent',
      transport: 'websocket'
    });
    const signedUrl = await this.session.getSignedUrl();
    const providerConfig = this.config.voice_provider_config || {};
    // ElevenLabs rejects prompt, language, first-message, and voice overrides
    // unless each one is explicitly enabled in the Agent security settings.
    // Keep the native Agent configuration as the safe, apples-to-apples default.
    const syncPreset = providerConfig.sync_local_instructions === true;
    const toolSchemas = getToolSchemas();
    const clientTools = Object.fromEntries(
      toolSchemas.map((tool) => [tool.name, (parameters: any) => this.requestToolExecution(tool.name, parameters)])
    );

    this.conversation = await Conversation.startSession({
      signedUrl,
      connectionType: 'websocket',
      textOnly: false,
      userId: this.session.userId,
      inputChunkDurationMs: 25,
      clientTools,
      ...(syncPreset
        ? {
            overrides: {
              agent: {
                prompt: { prompt: this.config.instructions },
                ...(providerConfig.first_message ? { firstMessage: providerConfig.first_message } : {}),
                ...(providerConfig.language ? { language: providerConfig.language } : {})
              },
              ...(this.config.voice_id
                ? {
                    tts: {
                      voiceId: this.config.voice_id,
                      ...(providerConfig.voice_settings?.stability !== undefined
                        ? { stability: providerConfig.voice_settings.stability }
                        : {}),
                      ...(providerConfig.voice_settings?.similarity_boost !== undefined
                        ? {
                            similarityBoost: providerConfig.voice_settings.similarity_boost
                          }
                        : {})
                    }
                  }
                : {})
            }
          }
        : {}),
      onConnect: ({ conversationId }) => {
        this.conversationId = conversationId;
        emitBenchmarkEvent('session.connected', {
          provider: 'elevenlabs_agent',
          conversation_id: conversationId
        });
        this.emit('connected', { type: 'connected', conversationId });
        this.emit('session.updated', { type: 'session.updated' });
      },
      onDisconnect: (details) => {
        emitBenchmarkEvent('session.disconnected', {
          provider: 'elevenlabs_agent',
          reason: details.reason
        });
        if (details.reason === 'error') {
          console.error('[ElevenLabsAgentAdapter] provider disconnected', {
            message: details.message,
            closeCode: details.closeCode,
            closeReason: details.closeReason,
            context: details.context
          });
        }
        this.emit('disconnected', {
          type: 'disconnected',
          reason: details.reason,
          details
        });
        this.emitAgentState('idle', 'elevenlabs-disconnected');
        void this.finalizeUsage();
      },
      onError: (message) => {
        emitBenchmarkEvent('session.error', {
          provider: 'elevenlabs_agent',
          message
        });
        this.emit('error', { type: 'error', error: message });
      },
      onMessage: ({ message, role, event_id: eventId }) => {
        const itemId = eventId !== undefined ? `elevenlabs-${eventId}` : crypto.randomUUID();
        if (role === 'user') {
          beginBenchmarkTurn();
          emitBenchmarkEvent('transcript.user_final', {
            transcript: message,
            provider: 'elevenlabs_agent'
          });
          this.emit('transcript.done', {
            type: 'transcript.done',
            transcript: message,
            role: 'user',
            itemId
          });
          this.beginResponse(itemId);
          return;
        }
        this.assistantItemId = itemId;
        this.assistantText = message;
        if (!this.sawStreamingAssistantText) {
          this.emit('transcript.reset', {
            type: 'transcript.reset',
            role: 'assistant',
            itemId
          });
          this.emit('transcript.delta', {
            type: 'transcript.delta',
            delta: message,
            role: 'assistant',
            itemId
          });
        }
      },
      onAgentChatResponsePart: ({ type, text, event_id: eventId }) => {
        const itemId = `elevenlabs-${eventId}`;
        if (type === 'start') {
          this.assistantItemId = itemId;
          this.assistantText = '';
          this.sawStreamingAssistantText = true;
          this.emit('transcript.reset', {
            type: 'transcript.reset',
            role: 'assistant',
            itemId
          });
          if (!this.responseActive) this.beginResponse(itemId);
        } else if (type === 'delta' && text) {
          emitBenchmarkMilestone('response.first_text', {
            provider: 'elevenlabs_agent'
          });
          this.assistantText += text;
          this.emit('transcript.delta', {
            type: 'transcript.delta',
            delta: text,
            role: 'assistant',
            itemId
          });
        }
      },
      onModeChange: ({ mode }) => {
        if (mode === 'speaking') {
          emitBenchmarkMilestone('audio.first_chunk', {
            source: 'elevenlabs_agent'
          });
          emitBenchmarkMilestone('playback.started', {
            provider: 'elevenlabs_agent'
          });
          this.conversation?.setVolume({ volume: 1 });
          this.responseActive = true;
          this.emitAgentState('speaking');
        } else {
          if (this.responseActive && !this.interrupted) this.finishResponse();
          this.emitAgentState('listening');
        }
      },
      onInterruption: () => {
        emitBenchmarkEvent('interruption.requested', {
          provider: 'elevenlabs_agent'
        });
        emitBenchmarkEvent('interruption.audio_stopped', {
          provider: 'elevenlabs_agent'
        });
        this.interrupted = true;
        this.emit('interruption', { type: 'interruption' });
        this.emitAgentState('interrupted');
      },
      onAgentResponseCorrection: ({ corrected_agent_response: corrected }) => {
        this.assistantText = corrected || '';
        const itemId = this.assistantItemId || crypto.randomUUID();
        this.emit('transcript.reset', {
          type: 'transcript.reset',
          role: 'assistant',
          itemId
        });
        if (corrected) {
          this.emit('transcript.done', {
            type: 'transcript.done',
            transcript: corrected,
            role: 'assistant',
            itemId
          });
        }
        this.finishResponse(false);
      }
    });

    // The workspace has a separate microphone toggle. Keep the SDK session
    // connected while preventing capture until the user explicitly enables it.
    this.conversation.setMicMuted(true);
  }

  async reconnect(): Promise<void> {
    if (this.isConnected()) return;
    await this.connect();
  }

  disconnect(): void {
    const conversation = this.conversation;
    this.conversation = null;
    if (conversation) void conversation.endSession();
    this.rejectPendingTools('ElevenLabs Agent session ended');
  }

  isConnected(): boolean {
    return this.conversation?.isOpen() ?? false;
  }

  updateSessionConfig(newConfig: RealtimeConfig): void {
    this.config = newConfig;
    if (this.isConnected()) {
      this.conversation?.sendContextualUpdate(`Updated workspace instructions: ${newConfig.instructions}`);
    }
  }

  sendAudio(): void {}
  commitAudio(): void {}
  clearAudioBuffer(): void {}

  sendFunctionCallOutput(callId: string, output: any): void {
    const pending = this.pendingTools.get(callId);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    this.pendingTools.delete(callId);
    pending.resolve(typeof output === 'number' || typeof output === 'string' ? output : JSON.stringify(output));
  }

  sendUserMessage(text: string): void {
    this.conversation?.sendUserMessage(text);
  }

  sendSystemMessage(text: string): void {
    this.conversation?.sendContextualUpdate(text);
  }

  cancelResponse(): void {
    this.conversation?.setVolume({ volume: 0 });
    this.conversation?.sendUserActivity();
    this.interrupted = true;
    this.emit('interruption', { type: 'interruption' });
  }

  requestResponse(): void {
    this.conversation?.sendUserActivity();
  }

  async startCapture(): Promise<void> {
    if (!this.conversation) throw new Error('ElevenLabs Agent session is not connected');
    this.conversation.setMicMuted(false);
    emitBenchmarkEvent('microphone.capture_started', {
      provider: 'elevenlabs_agent'
    });
  }

  stopCapture(): void {
    this.conversation?.setMicMuted(true);
  }

  getWaveformData(): Uint8Array | null {
    return this.conversation?.getInputByteFrequencyData() ?? null;
  }

  getVolume(): number {
    return this.conversation?.getInputVolume() ?? 0;
  }

  on(eventType: VoiceEventType, handler: (event: any) => void): void {
    if (!this.handlers.has(eventType)) this.handlers.set(eventType, new Set());
    this.handlers.get(eventType)!.add(handler);
  }

  off(eventType: VoiceEventType, handler: (event: any) => void): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  private emit(eventType: VoiceEventType, payload: any): void {
    this.handlers.get(eventType)?.forEach((handler) => handler(payload));
  }

  private emitAgentState(state: 'idle' | 'listening' | 'speaking' | 'thinking' | 'interrupted', reason?: string): void {
    this.emit('agent_state', { type: 'agent_state', state, reason });
  }

  private beginResponse(itemId: string): void {
    emitBenchmarkMilestone('response.created', {
      response_id: itemId,
      provider: 'elevenlabs_agent'
    });
    this.responseActive = true;
    this.interrupted = false;
    this.assistantItemId = itemId;
    this.sawStreamingAssistantText = false;
    this.emit('response.created', { type: 'response.created', id: itemId });
    this.emitAgentState('thinking');
  }

  private finishResponse(persistTranscript = true): void {
    if (persistTranscript && this.assistantText.trim()) {
      this.emit('transcript.done', {
        type: 'transcript.done',
        transcript: this.assistantText,
        role: 'assistant',
        itemId: this.assistantItemId || undefined
      });
    }
    this.emit('response.done', {
      type: 'response.done',
      response: { provider: 'elevenlabs_agent', interrupted: this.interrupted }
    });
    emitBenchmarkEvent('response.completed', {
      provider: 'elevenlabs_agent',
      interrupted: this.interrupted
    });
    this.responseActive = false;
    this.interrupted = false;
    this.assistantText = '';
    this.assistantItemId = null;
    this.sawStreamingAssistantText = false;
  }

  private requestToolExecution(name: string, parameters: any): Promise<string | number | void> {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const timer = window.setTimeout(() => {
        this.pendingTools.delete(id);
        resolve(JSON.stringify({ error: `Tool ${name} timed out` }));
      }, 30_000);
      this.pendingTools.set(id, { resolve, timer });
      this.emit('function_call', {
        type: 'function_call',
        call: { id, name, arguments: JSON.stringify(parameters || {}) }
      });
    });
  }

  private rejectPendingTools(message: string): void {
    this.pendingTools.forEach(({ resolve, timer }) => {
      window.clearTimeout(timer);
      resolve(JSON.stringify({ error: message }));
    });
    this.pendingTools.clear();
  }

  private async finalizeUsage(): Promise<void> {
    if (this.usageFinalized || !this.conversationId || !this.session.finalizeUsage) return;
    this.usageFinalized = true;
    try {
      await this.session.finalizeUsage(this.conversationId);
    } catch (error) {
      // A failed finalization must be visible, but it should never turn a
      // successfully completed voice call into a client-facing call error.
      console.warn('[ElevenLabsAgentAdapter] failed to finalize usage', error);
    }
  }
}
