import { RealtimeConfig } from '../types/voice-agent';
import { getToolSchemas } from './tools-registry';

export type AgentState = 'idle' | 'listening' | 'speaking' | 'thinking' | 'interrupted';

export type RealtimeEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'error'; error: string }
  | { type: 'agent_state'; state: AgentState; reason?: string }
  | { type: 'audio.delta'; delta: string }
  | { type: 'audio.done' }
  | { type: 'transcript.delta'; delta: string; role: 'user' | 'assistant'; itemId?: string }
  | { type: 'transcript.done'; transcript: string; role: 'user' | 'assistant'; itemId?: string }
  | { type: 'transcript.reset'; role: 'user' | 'assistant'; itemId?: string }
  | { type: 'response.created'; id?: string }
  | { type: 'response.done'; response: any }
  | { type: 'interruption' }
  | { type: 'function_call'; call: { id: string; name: string; arguments: string } }
  | { type: 'conversation.item.created'; item: any }
  | { type: 'session.updated' };

type RealtimeClientOptions = {
  apiKey?: string;
  tools?: ReturnType<typeof getToolSchemas>;
  allowInterruptions?: boolean;
};

export class RealtimeAPIClient {
  private ws: WebSocket | null = null;
  private config: RealtimeConfig;
  private eventHandlers: Map<string, Set<(event: any) => void>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private agentState: AgentState = 'idle';
  private intentionalClose = false;
  private hasBufferedAudio = false;
  private bufferedSamples = 0;
  private hasReceivedAudio = false;
  private sessionUpdateSent = false;
  private pendingClear = true;
  private overrideApiKey?: string;
  private overrideTools?: ReturnType<typeof getToolSchemas>;
  private activeResponseCount = 0;
  private cancelPending = false;
  private allowInterruptions: boolean;

  constructor(config: RealtimeConfig, options?: RealtimeClientOptions) {
    this.config = config;
    this.overrideApiKey = options?.apiKey;
    this.overrideTools = options?.tools;
    this.allowInterruptions = options?.allowInterruptions ?? true;
  }

  updateSessionConfig(newConfig: RealtimeConfig): void {
    this.config = newConfig;
    if (this.isConnected()) {
      this.sendSessionUpdate();
    }
  }

  async connect(): Promise<void> {
    this.intentionalClose = false;
    this.sessionUpdateSent = false;
    this.pendingClear = true;
    this.hasReceivedAudio = false;
    this.hasBufferedAudio = false;
    this.bufferedSamples = 0;
    this.activeResponseCount = 0;
    this.cancelPending = false;
    const apiKey = this.overrideApiKey || import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OpenAI API key');
    }

    return new Promise((resolve, reject) => {
      try {
        const url = `wss://api.openai.com/v1/realtime?model=${this.config.model}`;
        this.ws = new WebSocket(url, [
          'realtime',
          `openai-insecure-api-key.${apiKey}`,
          'openai-beta.realtime-v1'
        ]);

        this.ws.onopen = () => {
          console.log('WebSocket connected successfully');
          this.reconnectAttempts = 0;
          this.emit({ type: 'connected' });
          this.sendSessionUpdate();
          resolve();
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket closed:', {
            code: event.code,
            reason: event.reason || 'No reason provided',
            wasClean: event.wasClean
          });

          if (event.code === 1005) {
            console.error('Connection closed without status - possible authentication or protocol issue');
          } else if (event.code === 1006) {
            console.error('Connection closed abnormally');
          } else if (event.code === 1008) {
            console.error('Connection closed due to policy violation');
          }

          this.emit({ type: 'disconnected', reason: event.reason || `code:${event.code}` });
          this.setAgentState('idle', 'socket-closed');

          const shouldRetry = !this.intentionalClose && this.reconnectAttempts < this.maxReconnectAttempts;
          if (shouldRetry) {
            this.attemptReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.emit({ type: 'error', error: 'WebSocket connection error' });
          reject(error);
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleServerMessage(message);
          } catch (error) {
            console.error('Failed to parse message:', error, event.data);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  async reconnect(): Promise<void> {
    console.log('[RealtimeAPIClient] reconnect requested', {
      hasSocket: !!this.ws,
      readyState: this.ws?.readyState
    });
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.intentionalClose = false;
    this.sessionUpdateSent = false;
    this.pendingClear = true;
    this.activeResponseCount = 0;
    this.cancelPending = false;
    return this.connect();
  }

  sendSessionUpdate(): void {
    if (this.sessionUpdateSent) {
      console.log('Session update already sent, skipping duplicate');
      return;
    }
    const tools = this.overrideTools ?? getToolSchemas();
    const languageGuard = 'Always respond in English unless the user explicitly requests a different language.';
    const ragInstructions = this.config.rag_mode === 'guardrail'
      ? `${this.config.instructions}\n\nIf relevant knowledge from the approved knowledge base is unavailable, respond with "I do not have enough knowledge to answer that yet."\n\n${languageGuard}`
      : `${this.config.instructions}\n\n${languageGuard}`;
    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: ragInstructions,
        voice: this.config.voice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'gpt-4o-transcribe',
          language: 'en'
        },
        turn_detection: this.config.turn_detection ?? {
          type: 'server_vad',
          threshold: 0.75,
          prefix_padding_ms: 150,
          silence_duration_ms: 700
        },
        tools,
        tool_choice: 'auto',
        temperature: this.config.temperature,
        max_response_output_tokens: this.config.max_response_output_tokens
      }
    };

    console.log('📤 Sending session.update', {
      turnDetection: sessionConfig.session.turn_detection,
      voice: sessionConfig.session.voice,
      model: this.config.model
    });

    this.send(sessionConfig);
    this.sessionUpdateSent = true;
  }

  private handleServerMessage(message: any): void {
    switch (message.type) {
      case 'session.created':
        console.log('Session created successfully');
        break;

      case 'session.updated':
        console.log('✅ Session updated');
        this.emit({ type: 'session.updated' });
        break;

      case 'input_audio_buffer.speech_started':
        // Reset local counters but defer server clear until we stream audio
        this.bufferedSamples = 0;
        this.hasBufferedAudio = false;
        this.hasReceivedAudio = false;
        this.pendingClear = true;
        if (this.agentState === 'speaking' && this.allowInterruptions) {
          this.cancelResponse();
          this.emit({ type: 'interruption' });
        }
        this.emit({ type: 'transcript.reset', role: 'user' });
        this.setAgentState('listening');
        break;

      case 'input_audio_buffer.speech_stopped':
        // With server VAD, let the server handle commit; just reset local flags
        this.pendingClear = true;
        this.hasBufferedAudio = false;
        this.hasReceivedAudio = false;
        this.bufferedSamples = 0;
        this.setAgentState('thinking');
        break;

      case 'input_audio_buffer.committed':
        break;
      case 'input_audio_buffer.cleared':
        this.hasBufferedAudio = false;
        this.hasReceivedAudio = false;
        this.bufferedSamples = 0;
        this.pendingClear = false;
        break;

      case 'conversation.item.input_audio_transcription.delta':
        this.emit({
          type: 'transcript.delta',
          delta: message.delta,
          role: 'user',
          itemId: message.item_id
        });
        break;

      case 'conversation.item.input_audio_transcription.completed':
        this.emit({
          type: 'transcript.done',
          transcript: message.transcript,
          role: 'user',
          itemId: message.item_id
        });
        break;

      case 'response.created':
        this.markResponseCreated();
        this.setAgentState('thinking');
        this.emit({ type: 'response.created', id: message.response?.id });
        break;

      case 'response.audio.delta':
        this.setAgentState('speaking');
        this.emit({ type: 'audio.delta', delta: message.delta });
        break;

      case 'response.audio.done':
        this.emit({ type: 'audio.done' });
        break;

      case 'response.audio_transcript.delta':
        this.emit({
          type: 'transcript.delta',
          delta: message.delta,
          role: 'assistant',
          itemId: message.item_id
        });
        break;

      case 'response.audio_transcript.done':
        this.emit({
          type: 'transcript.done',
          transcript: message.transcript,
          role: 'assistant',
          itemId: message.item_id
        });
        break;

      // Newer Realtime event names (output_*). Mirror the legacy audio.* behavior.
      case 'response.output_audio.delta':
        this.setAgentState('speaking');
        this.emit({ type: 'audio.delta', delta: message.delta });
        break;

      case 'response.output_audio.done':
        this.emit({ type: 'audio.done' });
        break;

      case 'response.output_audio_transcript.delta':
        this.emit({
          type: 'transcript.delta',
          delta: message.delta,
          role: 'assistant',
          itemId: message.item_id
        });
        break;

      case 'response.output_audio_transcript.done':
        this.emit({
          type: 'transcript.done',
          transcript: message.transcript,
          role: 'assistant',
          itemId: message.item_id
        });
        break;

      case 'response.text.delta':
      case 'response.output_text.delta':
        console.log('📝 Text delta:', message.delta ?? message.text_delta);
        break;

      case 'response.text.done':
      case 'response.output_text.done':
        console.log('📝 Text done:', message.text ?? message.output_text);
        break;

      case 'response.output_item.added':
        console.log('🧩 Response item added:', message.item);
        break;

      case 'response.output_item.done':
        console.log('🧩 Response item done:', message.item);
        break;

      case 'response.content_part.added':
        console.log('🧩 Content part added:', message.part);
        break;

      case 'response.content_part.done':
        console.log('🧩 Content part done:', message.part);
        break;

      case 'response.function_call_arguments.delta':
        console.log('🛠️ Function call args delta:', message.delta);
        break;

      case 'response.function_call_arguments.done':
        console.log('🛠️ Function call args done:', {
          name: message.name,
          arguments: message.arguments
        });
        this.emit({
          type: 'function_call',
          call: {
            id: message.call_id,
            name: message.name,
            arguments: message.arguments
          }
        });
        break;

      case 'response.interrupted':
      case 'response.canceled':
      case 'response.cancelled': // handle both spellings just in case
        this.markResponseFinished();
        this.setAgentState('interrupted');
        this.emit({ type: 'interruption' });
        this.hasBufferedAudio = false;
        this.bufferedSamples = 0;
        break;

      case 'response.done':
        this.markResponseFinished();
        this.setAgentState('idle');
        this.emit({ type: 'response.done', response: message.response ?? message });
        break;

      case 'conversation.item.created':
        this.emit({ type: 'conversation.item.created', item: message.item });
        break;

      case 'rate_limits.updated':
        break;

      case 'error':
        console.error('Server error:', message.error);
        this.emit({ type: 'error', error: message.error.message || JSON.stringify(message.error) });
        break;

      default:
        console.log('Unhandled message type:', message.type);
        break;
    }
  }

  sendAudio(audioData: Int16Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (this.pendingClear) {
      this.hasBufferedAudio = false;
      this.bufferedSamples = 0;
      this.hasReceivedAudio = false;
      this.pendingClear = false;
      this.send({ type: 'input_audio_buffer.clear' });
    }

    const base64Audio = this.arrayBufferToBase64(audioData.buffer);
    this.hasBufferedAudio = true;
    this.bufferedSamples += audioData.length;
    this.hasReceivedAudio = true;
    this.send({
      type: 'input_audio_buffer.append',
      audio: base64Audio
    });
  }

  commitAudio(): void {
    if (!this.hasBufferedAudio || this.bufferedSamples < 2400 || !this.hasReceivedAudio) {
      console.warn('Skip commit: insufficient buffered audio', { bufferedSamples: this.bufferedSamples, hasReceivedAudio: this.hasReceivedAudio });
      return;
    }
    this.send({
      type: 'input_audio_buffer.commit'
    });
    this.hasBufferedAudio = false;
    this.bufferedSamples = 0;
    this.hasReceivedAudio = false;
  }

  clearAudioBuffer(): void {
    this.hasBufferedAudio = false;
    this.bufferedSamples = 0;
    this.hasReceivedAudio = false;
    this.pendingClear = false;
    this.send({
      type: 'input_audio_buffer.clear'
    });
  }

  sendFunctionCallOutput(callId: string, output: any): void {
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output)
      }
    });

    this.send({
      type: 'response.create'
    });
  }

  sendSystemMessage(text: string): void {
    if (!text || !text.trim()) {
      return;
    }
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: text.trim()
          }
        ]
      }
    });
  }

  cancelResponse(options?: { suppressState?: boolean }): void {
    if (!this.hasActiveResponse()) {
      console.warn('Cancel requested but no active response');
      return;
    }
    if (this.cancelPending) {
      console.warn('Cancel already in progress, ignoring duplicate');
      return;
    }
    this.hasBufferedAudio = false;
    this.bufferedSamples = 0;
    this.hasReceivedAudio = false;
    this.pendingClear = true;
    this.cancelPending = true;
    this.send({
      type: 'response.cancel'
    });
    if (!options?.suppressState) {
      this.setAgentState('interrupted');
    }
  }

  requestResponse(): void {
    this.send({
      type: 'response.create'
    });
  }

  private send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('Cannot send message, WebSocket not open. State:', this.ws?.readyState);
    }
  }

  on(eventType: RealtimeEvent['type'], handler: (event: any) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);
  }

  off(eventType: RealtimeEvent['type'], handler: (event: any) => void): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  private emit(event: RealtimeEvent): void {
    const handlers = this.eventHandlers.get(event.type);
    if (handlers) {
      handlers.forEach(handler => handler(event));
    }
  }

  private setAgentState(state: AgentState, reason?: string): void {
    if (this.agentState === state && !reason) return;
    this.agentState = state;
    this.emit({ type: 'agent_state', state, reason });
  }

  private markResponseCreated(): void {
    this.activeResponseCount = Math.max(0, this.activeResponseCount) + 1;
  }

  private markResponseFinished(): void {
    this.activeResponseCount = Math.max(0, this.activeResponseCount - 1);
    this.cancelPending = false;
  }

  private hasActiveResponse(): boolean {
    return this.activeResponseCount > 0;
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[RealtimeAPIClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      console.log('[RealtimeAPIClient] reconnect timer firing');
      this.connect().catch(error => {
        console.error('Reconnection failed:', error);
      });
    }, delay);
  }

  private arrayBufferToBase64(buffer: ArrayBuffer | ArrayBufferLike): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.sessionUpdateSent = false;
    this.pendingClear = true;
    this.hasReceivedAudio = false;
    this.hasBufferedAudio = false;
    this.bufferedSamples = 0;
    this.activeResponseCount = 0;
    this.cancelPending = false;
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch (error) {
        console.warn('Error closing WebSocket:', error);
      }
      this.ws = null;
    }
    this.eventHandlers.clear();
    this.agentState = 'idle';
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
