import { getToolSchemas } from './tools-registry';

export type ChatRealtimeEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'error'; error: string }
  | { type: 'response.delta'; delta: string }
  | { type: 'response.completed'; text: string }
  | { type: 'response.started' }
  | { type: 'function_call'; call: { id: string; name: string; arguments: string } };

export interface ChatRealtimeConfig {
  model: string;
  instructions: string;
  temperature?: number;
  maxTokens?: number;
}

export class ChatRealtimeClient {
  private ws: WebSocket | null = null;
  private config: ChatRealtimeConfig;
  private eventHandlers: Map<ChatRealtimeEvent['type'], Set<(event: any) => void>> = new Map();
  private isConnecting = false;
  private intentionalClose = false;

  constructor(config: ChatRealtimeConfig) {
    this.config = config;
  }

  updateConfig(config: ChatRealtimeConfig) {
    this.config = config;
    if (this.isConnected()) {
      this.sendSessionUpdate();
    }
  }

  async connect(): Promise<void> {
    if (this.isConnecting || this.isConnected()) {
      return;
    }
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OpenAI API key');
    }

    this.isConnecting = true;
    this.intentionalClose = false;

    await new Promise<void>((resolve, reject) => {
      try {
        const wsUrl = `wss://api.openai.com/v1/realtime?model=${this.config.model}`;
        this.ws = new WebSocket(wsUrl, [
          'realtime',
          `openai-insecure-api-key.${apiKey}`,
          'openai-beta.realtime-v1'
        ]);

        this.ws.onopen = () => {
          this.isConnecting = false;
          this.emit({ type: 'connected' });
          this.sendSessionUpdate();
          resolve();
        };

        this.ws.onerror = (event) => {
          this.isConnecting = false;
          console.error('[ChatRealtimeClient] socket error', event);
          this.emit({ type: 'error', error: 'Realtime socket error' });
          reject(event);
        };

        this.ws.onclose = (event) => {
          this.isConnecting = false;
          this.emit({ type: 'disconnected', reason: event.reason });
          if (!this.intentionalClose) {
            console.warn('[ChatRealtimeClient] socket closed unexpectedly', event);
          }
        };

        this.ws.onmessage = (rawEvent) => {
          try {
            const message = JSON.parse(rawEvent.data);
            this.handleServerMessage(message);
          } catch (err) {
            console.error('[ChatRealtimeClient] failed to parse server message', err);
          }
        };
      } catch (err) {
        this.isConnecting = false;
        reject(err);
      }
    });
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.ws.close();
    }
    this.ws = null;
    this.eventHandlers.clear();
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  sendUserMessage(text: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.emit({ type: 'response.started' });
    this.ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }]
      }
    }));
    this.ws.send(JSON.stringify({ type: 'response.create', response: { modalities: ['text'] } }));
  }

  sendToolOutput(callId: string, output: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output)
      }
    }));
    this.ws.send(JSON.stringify({ type: 'response.create', response: { modalities: ['text'] } }));
  }

  on<T extends ChatRealtimeEvent['type']>(eventType: T, handler: (event: Extract<ChatRealtimeEvent, { type: T }>) => void) {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler as any);
  }

  off<T extends ChatRealtimeEvent['type']>(eventType: T, handler: (event: Extract<ChatRealtimeEvent, { type: T }>) => void) {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.delete(handler as any);
    }
  }

  private sendSessionUpdate() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const tools = getToolSchemas();
    const payload = {
      type: 'session.update',
      session: {
        modalities: ['text'],
        instructions: this.config.instructions,
        tool_choice: 'auto',
        tools,
        temperature: this.config.temperature ?? 0.6,
        max_response_output_tokens: this.config.maxTokens ?? 1024
      }
    };
    this.ws.send(JSON.stringify(payload));
  }

  private handleServerMessage(message: any) {
    switch (message.type) {
      case 'session.updated':
        break;
      case 'response.created':
        this.emit({ type: 'response.started' });
        break;
      case 'response.output_text.delta':
        this.emit({ type: 'response.delta', delta: message.delta });
        break;
      case 'response.output_text.done':
        this.emit({ type: 'response.completed', text: message.output_text || message.text || '' });
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
      case 'error':
        this.emit({ type: 'error', error: message.error?.message || 'Realtime error' });
        break;
      case 'close':
      case 'response.completed':
      case 'response.done':
        if (message.response?.output) {
          const finalText = message.response.output
            .filter((item: any) => item.content)
            .map((item: any) => item.content?.map((c: any) => c.text || '').join(''))
            .join('')
            .trim();
          if (finalText) {
            this.emit({ type: 'response.completed', text: finalText });
          }
        }
        break;
      default:
        break;
    }
  }

  private emit(event: ChatRealtimeEvent) {
    const handlers = this.eventHandlers.get(event.type);
    if (!handlers) return;
    handlers.forEach(handler => handler(event as any));
  }
}
