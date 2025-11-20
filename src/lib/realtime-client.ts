import { RealtimeConfig } from '../types/voice-agent';
import { getToolSchemas } from './tools-registry';

export type RealtimeEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'error'; error: string }
  | { type: 'audio.delta'; delta: string }
  | { type: 'transcript.delta'; delta: string; role: 'user' | 'assistant' }
  | { type: 'transcript.done'; transcript: string; role: 'user' | 'assistant' }
  | { type: 'response.done'; response: any }
  | { type: 'function_call'; call: { id: string; name: string; arguments: string } }
  | { type: 'conversation.item.created'; item: any };

export class RealtimeAPIClient {
  private ws: WebSocket | null = null;
  private config: RealtimeConfig;
  private eventHandlers: Map<string, Set<(event: any) => void>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(config: RealtimeConfig) {
    this.config = config;
  }

  updateSessionConfig(newConfig: RealtimeConfig): void {
    this.config = newConfig;
    if (this.isConnected()) {
      this.sendSessionUpdate();
    }
  }

  async connect(): Promise<void> {
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
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

          this.emit({ type: 'disconnected', reason: event.reason });

          if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
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
            console.log('Received message:', message.type, message);
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

  sendSessionUpdate(): void {
    const tools = getToolSchemas();

    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: this.config.instructions,
        voice: this.config.voice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1',
          language: 'en'
        },
        turn_detection: this.config.turn_detection,
        tools,
        tool_choice: 'auto',
        temperature: this.config.temperature,
        max_response_output_tokens: this.config.max_response_output_tokens
      }
    };

    console.log('📤 Sending session.update with transcription enabled:', {
      hasTranscription: !!sessionConfig.session.input_audio_transcription,
      turnDetection: sessionConfig.session.turn_detection,
      voice: sessionConfig.session.voice,
      instructions: sessionConfig.session.instructions.substring(0, 50) + '...'
    });
    this.send(sessionConfig);
  }

  private handleServerMessage(message: any): void {
    switch (message.type) {
      case 'session.created':
        console.log('Session created successfully:', message);
        break;

      case 'session.updated':
        console.log('✅ Session updated successfully');
        console.log('📋 Session config:', {
          modalities: message.session?.modalities,
          inputTranscription: message.session?.input_audio_transcription,
          turnDetection: message.session?.turn_detection
        });
        break;

      case 'response.audio.delta':
        this.emit({ type: 'audio.delta', delta: message.delta });
        break;

      case 'conversation.item.input_audio_transcription.completed':
        console.log('✅ USER TRANSCRIPT COMPLETED:', message.transcript);
        this.emit({
          type: 'transcript.done',
          transcript: message.transcript,
          role: 'user'
        });
        break;

      case 'response.audio_transcript.delta':
        console.log('📝 ASSISTANT TRANSCRIPT DELTA:', message.delta);
        this.emit({
          type: 'transcript.delta',
          delta: message.delta,
          role: 'assistant'
        });
        break;

      case 'response.audio_transcript.done':
        console.log('✅ ASSISTANT TRANSCRIPT COMPLETED:', message.transcript);
        this.emit({
          type: 'transcript.done',
          transcript: message.transcript,
          role: 'assistant'
        });
        break;

      case 'response.done':
        this.emit({ type: 'response.done', response: message.response });
        break;

      case 'response.function_call_arguments.done':
        this.emit({
          type: 'function_call',
          call: {
            id: message.call_id,
            name: message.name,
            arguments: message.arguments
          }
        });
        break;

      case 'conversation.item.created':
        this.emit({ type: 'conversation.item.created', item: message.item });
        break;

      case 'input_audio_buffer.speech_started':
        console.log('User started speaking');
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('User stopped speaking');
        break;

      case 'input_audio_buffer.committed':
        console.log('Audio buffer committed');
        break;

      case 'response.created':
        console.log('Response created');
        break;

      case 'response.output_item.added':
        console.log('Output item added');
        break;

      case 'response.output_item.done':
        console.log('Output item done');
        break;

      case 'response.content_part.added':
        console.log('Content part added');
        break;

      case 'response.content_part.done':
        console.log('Content part done');
        break;

      case 'response.audio.done':
        console.log('Audio playback done');
        break;

      case 'rate_limits.updated':
        break;

      case 'conversation.item.input_audio_transcription.delta':
        console.log('📝 User transcript delta:', message.delta);
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
      console.warn('WebSocket not connected');
      return;
    }

    const base64Audio = this.arrayBufferToBase64(audioData.buffer);
    this.send({
      type: 'input_audio_buffer.append',
      audio: base64Audio
    });
  }

  commitAudio(): void {
    this.send({
      type: 'input_audio_buffer.commit'
    });
  }

  clearAudioBuffer(): void {
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

  cancelResponse(): void {
    this.send({
      type: 'response.cancel'
    });
  }

  private send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('Sending message:', message.type);
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('Cannot send message, WebSocket not open. State:', this.ws?.readyState);
    }
  }

  on(eventType: string, handler: (event: any) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);
  }

  off(eventType: string, handler: (event: any) => void): void {
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

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(error => {
        console.error('Reconnection failed:', error);
      });
    }, delay);
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  disconnect(): void {
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
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
