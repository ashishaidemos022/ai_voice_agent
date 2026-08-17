import { getToolSchemas } from './tools-registry';
import { supabase } from './supabase';
import type { RagMode } from '../types/rag';
import type {
  ChatRouteDecision,
  ChatRoutingModel,
  ChatRoutingStrategy
} from '../../shared/model-routing';

export type ChatRealtimeEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'error'; error: string }
  | { type: 'response.delta'; delta: string }
  | { type: 'response.completed'; text: string; route?: ChatRouteDecision }
  | { type: 'response.started' }
  | { type: 'routing.selected'; route: ChatRouteDecision }
  | { type: 'function_call'; call: { id: string; name: string; arguments: string } }
  | { type: 'usage.reported'; usage: unknown; model?: string; route?: ChatRouteDecision };

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
  sessionId: string;
  routingStrategy: ChatRoutingStrategy;
  fixedModel: ChatRoutingModel;
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
  private activeTurnId: string | null = null;
  private activeRoute: ChatRouteDecision | null = null;

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
    this.activeTurnId = null;
    this.activeRoute = null;
    this.emit({ type: 'disconnected', reason: 'client-disconnected' });
    this.eventHandlers.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  sendUserMessage(text: string, ragCost?: { total: number; model: number; tool: number }) {
    if (!this.connected || !text.trim()) return;
    this.activeTurnId = crypto.randomUUID();
    this.activeRoute = null;
    if (ragCost && ragCost.total > 0) {
      this.activeRoute = {
        turnId: this.activeTurnId,
        strategy: this.config.routingStrategy,
        model: this.config.fixedModel,
        reasoningEffort: 'none',
        reasonCode: 'pending_route',
        reason: 'Route pending.',
        policyVersion: 'chat-router-v1',
        taskType: 'grounded_answer',
        complexity: 0,
        confidence: 0,
        requiresTools: false,
        consequential: false,
        ragCostUsd: ragCost.total,
        ragModelCostUsd: ragCost.model,
        ragToolCostUsd: ragCost.tool
      };
    }
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
          session_id: this.config.sessionId,
          turn_id: this.activeTurnId,
          routing_strategy: this.config.routingStrategy,
          fixed_model: this.config.fixedModel,
          route_decision: this.activeRoute?.reasonCode === 'pending_route' ? undefined : this.activeRoute,
          input: this.input,
          instructions_suffix: this.instructionsSuffix.join('\n\n') || undefined,
          tools: getToolSchemas()
        })
      });
      this.instructionsSuffix = [];
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message || json?.error || 'Responses request failed');

      const responseRoute = json._routing as ChatRouteDecision | undefined;
      if (responseRoute) {
        if (!this.activeRoute || this.activeRoute.reasonCode === 'pending_route') {
          this.activeRoute = {
            ...responseRoute,
            ragCostUsd: this.activeRoute?.ragCostUsd,
            ragModelCostUsd: this.activeRoute?.ragModelCostUsd,
            ragToolCostUsd: this.activeRoute?.ragToolCostUsd
          };
          this.emit({ type: 'routing.selected', route: this.activeRoute });
        } else {
          this.activeRoute = {
            ...this.activeRoute,
            answerLatencyMs: (this.activeRoute.answerLatencyMs || 0) + (responseRoute.answerLatencyMs || 0),
            answerCostUsd: (this.activeRoute.answerCostUsd || 0) + (responseRoute.answerCostUsd || 0),
            inputTokens: (this.activeRoute.inputTokens || 0) + (responseRoute.inputTokens || 0),
            cachedInputTokens: (this.activeRoute.cachedInputTokens || 0) + (responseRoute.cachedInputTokens || 0),
            outputTokens: (this.activeRoute.outputTokens || 0) + (responseRoute.outputTokens || 0)
          };
        }
      }

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
        this.emit({ type: 'response.completed', text, route: this.activeRoute || undefined });
      }
      if (json.usage) this.emit({ type: 'usage.reported', usage: json.usage, model: json.model, route: this.activeRoute || undefined });
    } catch (error) {
      this.emit({ type: 'error', error: error instanceof Error ? error.message : 'Responses request failed' });
      this.emit({ type: 'response.completed', text: '', route: this.activeRoute || undefined });
    }
  }

  private emit(event: ChatRealtimeEvent) {
    this.eventHandlers.get(event.type)?.forEach((handler) => handler(event as any));
  }
}
