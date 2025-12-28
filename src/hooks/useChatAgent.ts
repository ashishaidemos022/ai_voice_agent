import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentConfigPreset, getAllConfigPresets } from '../lib/config-service';
import {
  ChatMessage,
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

const MAX_CONTEXT_MESSAGES = 40;
const DEFAULT_REALTIME_MODEL = 'gpt-realtime';

function resolveChatRealtimeModel(preset: AgentConfigPreset): string {
  const candidate = (preset.chat_model || preset.model || DEFAULT_REALTIME_MODEL).trim();
  const normalized = candidate.toLowerCase();
  if (normalized.includes('realtime')) {
    return candidate;
  }
  return DEFAULT_REALTIME_MODEL;
}

export type ChatViewMode = 'current' | 'history';

export function useChatAgent() {
  const { vaUser } = useAuth();
  const [presets, setPresets] = useState<AgentConfigPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
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

  const realtimeRef = useRef<ChatRealtimeClient | null>(null);
  const sessionRef = useRef<ChatSession | null>(null);
  const responseStartMsRef = useRef<number | null>(null);
  const firstTokenRecordedRef = useRef(false);

  useEffect(() => {
    async function loadPresets() {
      try {
        const data = await getAllConfigPresets();
        setPresets(data);
        if (!activePresetId && data.length > 0) {
          setActivePresetId(data[0].id);
        }
      } catch (err) {
        console.error('Failed to load presets', err);
        setError('Unable to load agent presets');
      }
    }
    loadPresets();
  }, [activePresetId]);

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

  const handleAssistantCompleted = useCallback(async (text: string) => {
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
      createdAt: new Date().toISOString()
    };
    setMessages((prev) => [...prev, message].slice(-MAX_CONTEXT_MESSAGES));
    try {
      await insertChatMessage({
        sessionId: sessionRef.current.id,
        sender: 'assistant',
        message: finalText,
        streamed: true
      });
    } catch (err) {
      console.error('Failed to persist assistant message', err);
    }
  }, [liveAssistantText]);

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
      handleAssistantCompleted(evt.text);
    });
    client.on('response.started', () => {
      setIsStreaming(true);
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

      try {
        await updateChatToolEvent(pendingEvent.id, { status: 'running' });
        const result = await executeTool(event.call.name, parsedArgs, {
          chatSessionId: sessionRef.current.id
        });
        await updateChatToolEvent(pendingEvent.id, { status: 'succeeded', response: result });
        setToolEvents((prev) =>
          prev.map((tool) =>
            tool.id === pendingEvent.id ? { ...tool, status: 'succeeded', response: result } : tool
          )
        );
        client.sendToolOutput(event.call.id, result);
      } catch (toolErr: any) {
        const message = toolErr?.message ?? 'Tool execution failed';
        await updateChatToolEvent(pendingEvent.id, { status: 'failed', error: message });
        setToolEvents((prev) =>
          prev.map((tool) =>
            tool.id === pendingEvent.id ? { ...tool, status: 'failed', error: message } : tool
          )
        );
        client.sendToolOutput(event.call.id, { error: message });
      }
    });
  }, [handleAssistantCompleted, handleAssistantDelta]);

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

    try {
      const tools = await loadToolsForPreset(preset.id);
      setAvailableTools(tools);
      const newSession = await createChatSession({
        userId: vaUser.id,
        agentPresetId: preset.id,
        source: 'app'
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
        model: resolveChatRealtimeModel(preset),
        instructions: preset.instructions,
        temperature: preset.temperature,
        maxTokens: preset.max_response_output_tokens,
        ragMode: preset.rag_mode,
        ragEnabled: preset.rag_enabled,
        vectorStoreIds
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
  }, [activePresetId, attachRealtimeHandlers, cleanupRealtime, endSession, loadToolsForPreset, presets, refreshHistorySessions, vaUser]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!sessionRef.current || !realtimeRef.current) {
      setError('Start a chat session first');
      return;
    }

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
    const canRunRag = preset?.rag_enabled && hasKnowledgeSpaces && Boolean(realtimeRef.current);
    if (!preset?.rag_enabled) {
      console.debug('[RAG] Skipping augmentation - preset disabled', { presetId: preset?.id });
    } else if (!hasKnowledgeSpaces) {
      console.debug('[RAG] Skipping augmentation - no knowledge spaces attached', { presetId: preset?.id });
    }
    let ragContext: RagAugmentationResult | null = null;

    if (canRunRag) {
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
        setRagInvoked(true);
        setRagError(null);
        const knowledgeLines = ragContext.citations.map((citation, index) => {
          const label = `[${index + 1}]`;
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
    }

    responseStartMsRef.current = Date.now();
    firstTokenRecordedRef.current = false;
    realtimeRef.current.sendUserMessage(trimmed);
  }, [activePresetId, presets]);

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
    availableTools
  };
}
