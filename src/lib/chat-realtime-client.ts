import { getToolSchemas } from './tools-registry';
import { supabase } from './supabase';
import { MEMORY_TOOL_NAMES, type MemoryReceipt } from '../../shared/agent-memory';
import type { RagMode } from '../types/rag';
import type {
  ChatFixedModel,
  ChatRouteDecision,
  ChatRoutingStrategy
} from '../../shared/model-routing';
import { trainedCheckpointId } from '../../shared/model-routing';
import type { VoiceAdapterCheckpoint } from '../types/agent-model-policy';
import { estimateInklingSmallCostUsd } from './model-route-metrics';

export type ChatRealtimeEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'error'; error: string }
  | { type: 'response.delta'; delta: string }
  | { type: 'response.completed'; text: string; route?: ChatRouteDecision; memory?: MemoryReceipt }
  | { type: 'memory.updated'; memory: MemoryReceipt }
  | { type: 'response.started'; turnId: string | null }
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
  fixedModel: ChatFixedModel;
  fixedCheckpoint?: VoiceAdapterCheckpoint | null;
}

export type ChatTurnContext = {
  /** performance.now() when the user sent the turn, before any knowledge retrieval. */
  startedAt?: number;
  rag?: { costUsd: number; modelCostUsd: number; toolCostUsd: number; latencyMs: number };
};

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
  private activeMemory: MemoryReceipt | undefined;
  private activeTurnContext: ChatTurnContext = {};
  private responseCount = 0;

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

  sendUserMessage(text: string, turnContext: ChatTurnContext = {}) {
    if (!this.connected || !text.trim()) return;
    this.activeTurnId = crypto.randomUUID();
    this.activeMemory = undefined;
    this.responseCount = 0;
    this.activeRoute = null;
    this.activeTurnContext = { ...turnContext, startedAt: turnContext.startedAt ?? performance.now() };
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

  clearTurnContext() { this.instructionsSuffix = []; }

  on<T extends ChatRealtimeEvent['type']>(eventType: T, handler: (event: Extract<ChatRealtimeEvent, { type: T }>) => void) {
    if (!this.eventHandlers.has(eventType)) this.eventHandlers.set(eventType, new Set());
    this.eventHandlers.get(eventType)!.add(handler as any);
  }

  off<T extends ChatRealtimeEvent['type']>(eventType: T, handler: (event: Extract<ChatRealtimeEvent, { type: T }>) => void) {
    this.eventHandlers.get(eventType)?.delete(handler as any);
  }

  private async createResponse(): Promise<void> {
    try {
      if (++this.responseCount > 12) throw new Error('This turn reached its tool-call limit. Please start a new chat to continue.');
      this.emit({ type: 'response.started', turnId: this.activeTurnId });
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
      const { data: { session } } = await supabase.auth.getSession();
      if (!supabaseUrl || !anonKey || !session?.access_token) throw new Error('Authenticated chat configuration is unavailable');

      const checkpointId = this.config.routingStrategy === 'fixed'
        ? trainedCheckpointId(this.config.fixedModel)
        : null;
      if (checkpointId) {
        await this.createCheckpointResponse(checkpointId, session.access_token);
        return;
      }

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
          route_decision: this.activeRoute || undefined,
          input: this.input,
          instructions_suffix: this.instructionsSuffix.join('\n\n') || undefined,
          tools: getToolSchemas()
        })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message || json?.error || 'Responses request failed');
      if (!this.connected) return;
      if (json._memory) {
        this.activeMemory = json._memory;
        this.emit({ type: 'memory.updated', memory: json._memory });
      }

      const responseRoute = json._routing as ChatRouteDecision | undefined;
      if (responseRoute) {
        if (!this.activeRoute) {
          this.activeRoute = responseRoute;
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
        functionCalls.forEach((item: any) => {
          if (MEMORY_TOOL_NAMES.has(item.name)) {
            const result = (json._memory_tool_outputs || []).find((output: any) => output.call_id === item.call_id);
            this.sendToolOutput(item.call_id, result?.output || { error: 'Server memory result unavailable' });
          } else this.emit({ type: 'function_call', call: { id: item.call_id, name: item.name, arguments: item.arguments || '{}' } });
        });
      } else {
        this.instructionsSuffix = [];
        this.input.push(...outputItems);
        const text = (json.output_text || outputItems
          .flatMap((item: any) => item?.content || [])
          .filter((content: any) => content?.type === 'output_text')
          .map((content: any) => content.text || '')
          .join('')).trim();
        if (text) this.emit({ type: 'response.delta', delta: text });
        this.completeTurnRoute();
        this.emit({ type: 'response.completed', text, route: this.activeRoute || undefined, memory: this.activeMemory });
      }
      if (json.usage) this.emit({ type: 'usage.reported', usage: json.usage, model: json.model, route: this.activeRoute || undefined });
    } catch (error) {
      this.instructionsSuffix = [];
      this.completeTurnRoute();
      this.emit({ type: 'error', error: error instanceof Error ? error.message : 'Responses request failed' });
      this.emit({ type: 'response.completed', text: '', route: this.activeRoute || undefined, memory: this.activeMemory });
    }
  }

  private checkpointMessages(): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    const system = [this.config.instructions, ...this.instructionsSuffix].filter(Boolean).join('\n\n');
    if (system) messages.push({ role: 'system', content: system });
    for (const item of this.input.slice(-40)) {
      if (item?.role !== 'user' && item?.role !== 'assistant') continue;
      const content = typeof item.content === 'string'
        ? item.content
        : Array.isArray(item.content)
          ? item.content.map((part: { text?: string } | null) => part?.text || '').join('')
          : '';
      if (content.trim()) messages.push({ role: item.role, content: content.trim() });
    }
    return messages;
  }

  private async createCheckpointResponse(checkpointId: string, accessToken: string): Promise<void> {
    const checkpoint = this.config.fixedCheckpoint;
    if (!checkpoint || checkpoint.id !== checkpointId) throw new Error('The selected trained checkpoint is unavailable.');
    const startedAt = performance.now();
    const response = await fetch(`/api/open-weight-training?jobId=${encodeURIComponent(checkpointId)}&action=completion`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: this.checkpointMessages(),
        temperature: this.config.temperature ?? 0,
        max_tokens: Math.min(this.config.maxTokens || 256, 1024)
      })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || `Checkpoint request failed (${response.status})`);
    if (!this.connected) return;
    const text = String(json.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('The trained checkpoint returned an empty answer.');
    const inputTokens = Number.isFinite(json.usage?.prompt_tokens) ? json.usage.prompt_tokens : 0;
    const outputTokens = Number.isFinite(json.usage?.completion_tokens) ? json.usage.completion_tokens : 0;
    const reportedCost = Number.isFinite(json.viaana?.cost_usd) ? json.viaana.cost_usd : null;
    const estimatedCost = checkpoint.backend === 'tinker'
      ? estimateInklingSmallCostUsd(inputTokens, outputTokens)
      : null;
    const route: ChatRouteDecision = {
      turnId: this.activeTurnId || crypto.randomUUID(),
      strategy: 'fixed',
      routeKind: 'trained_checkpoint',
      model: json.model || (checkpoint.backend === 'tinker' ? 'thinkingmachines/Inkling-Small' : 'private-checkpoint'),
      checkpointId: checkpoint.id,
      checkpointName: checkpoint.name,
      checkpointBackend: checkpoint.backend,
      taskType: 'grounded_answer',
      complexity: 0,
      confidence: 1,
      requiresTools: false,
      consequential: false,
      reasoningEffort: 'none',
      reasonCode: 'fixed_trained_checkpoint_selected',
      reason: `Auto routing is disabled, so this turn used the selected trained checkpoint “${checkpoint.name}”.`,
      policyVersion: 'chat-router-v1',
      answerLatencyMs: Math.round(performance.now() - startedAt),
      answerCostUsd: reportedCost ?? estimatedCost ?? 0,
      inputTokens,
      outputTokens,
      cachedInputTokens: 0,
      costKind: reportedCost != null ? 'reported' : estimatedCost != null ? 'estimated' : 'unavailable'
    };
    this.activeRoute = route;
    this.completeTurnRoute();
    this.instructionsSuffix = [];
    this.input.push({ role: 'assistant', content: text });
    this.emit({ type: 'routing.selected', route: this.activeRoute });
    this.emit({ type: 'response.delta', delta: text });
    this.emit({ type: 'response.completed', text, route: this.activeRoute, memory: this.activeMemory });
    this.emit({ type: 'usage.reported', usage: json.usage, model: route.model, route: this.activeRoute });
  }

  /** Stamps retrieval cost/latency and end-to-end turn time onto the route when the turn finishes. */
  private completeTurnRoute() {
    if (!this.activeRoute) return;
    const { rag, startedAt } = this.activeTurnContext;
    this.activeRoute = {
      ...this.activeRoute,
      ...(rag ? {
        ragCostUsd: rag.costUsd,
        ragModelCostUsd: rag.modelCostUsd,
        ragToolCostUsd: rag.toolCostUsd,
        ragLatencyMs: rag.latencyMs
      } : {}),
      ...(startedAt != null ? { turnLatencyMs: Math.round(performance.now() - startedAt) } : {})
    };
  }

  private emit(event: ChatRealtimeEvent) {
    this.eventHandlers.get(event.type)?.forEach((handler) => handler(event as any));
  }
}
