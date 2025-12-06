import { supabase } from './supabase';
import type {
  RagAugmentationResult,
  RagDocument,
  RagLogEntry,
  RagMode,
  RagSpace
} from '../types/rag';

function isRagTableMissing(error: any | null) {
  if (!error) return false;
  if (error.code === '42P01') return true;
  const message = `${error.message || ''} ${error.details || ''}`.toLowerCase();
  return message.includes('va_rag_');
}

async function invokeRagFunction(payload: Record<string, any>) {
  const { data: sessionData } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = sessionData?.session?.access_token;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  console.log('[rag-service] invoking function', { action: payload.action });
  const { data, error } = await supabase.functions.invoke('rag-service', {
    body: JSON.stringify(payload),
    headers
  });

  if (error) {
    console.error('[rag-service] function error', error);
    throw new Error(error.message || 'RAG service call failed');
  }
  console.log('[rag-service] function success', { action: payload.action });
  return data;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk) as unknown as number[]);
  }
  return btoa(binary);
}

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}

export async function listKnowledgeSpaces(): Promise<RagSpace[]> {
  const { data, error } = await supabase
    .from('va_rag_spaces')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) {
    if (isRagTableMissing(error)) {
      console.warn('[rag-service] va_rag_spaces missing. Returning empty list.');
      return [];
    }
    console.error('Failed to load knowledge spaces', error);
    throw error;
  }
  return (data as RagSpace[]) || [];
}

export async function listKnowledgeDocuments(spaceId: string): Promise<RagDocument[]> {
  const { data, error } = await supabase
    .from('va_rag_documents')
    .select('*')
    .eq('space_id', spaceId)
    .order('created_at', { ascending: true });
  if (error) {
    if (isRagTableMissing(error)) {
      console.warn('[rag-service] va_rag_documents missing. Returning empty list.');
      return [];
    }
    console.error('Failed to load documents', error);
    throw error;
  }
  return (data as RagDocument[]) || [];
}

export async function listRagLogs(limit = 50): Promise<RagLogEntry[]> {
  const { data, error } = await supabase
    .from('va_rag_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isRagTableMissing(error)) {
      console.warn('[rag-service] va_rag_logs missing. Returning empty list.');
      return [];
    }
    console.error('Failed to load rag logs', error);
    throw error;
  }
  return (data as RagLogEntry[]) || [];
}

export async function createKnowledgeSpace(input: { name: string; description?: string }) {
  const data = await invokeRagFunction({
    action: 'create_space',
    name: input.name,
    description: input.description
  });
  return data?.space as RagSpace;
}

export async function uploadKnowledgeFile(spaceId: string, file: File, description?: string) {
  const content_base64 = await fileToBase64(file);
  const data = await invokeRagFunction({
    action: 'upload_document',
    space_id: spaceId,
    filename: file.name,
    mime_type: file.type,
    source_type: 'file',
    description,
    content_base64
  });
  return data?.document as RagDocument;
}

export async function ingestKnowledgeText(spaceId: string, text: string, title?: string) {
  const data = await invokeRagFunction({
    action: 'upload_document',
    space_id: spaceId,
    source_type: 'text',
    description: title || 'Manual entry',
    text_content: text
  });
  return data?.document as RagDocument;
}

export async function archiveKnowledgeDocument(documentId: string) {
  const { error } = await supabase
    .from('va_rag_documents')
    .update({ status: 'archived' })
    .eq('id', documentId);
  if (error) {
    if (isRagTableMissing(error)) {
      console.warn('[rag-service] archive skipped because va_rag_documents missing');
      return;
    }
    throw error;
  }
}

export async function updateAgentRagSettings(agentId: string, updates: Partial<{ rag_enabled: boolean; rag_mode: RagMode }>) {
  const payload: Record<string, any> = {};
  if (updates.rag_enabled !== undefined) payload.rag_enabled = updates.rag_enabled;
  if (updates.rag_mode) payload.rag_mode = updates.rag_mode;
  if (!Object.keys(payload).length) return;
  const { error } = await supabase
    .from('va_agent_configs')
    .update(payload)
    .eq('id', agentId);
  if (error) {
    console.error('Failed to update agent rag settings', error);
    throw error;
  }
}

export async function toggleAgentSpaceBinding(agentId: string, spaceId: string, enabled: boolean) {
  if (enabled) {
    const { error } = await supabase
      .from('va_rag_agent_spaces')
      .insert({ agent_config_id: agentId, space_id: spaceId });
    if (error && error.code !== '23505') {
      if (isRagTableMissing(error)) {
        console.warn('[rag-service] binding skipped because va_rag_agent_spaces missing');
        return;
      }
      throw error;
    }
    return;
  }
  const { error } = await supabase
    .from('va_rag_agent_spaces')
    .delete()
    .eq('agent_config_id', agentId)
    .eq('space_id', spaceId);
  if (error) {
    if (isRagTableMissing(error)) {
      console.warn('[rag-service] unbinding skipped because va_rag_agent_spaces missing');
      return;
    }
    throw error;
  }
}

export async function runRagAugmentation(input: {
  agentConfigId: string;
  query: string;
  ragMode: RagMode;
  spaceIds: string[];
  conversationId?: string;
  turnId?: string;
  model?: string;
}): Promise<RagAugmentationResult> {
  if (!input.spaceIds.length) {
    throw new Error('No knowledge spaces connected');
  }
  console.log('[RAG] Invoking run_query', {
    agentConfigId: input.agentConfigId,
    ragMode: input.ragMode,
    spaceIds: input.spaceIds,
    queryPreview: input.query.slice(0, 80)
  });
  const data = await invokeRagFunction({
    action: 'run_query',
    agent_config_id: input.agentConfigId,
    query: input.query,
    space_ids: input.spaceIds,
    rag_mode: input.ragMode,
    conversation_id: input.conversationId,
    turn_id: input.turnId,
    model: input.model
  });

  console.log('[RAG] run_query response', {
    vectorStoreIds: data?.vector_store_ids,
    citations: data?.citations?.length || 0,
    guardrailTriggered: data?.guardrail_triggered
  });

  return {
    question: input.query,
    answer: data?.answer || '',
    citations: data?.citations || [],
    vectorStoreIds: data?.vector_store_ids || [],
    ragMode: input.ragMode,
    guardrailTriggered: Boolean(data?.guardrail_triggered),
    createdAt: new Date().toISOString()
  };
}
