import { useCallback, useEffect, useMemo, useState } from 'react';

export type EmbedMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

export type EmbedAgentMeta = {
  name: string;
  summary?: string | null;
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase environment variables for embed widget');
}

const AGENT_CHAT_URL = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/agent-chat`;
const SUPABASE_REQUEST_HEADERS = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`
};

function createStorageKey(publicId: string) {
  return `va-embed-history-${publicId}`;
}

export function useEmbedChat(publicId: string, options?: { persist?: boolean }) {
  const [messages, setMessages] = useState<EmbedMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [agentMeta, setAgentMeta] = useState<EmbedAgentMeta | null>(null);
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
      setAgentMeta(json.agent || null);
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
      const optimisticHistory = [...messages, pendingMessage];
      setMessages(optimisticHistory);
      setIsSending(true);
      setError(null);
      try {
        const payload = {
          public_id: publicId,
          session_id: sessionId,
          client_session_id: storageKey || undefined,
          messages: optimisticHistory.map((message) => ({
            role: message.role,
            content: message.content
          }))
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
    [messages, publicId, sessionId, storageKey]
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
    sessionId,
    isLoadingMeta,
    isSending,
    error,
    sendMessage,
    resetChat
  };
}
