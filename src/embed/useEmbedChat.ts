import { useCallback, useEffect, useMemo, useState } from 'react';

export type EmbedMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

export type EmbedAgentMeta = {
  id?: string | null;
  name: string;
  summary?: string | null;
  ragEnabled?: boolean;
  ragMode?: RagMode;
  knowledgeSpaceIds?: string[];
};

export type ChatEmbedAppearance = {
  logo_url?: string | null;
  brand_name?: string | null;
  accent_color?: string | null;
  background_color?: string | null;
  surface_color?: string | null;
  text_color?: string | null;
  button_color?: string | null;
  button_text_color?: string | null;
  helper_text_color?: string | null;
  corner_radius?: number | null;
  font_family?: string | null;
  wave_color?: string | null;
  bubble_color?: string | null;
  logo_background_color?: string | null;
  widget_width?: number | null;
  widget_height?: number | null;
  button_image_url?: string | null;
};

type RagMode = 'assist' | 'guardrail';

type RagCitation = {
  snippet: string;
  title?: string | null;
};

type RagAugmentationResult = {
  citations: RagCitation[];
  guardrailTriggered?: boolean;
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase environment variables for embed widget');
}

const AGENT_CHAT_URL = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/agent-chat`;
const RAG_SERVICE_URL = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/rag-service`;
const SUPABASE_REQUEST_HEADERS = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`
};

function createStorageKey(publicId: string) {
  return `va-embed-history-${publicId}`;
}

async function runEmbedRagAugmentation(input: {
  agentConfigId: string;
  query: string;
  ragMode: RagMode;
  spaceIds: string[];
  conversationId?: string;
}): Promise<RagAugmentationResult | null> {
  if (!input.spaceIds.length) {
    throw new Error('No knowledge spaces connected');
  }
  const res = await fetch(RAG_SERVICE_URL, {
    method: 'POST',
    headers: SUPABASE_REQUEST_HEADERS,
    body: JSON.stringify({
      action: 'run_query',
      agent_config_id: input.agentConfigId,
      query: input.query,
      space_ids: input.spaceIds,
      rag_mode: input.ragMode,
      conversation_id: input.conversationId
    })
  });
  const json = await res.json();
  if (res.status === 401) {
    console.warn('[embed-chat] RAG service unauthorized for embed client');
    return null;
  }
  if (!res.ok) {
    throw new Error(json?.error || 'RAG service call failed');
  }
  return {
    citations: json?.citations || [],
    guardrailTriggered: Boolean(json?.guardrail_triggered)
  };
}

export function useEmbedChat(publicId: string, options?: { persist?: boolean }) {
  const [messages, setMessages] = useState<EmbedMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [agentMeta, setAgentMeta] = useState<EmbedAgentMeta | null>(null);
  const [appearance, setAppearance] = useState<ChatEmbedAppearance | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storageKey = useMemo(() => (options?.persist ? createStorageKey(publicId) : null), [publicId, options?.persist]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.messages)) {
        setMessages(parsed.messages);
      }
      if (parsed.sessionId) {
        setSessionId(parsed.sessionId);
      }
    } catch (err) {
      console.warn('Failed to hydrate embed chat history', err);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const payload = JSON.stringify({ sessionId, messages });
      localStorage.setItem(storageKey, payload);
    } catch (err) {
      console.warn('Failed to persist embed chat history', err);
    }
  }, [messages, sessionId, storageKey]);

  const loadMetadata = useCallback(async () => {
    setIsLoadingMeta(true);
    try {
      const url = new URL(AGENT_CHAT_URL);
      url.searchParams.set('public_id', publicId);
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: SUPABASE_REQUEST_HEADERS
      });
      if (!response.ok) {
        throw new Error('Embed not found');
      }
      const json = await response.json();
      const knowledgeSpaceIds = Array.isArray(json.agent?.knowledge_spaces)
        ? json.agent.knowledge_spaces
            .map((space: any) => space?.space_id)
            .filter((id: any): id is string => Boolean(id))
        : [];
      setAgentMeta({
        id: json.agent?.id,
        name: json.agent?.name || 'AI Agent',
        summary: json.agent?.summary || null,
        ragEnabled: Boolean(json.agent?.rag_enabled),
        ragMode: json.agent?.rag_mode || 'assist',
        knowledgeSpaceIds
      });
      setAppearance((json?.settings?.appearance as ChatEmbedAppearance) || null);
    } catch (err: any) {
      setAgentMeta({
        name: 'AI Agent',
        summary: err?.message || 'Unable to load agent metadata'
      });
    } finally {
      setIsLoadingMeta(false);
    }
  }, [publicId]);

  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const id = crypto.randomUUID();
      const pendingMessage: EmbedMessage = { id, role: 'user', content: trimmed };

      // Apply optimistic UI update
      setMessages((prev) => [...prev, pendingMessage]);

      setIsSending(true);
      setError(null);
      try {
        const baseHistory = [...messages, pendingMessage];
        const payloadMessages: { role: 'user' | 'assistant' | 'system'; content: string }[] =
          baseHistory.map((message) => ({
            role: message.role,
            content: message.content
          }));

        const shouldRunRag =
          agentMeta?.ragEnabled && (agentMeta.knowledgeSpaceIds?.length || 0) > 0 && Boolean(agentMeta.id);

        if (shouldRunRag) {
          try {
            const ragContext = await runEmbedRagAugmentation({
              agentConfigId: agentMeta!.id as string,
              query: trimmed,
              ragMode: agentMeta!.ragMode || 'assist',
              spaceIds: agentMeta!.knowledgeSpaceIds || [],
              conversationId: sessionId || undefined
            });
            if (!ragContext) {
              console.warn('[embed-chat] RAG unavailable; continuing without augmentation');
            }
            if (ragContext) {
              const knowledgeLines = ragContext.citations.map((citation: RagCitation, index: number) => {
                const label = `[${index + 1}]`;
                const title = citation.title ? ` • ${citation.title}` : '';
                return `${label} ${citation.snippet}${title}`;
              });
              if (knowledgeLines.length) {
                const contextMessage = `Knowledge retrieved for this turn:\n${knowledgeLines.join(
                  '\n'
                )}\nUse these citations when answering. If information is missing and you are in guardrail mode, decline gracefully.`;
                payloadMessages.push({ role: 'system', content: contextMessage });
              }
            }
          } catch (ragErr) {
            console.warn('[embed-chat] RAG augmentation failed, proceeding without context', ragErr);
          }
        }

        const payload = {
          public_id: publicId,
          session_id: sessionId,
          client_session_id: storageKey || undefined,
          messages: payloadMessages
        };
        const response = await fetch(AGENT_CHAT_URL, {
          method: 'POST',
          headers: SUPABASE_REQUEST_HEADERS,
          body: JSON.stringify(payload)
        });
        const json = await response.json();
        if (!response.ok) {
          throw new Error(json?.error || 'Agent request failed');
        }
        setSessionId(json.session_id);
        const assistantMessage: EmbedMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: json?.assistant?.content || '…'
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err: any) {
        setError(err?.message || 'Something went wrong');
      } finally {
        setIsSending(false);
      }
    },
    [agentMeta, messages, publicId, sessionId, storageKey]
  );

  const resetChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setError(null);
    if (storageKey) {
      localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  return {
    messages,
    agentMeta,
    appearance,
    sessionId,
    isLoadingMeta,
    isSending,
    error,
    sendMessage,
    resetChat
  };
}
