import { supabase } from './supabase';
import { ChatMessage, ChatSession, ChatToolEvent } from '../types/chat';

export async function createChatSession(params: {
  userId: string;
  agentPresetId: string;
  source?: 'app' | 'widget';
  metadata?: Record<string, any>;
}): Promise<ChatSession> {
  const { data, error } = await supabase
    .from('va_chat_sessions')
    .insert({
      user_id: params.userId,
      agent_preset_id: params.agentPresetId,
      source: params.source ?? 'app',
      metadata: params.metadata ?? {}
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapSession(data);
}

export async function completeChatSession(sessionId: string) {
  const { error } = await supabase
    .from('va_chat_sessions')
    .update({
      status: 'completed',
      updated_at: new Date().toISOString()
    })
    .eq('id', sessionId);

  if (error) {
    throw error;
  }
}

export async function loadRecentChatSessions(limit = 20): Promise<ChatSession[]> {
  const { data, error } = await supabase
    .from('va_chat_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapSession);
}

export async function loadChatMessages(sessionId: string, limit = 100): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('va_chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapMessage);
}

export async function insertChatMessage(params: {
  sessionId: string;
  sender: 'user' | 'assistant' | 'system' | 'tool';
  message: string;
  toolName?: string | null;
  raw?: Record<string, any> | null;
  streamed?: boolean;
}): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('va_chat_messages')
    .insert({
      session_id: params.sessionId,
      sender: params.sender,
      message: params.message,
      tool_name: params.toolName ?? null,
      raw: params.raw ?? null,
      streamed: params.streamed ?? false
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapMessage(data);
}

export async function createChatToolEvent(params: {
  sessionId: string;
  toolName: string;
  request?: Record<string, any>;
}): Promise<ChatToolEvent> {
  const { data, error } = await supabase
    .from('va_chat_tool_events')
    .insert({
      session_id: params.sessionId,
      tool_name: params.toolName,
      request: params.request ?? null,
      status: 'pending'
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return mapToolEvent(data);
}

export async function updateChatToolEvent(id: string, updates: Partial<{
  status: ChatToolEvent['status'];
  response: Record<string, any> | null;
  error: string | null;
}>): Promise<void> {
  const payload: Record<string, any> = {
    completed_at: new Date().toISOString()
  };

  if (updates.status) {
    payload.status = updates.status;
  }
  if (updates.response !== undefined) {
    payload.response = updates.response;
  }
  if (updates.error !== undefined) {
    payload.error = updates.error;
  }

  const { error } = await supabase
    .from('va_chat_tool_events')
    .update(payload)
    .eq('id', id);

  if (error) {
    throw error;
  }
}

function mapSession(row: any): ChatSession {
  return {
    id: row.id,
    agentPresetId: row.agent_preset_id,
    status: row.status,
    source: row.source,
    messageCount: row.message_count,
    toolCallCount: row.tool_call_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at
  };
}

function mapMessage(row: any): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    sender: row.sender,
    content: row.message,
    createdAt: row.created_at,
    streamed: row.streamed,
    toolName: row.tool_name,
    raw: row.raw
  };
}

function mapToolEvent(row: any): ChatToolEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    status: row.status,
    request: row.request,
    response: row.response,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}
