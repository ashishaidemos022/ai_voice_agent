import { getToolSchemas } from './tools-registry';
import { supabase } from './supabase';
import type { RagMode } from '../types/rag';

export type ChatRealtimeEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'error'; error: string }
  | { type: 'response.delta'; delta: string }
  | { type: 'response.completed'; text: string }
  | { type: 'response.started' }
  | { type: 'function_call'; call: { id: string; name: string; arguments: string } }
  | { type: 'usage.reported'; usage: any; model?: string };

export interface ChatRealtimeConfig {
  agentId: string;
  model: string;
  instructions: string;
  temperature?: number;
  maxTokens?: number;
  a2ui_enabled?: boolean;
  ragMode?: RagMode;
  ragEnabled?: boolean;
  vectorStoreIds?: string[];
}

export class ChatRealtimeClient {
  private config: ChatRealtimeConfig;
  private eventHandlers: Map<ChatRealtimeEvent['type'], Set<(event: any) => void>> = new Map();
  private connected = false;
  private input: any[] = [];
  private instructionsSuffix: string[] = [];
  private pendingOutputItems: any[] = [];
  private pendingCallIds = new Set<string>();
  private pendingToolOutputs: any[] = [];

  constructor(config: ChatRealtimeConfig) {
    this.config = config;
  }

  updateConfig(config: ChatRealtimeConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('You must be signed in to start a chat session');
    this.connected = true;
    this.emit({ type: 'connected' });
  }

  disconnect() {
    this.connected = false;
    this.input = [];
    this.instructionsSuffix = [];
    this.pendingOutputItems = [];
    this.pendingCallIds.clear();
    this.pendingToolOutputs = [];
    this.emit({ type: 'disconnected', reason: 'client-disconnected' });
    this.eventHandlers.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  sendUserMessage(text: string) {
    if (!this.connected || !text.trim()) return;
    this.input.push({ role: 'user', content: text.trim() });
    void this.createResponse();
  }

  sendToolOutput(callId: string, output: any) {
    if (!this.connected || !this.pendingCallIds.has(callId)) return;
    this.pendingToolOutputs.push({
      type: 'function_call_output',
      call_id: callId,
      output: JSON.stringify(output)
    });
    this.pendingCallIds.delete(callId);
    if (this.pendingCallIds.size === 0) {
      this.input.push(...this.pendingOutputItems, ...this.pendingToolOutputs);
      this.pendingOutputItems = [];
      this.pendingToolOutputs = [];
      void this.createResponse();
    }
  }

  sendSystemMessage(text: string) {
    if (text.trim()) this.instructionsSuffix.push(text.trim());
  }

  on<T extends ChatRealtimeEvent['type']>(eventType: T, handler: (event: Extract<ChatRealtimeEvent, { type: T }>) => void) {
    if (!this.eventHandlers.has(eventType)) this.eventHandlers.set(eventType, new Set());
    this.eventHandlers.get(eventType)!.add(handler as any);
  }

  off<T extends ChatRealtimeEvent['type']>(eventType: T, handler: (event: Extract<ChatRealtimeEvent, { type: T }>) => void) {
    this.eventHandlers.get(eventType)?.delete(handler as any);
  }

  private async createResponse(): Promise<void> {
    try {
      this.emit({ type: 'response.started' });
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
      const { data: { session } } = await supabase.auth.getSession();
      if (!supabaseUrl || !anonKey || !session?.access_token) throw new Error('Authenticated chat configuration is unavailable');

      const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/responses-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          agent_id: this.config.agentId,
          input: this.input,
          instructions_suffix: this.instructionsSuffix.join('\n\n') || undefined,
          tools: getToolSchemas()
        })
      });
      this.instructionsSuffix = [];
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message || json?.error || 'Responses request failed');

      const outputItems = Array.isArray(json.output) ? json.output : [];
      const functionCalls = outputItems.filter((item: any) => item?.type === 'function_call');
      if (functionCalls.length) {
        this.pendingOutputItems = outputItems;
        this.pendingCallIds = new Set(functionCalls.map((item: any) => item.call_id));
        functionCalls.forEach((item: any) => this.emit({
          type: 'function_call',
          call: { id: item.call_id, name: item.name, arguments: item.arguments || '{}' }
        }));
      } else {
        this.input.push(...outputItems);
        const text = (json.output_text || outputItems
          .flatMap((item: any) => item?.content || [])
          .filter((content: any) => content?.type === 'output_text')
          .map((content: any) => content.text || '')
          .join('')).trim();
        if (text) this.emit({ type: 'response.delta', delta: text });
        this.emit({ type: 'response.completed', text });
      }
      if (json.usage) this.emit({ type: 'usage.reported', usage: json.usage, model: json.model });
    } catch (error) {
      this.emit({ type: 'error', error: error instanceof Error ? error.message : 'Responses request failed' });
      this.emit({ type: 'response.completed', text: '' });
    }
  }

  private emit(event: ChatRealtimeEvent) {
    this.eventHandlers.get(event.type)?.forEach((handler) => handler(event as any));
  }
}
