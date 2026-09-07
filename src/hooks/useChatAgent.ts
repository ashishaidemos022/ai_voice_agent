import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentConfigPreset, getAllConfigPresets } from '../lib/config-service';
import {
  ChatMessage,
  AnswerSources,
  ChatSession,
  ChatToolEvent
} from '../types/chat';
import {
  completeChatSession,
  createChatSession,
  createChatToolEvent,
  insertChatMessage,
  loadChatMessages,
  loadRecentChatSessions,
  updateChatToolEvent
} from '../lib/chat-session-service';
import { ChatRealtimeClient } from '../lib/chat-realtime-client';
import { executeTool, getAllTools, loadMCPTools, type Tool } from '../lib/tools-registry';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { runRagAugmentation } from '../lib/rag-service';
import type { RagAugmentationResult } from '../types/rag';
import { OPENAI_MODELS, normalizeChatModel } from '../../shared/openai-models';
import type {
  ChatRouteDecision,
  ChatRoutingModel,
  ChatRoutingStrategy
} from '../../shared/model-routing';
import { shouldRunRagForTurn } from '../../shared/rag-routing';
import type { MemoryReceipt } from '../../shared/agent-memory';
import { memoryRequest } from '../lib/agent-memory-service';

const MAX_CONTEXT_MESSAGES = 40;
const DEFAULT_CHAT_MODEL = OPENAI_MODELS.chat.default;

function resolveChatRealtimeModel(preset: AgentConfigPreset): string {
  return normalizeChatModel(preset.chat_model || preset.model || DEFAULT_CHAT_MODEL);
}

export type ChatViewMode = 'current' | 'history';

export function useChatAgent(channel?: 'routed_voice', initialPresetId?: string | null) {
  const { vaUser } = useAuth();
  const [presets, setPresets] = useState<AgentConfigPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(initialPresetId || null);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historySessions, setHistorySessions] = useState<ChatSession[]>([]);
  const [historicalMessages, setHistoricalMessages] = useState<ChatMessage[]>([]);
  const [selectedHistorySessionId, setSelectedHistorySessionId] = useState<string | null>(null);
  const [toolEvents, setToolEvents] = useState<ChatToolEvent[]>([]);
  const [liveAssistantText, setLiveAssistantText] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [ragResult, setRagResult] = useState<RagAugmentationResult | null>(null);
  const [ragInvoked, setRagInvoked] = useState(false);
  const [ragError, setRagError] = useState<string | null>(null);
  const [isRagLoading, setIsRagLoading] = useState(false);
  const [availableTools, setAvailableTools] = useState<Tool[]>([]);
  const [routingStrategy, setRoutingStrategy] = useState<ChatRoutingStrategy>('auto');
  const [fixedModel, setFixedModel] = useState<ChatRoutingModel>(OPENAI_MODELS.chat.frontier);
  const [currentRoute, setCurrentRoute] = useState<ChatRouteDecision | null>(null);
  const [memorySubjectId, setMemorySubjectId] = useState<string | null>(null);
  const [memoryReceipt, setMemoryReceipt] = useState<MemoryReceipt | undefined>();
  const sendingRef = useRef(false);
  const sourcesRef = useRef<AnswerSources | undefined>();
  const [answerSources, setAnswerSources] = useState<AnswerSources>();
  const updateSources = useCallback((patch: Partial<AnswerSources>) => {
    if (!sourcesRef.current) return;
    sourcesRef.current = { ...sourcesRef.current, ...patch };
    setAnswerSources(sourcesRef.current);
  }, []);
  const recordSourceTool = useCallback((tool: ChatToolEvent) => {
    updateSources({ tools: [...(sourcesRef.current?.tools || []).filter(item => item.id !== tool.id), tool] });
  }, [updateSources]);

  const realtimeRef = useRef<ChatRealtimeClient | null>(null);
  const sessionRef = useRef<ChatSession | null>(null);
  const responseStartMsRef = useRef<number | null>(null);
  const firstTokenRecordedRef = useRef(false);

  const refreshSourceEvents = useCallback(async () => {
    const current = sourcesRef.current;
    const activeSession = sessionRef.current;
    if (!current?.turnId || !activeSession?.memorySubjectId) return;
    try {
      const result = await memoryRequest(activeSession.agentPresetId, activeSession.memorySubjectId, 'events', { session_id: activeSession.id }, AbortSignal.timeout(2000));
      if (sessionRef.current?.id !== activeSession.id || sourcesRef.current?.turnId !== current.turnId) return;
      const events = [...(sourcesRef.current.memoryEvents || []), ...(result.events || [])].filter(event => event.turn_id === current.turnId);
      updateSources({ memoryEvents: [...new Map(events.map(event => [event.id, event])).values()].sort((a, b) => a.created_at.localeCompare(b.created_at)) });
    } catch { /* An unavailable activity feed must not interrupt the answer. */ }
  }, [updateSources]);

  useEffect(() => {
    if (!isStreaming || !answerSources?.turnId) return;
    let inFlight = false;
    const timer = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try { await refreshSourceEvents(); } finally { inFlight = false; }
    }, 700);
    return () => window.clearInterval(timer);
  }, [isStreaming, answerSources?.turnId, refreshSourceEvents]);

  const refreshPresets = useCallback(async () => {
    try {
      const data = await getAllConfigPresets();
      setPresets(data);
      if (!activePresetId && data.length > 0) {
        setActivePresetId(data[0].id);
      } else if (activePresetId && !data.some((preset) => preset.id === activePresetId)) {
        setActivePresetId(data[0]?.id || null);
      }
    } catch (err) {
      console.error('Failed to load presets', err);
      setError('Unable to load agent presets');
    }
  }, [activePresetId]);

  useEffect(() => {
    refreshPresets();
  }, [refreshPresets]);

  const refreshHistorySessions = useCallback(async () => {
    if (!vaUser) return;
    try {
      const recent = await loadRecentChatSessions();
      setHistorySessions(recent);
    } catch (err) {
      console.error('Failed to load chat history', err);
    }
  }, [vaUser]);

  useEffect(() => {
    refreshHistorySessions();
  }, [refreshHistorySessions]);

  const loadToolsForPreset = useCallback(async (presetId: string): Promise<Tool[]> => {
    await loadMCPTools(presetId, vaUser?.id);
    return [...getAllTools()];
  }, [vaUser?.id]);

  const refreshTools = useCallback(async () => {
    if (!activePresetId || !vaUser) {
      setAvailableTools([]);
      return;
    }
    const tools = await loadToolsForPreset(activePresetId);
    setAvailableTools(tools);
  }, [activePresetId, loadToolsForPreset, vaUser]);

  useEffect(() => {
    if (!activePresetId || !vaUser) {
      setAvailableTools([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const tools = await loadToolsForPreset(activePresetId);
        if (!cancelled) {
          setAvailableTools(tools);
        }
      } catch (err) {
        console.error('Failed to load automation tools for preset', err);
        if (!cancelled) {
          setAvailableTools([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activePresetId, loadToolsForPreset, vaUser]);

  const cleanupRealtime = useCallback(() => {
    if (realtimeRef.current) {
      realtimeRef.current.disconnect();
      realtimeRef.current = null;
    }
    setIsConnected(false);
    setIsStreaming(false);
    setLiveAssistantText('');
    setCurrentRoute(null);
    setMemoryReceipt(undefined);
    sourcesRef.current = undefined;
    setAnswerSources(undefined);
    sendingRef.current = false;
    responseStartMsRef.current = null;
    firstTokenRecordedRef.current = false;
  }, [activePresetId, presets]);

  const endSession = useCallback(async () => {
    const activeSession = sessionRef.current;
    cleanupRealtime();
    setSession(null);
    setMessages([]);
    setRagResult(null);
    setRagError(null);
    setToolEvents([]);

    if (activeSession) {
      try {
        await completeChatSession(activeSession.id);
      } catch (err) {
        console.warn('Failed to complete chat session', err);
      }
    }
    sessionRef.current = null;
    refreshHistorySessions();
  }, [cleanupRealtime, refreshHistorySessions]);

  useEffect(() => {
    return () => {
      cleanupRealtime();
    };
  }, [cleanupRealtime]);

  const handleAssistantDelta = useCallback((delta: string) => {
    if (!delta) return;
    if (!firstTokenRecordedRef.current && responseStartMsRef.current && sessionRef.current) {
      firstTokenRecordedRef.current = true;
      const duration = Date.now() - responseStartMsRef.current;
      (async () => {
        try {
          await supabase
            .from('va_chat_sessions')
            .update({ first_token_ms: duration })
            .eq('id', sessionRef.current!.id);
        } catch (err) {
          console.warn('Failed to record first token time', err);
        }
      })();
    }
    setLiveAssistantText((prev) => `${prev}${delta}`);
  }, []);

  const handleAssistantCompleted = useCallback(async (text: string, route?: ChatRouteDecision, memory?: MemoryReceipt) => {
    const completingSessionId = sessionRef.current?.id;
    await refreshSourceEvents();
    if (sessionRef.current?.id !== completingSessionId) return;
    sendingRef.current = false;
    const finalText = (text || liveAssistantText).trim();
    setLiveAssistantText('');
    setIsStreaming(false);
    responseStartMsRef.current = null;
    firstTokenRecordedRef.current = false;

    if (!finalText || !sessionRef.current) return;
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      sessionId: sessionRef.current.id,
      sender: 'assistant',
      content: finalText,
      createdAt: new Date().toISOString(),
      raw: { routing: route, memory, sources: sourcesRef.current }
    };
    setMessages((prev) => [...prev, message].slice(-MAX_CONTEXT_MESSAGES));
    try {
      await insertChatMessage({
        sessionId: sessionRef.current.id,
        sender: 'assistant',
        message: finalText,
        raw: message.raw,
        streamed: true
      });
    } catch (err) {
      console.error('Failed to persist assistant message', err);
    }
  }, [liveAssistantText, refreshSourceEvents]);

  const attachRealtimeHandlers = useCallback((client: ChatRealtimeClient) => {
    client.on('connected', () => setIsConnected(true));
    client.on('disconnected', () => setIsConnected(false));
    client.on('error', (evt) => {
      console.error('Realtime error', evt.error);
      setError(evt.error);
    });
    client.on('response.delta', (evt) => {
      setIsStreaming(true);
      handleAssistantDelta(evt.delta);
    });
    client.on('response.completed', (evt) => {
      handleAssistantCompleted(evt.text, evt.route, evt.memory);
    });
    client.on('memory.updated', evt => setMemoryReceipt(evt.memory));
    client.on('response.started', (event) => {
      updateSources({ turnId: event.turnId || undefined });
      setIsStreaming(true);
    });
    client.on('routing.selected', (evt) => {
      setCurrentRoute(evt.route);
    });
    client.on('function_call', async (event) => {
      if (!sessionRef.current) return;
      let parsedArgs: Record<string, any> = {};
      try {
        parsedArgs = event.call.arguments ? JSON.parse(event.call.arguments) : {};
      } catch (err) {
        console.warn('Failed to parse tool args', err);
      }
      const pendingEvent = await createChatToolEvent({
        sessionId: sessionRef.current.id,
        toolName: event.call.name,
        request: parsedArgs
      });
      setToolEvents((prev) => [...prev, pendingEvent]);
      recordSourceTool(pendingEvent);

      try {
        await updateChatToolEvent(pendingEvent.id, { status: 'running' });
        const result = await executeTool(event.call.name, parsedArgs, {
          chatSessionId: sessionRef.current.id
        });
        if (result && typeof result === 'object' && 'error' in result && result.error) throw new Error(String(result.error));
        await updateChatToolEvent(pendingEvent.id, { status: 'succeeded', response: result });
        setToolEvents((prev) =>
          prev.map((tool) =>
            tool.id === pendingEvent.id ? { ...tool, status: 'succeeded', response: result } : tool
          )
        );
        recordSourceTool({ ...pendingEvent, status: 'succeeded', response: result });
        client.sendToolOutput(event.call.id, result);
      } catch (toolErr: any) {
        const message = toolErr?.message ?? 'Tool execution failed';
        await updateChatToolEvent(pendingEvent.id, { status: 'failed', error: message });
        setToolEvents((prev) =>
          prev.map((tool) =>
            tool.id === pendingEvent.id ? { ...tool, status: 'failed', error: message } : tool
          )
        );
        recordSourceTool({ ...pendingEvent, status: 'failed', error: message });
        client.sendToolOutput(event.call.id, { error: message });
      }
    });
  }, [handleAssistantCompleted, handleAssistantDelta, recordSourceTool, updateSources]);

  const startSession = useCallback(async () => {
    if (!vaUser) {
      setError('You must be signed in to start a chat session.');
      return;
    }
    if (!activePresetId) {
      setError('Select an agent preset before starting a chat session.');
      return;
    }
    if (sessionRef.current) {
      await endSession();
    }

    const preset = presets.find((p) => p.id === activePresetId);
    if (!preset) {
      setError('Selected preset is unavailable.');
      return;
    }

    setIsConnecting(true);
    setError(null);
    setMessages([]);
    setToolEvents([]);
    setLiveAssistantText('');
    setMemoryReceipt(undefined);

    try {
      const tools = await loadToolsForPreset(preset.id);
      setAvailableTools(tools);
      const newSession = await createChatSession({
        userId: vaUser.id,
        agentPresetId: preset.id,
        source: 'app',
        metadata: {
          ...(channel ? { channel } : {}),
          routing_strategy: routingStrategy,
          fixed_model: routingStrategy === 'fixed' ? fixedModel : null,
          routing_policy_version: 'chat-router-v1',
          memory_subject_id: memorySubjectId
        }
      });
      sessionRef.current = newSession;
      setSession(newSession);

      if (realtimeRef.current) {
        realtimeRef.current.disconnect();
      }

      const vectorStoreIds = (preset.knowledge_spaces || [])
        .map((binding) => binding.rag_space?.vector_store_id)
        .filter((id): id is string => Boolean(id));

      realtimeRef.current = new ChatRealtimeClient({
        agentId: preset.id,
        model: resolveChatRealtimeModel(preset),
        instructions: preset.instructions,
        temperature: preset.temperature,
        maxTokens: preset.max_response_output_tokens,
        a2ui_enabled: preset.a2ui_enabled ?? false,
        ragMode: preset.rag_mode,
        ragEnabled: preset.rag_enabled,
        vectorStoreIds,
        sessionId: newSession.id,
        routingStrategy,
        fixedModel
      });

      attachRealtimeHandlers(realtimeRef.current);
      await realtimeRef.current.connect();
    } catch (err: any) {
      console.error('Failed to start chat session', err);
      setError(err.message || 'Unable to start chat session');
      cleanupRealtime();
      sessionRef.current = null;
      setSession(null);
    } finally {
      setIsConnecting(false);
      refreshHistorySessions();
    }
  }, [activePresetId, attachRealtimeHandlers, cleanupRealtime, endSession, fixedModel, loadToolsForPreset, presets, refreshHistorySessions, routingStrategy, vaUser, memorySubjectId, channel]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!sessionRef.current || !realtimeRef.current) {
      setError('Start a chat session first');
      return;
    }
    if (sendingRef.current) return;
    sendingRef.current = true;
    setIsStreaming(true);
    setMemoryReceipt(undefined);
    setCurrentRoute(null);

    const outgoing: ChatMessage = {
      id: crypto.randomUUID(),
      sessionId: sessionRef.current.id,
      sender: 'user',
      content: trimmed,
      createdAt: new Date().toISOString()
    };

    setMessages((prev) => [...prev, outgoing].slice(-MAX_CONTEXT_MESSAGES));

    const preset = presets.find((p) => p.id === activePresetId);
    const hasKnowledgeSpaces = (preset?.knowledge_spaces?.length || 0) > 0;
    sourcesRef.current = {
      question: trimmed, instructions: preset?.instructions || '', rag: null, ragStatus: 'skipped', tools: [],
      carriedTools: [...(sourcesRef.current?.carriedTools || []), ...(sourcesRef.current?.tools || [])].filter(tool => tool.status === 'succeeded')
    };
    setAnswerSources(sourcesRef.current);
    const knowledgeNeeded = shouldRunRagForTurn(trimmed);
    const canRunRag = preset?.rag_enabled && hasKnowledgeSpaces && knowledgeNeeded && Boolean(realtimeRef.current);
    if (!preset?.rag_enabled) {
      console.debug('[RAG] Skipping augmentation - preset disabled', { presetId: preset?.id });
    } else if (!hasKnowledgeSpaces) {
      console.debug('[RAG] Skipping augmentation - no knowledge spaces attached', { presetId: preset?.id });
    } else if (!knowledgeNeeded) {
      console.debug('[RAG] Skipping augmentation - turn does not require knowledge retrieval', { presetId: preset?.id });
      setRagResult(null);
      setRagInvoked(false);
      setRagError(null);
    }
    realtimeRef.current?.clearTurnContext();
    let ragContext: RagAugmentationResult | null = null;

    if (canRunRag) {
      updateSources({ ragStatus: 'searching' });
      setIsRagLoading(true);
      try {
        const spaceIds = (preset!.knowledge_spaces || []).map((binding) => binding.space_id);
        console.log('[RAG] Starting augmentation', {
          presetId: preset!.id,
          sessionId: sessionRef.current.id,
          ragMode: preset!.rag_mode,
          spaceCount: spaceIds.length
        });

        ragContext = await runRagAugmentation({
          agentConfigId: preset!.id,
          query: trimmed,
          ragMode: preset!.rag_mode,
          spaceIds,
          conversationId: sessionRef.current.id
        });
        console.log('[RAG] Augmentation response', {
          presetId: preset!.id,
          guardrailTriggered: ragContext.guardrailTriggered,
          citations: ragContext.citations.length
        });
        setRagResult(ragContext);
        updateSources({ rag: ragContext, ragStatus: 'retrieved' });
        setRagInvoked(true);
        setRagError(null);
        const knowledgeLines = ragContext.citations.map((citation, index) => {
          const label = `[K${index + 1}]`;
          const title = citation.title ? ` • ${citation.title}` : '';
          return `${label} ${citation.snippet}${title}`;
        });
        if (knowledgeLines.length) {
          const contextMessage = `Knowledge retrieved for this turn:\n${knowledgeLines.join('\n')}\nUse these citations when answering. If information is missing and you are in guardrail mode, decline gracefully.`;
          realtimeRef.current?.sendSystemMessage(contextMessage);
        }
      } catch (err: any) {
        console.error('[RAG] Augmentation failed', err);
        setRagError(err.message || 'Knowledge search failed');
        updateSources({ ragStatus: 'failed' });
        setRagResult(null);
        setRagInvoked(true);
      } finally {
        setIsRagLoading(false);
      }
    } else {
      setRagResult(null);
      setRagError(null);
      setRagInvoked(false);
    }

    try {
      await insertChatMessage({
        sessionId: sessionRef.current.id,
        sender: 'user',
        message: trimmed
      });
    } catch (err) {
      console.error('Failed to persist user message', err);
      if (memorySubjectId) {
        setError('Could not save your message. Memory requires a saved source; please try again.');
        sendingRef.current = false;
        setIsStreaming(false);
        realtimeRef.current?.clearTurnContext();
        return;
      }
    }

    responseStartMsRef.current = Date.now();
    firstTokenRecordedRef.current = false;
    realtimeRef.current.sendUserMessage(trimmed, ragContext?.estimatedCostUsd
      ? {
          total: ragContext.estimatedCostUsd,
          model: ragContext.modelCostUsd || 0,
          tool: ragContext.toolCostUsd || 0
        }
      : undefined);
  }, [activePresetId, presets, memorySubjectId, updateSources]);

  const loadHistoricalSession = useCallback(async (sessionId: string) => {
    setIsHistoryLoading(true);
    setHistoryError(null);
    setHistoricalMessages([]);
    setSelectedHistorySessionId(sessionId);
    try {
      const data = await loadChatMessages(sessionId);
      setHistoricalMessages(data);
    } catch (err) {
      console.error('Failed to load session history', err);
      setHistoryError('Unable to load session messages.');
    } finally {
      setIsHistoryLoading(false);
    }
  }, []);

  const clearHistorySelection = useCallback(() => {
    setSelectedHistorySessionId(null);
    setHistoricalMessages([]);
    setHistoryError(null);
  }, []);

  return {
    presets,
    activePresetId,
    setActivePresetId,
    refreshPresets,
    session,
    messages,
    historySessions,
    historicalMessages,
    selectedHistorySessionId,
    loadHistoricalSession,
    clearHistorySelection,
    toolEvents,
    liveAssistantText,
    isConnecting,
    isStreaming,
    isConnected,
    error,
    historyError,
    isHistoryLoading,
    startSession,
    sendMessage,
    endSession,
    ragResult,
    ragInvoked,
    ragError,
    isRagLoading,
    availableTools,
    refreshTools,
    routingStrategy,
    setRoutingStrategy,
    fixedModel,
    setFixedModel,
    currentRoute,
    memorySubjectId, setMemorySubjectId, memoryReceipt, answerSources
  };
}
