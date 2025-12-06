export type RagMode = 'assist' | 'guardrail';

export interface RagSpace {
  id: string;
  tenant_id: string;
  name: string;
  description?: string | null;
  vector_store_id?: string | null;
  status: 'creating' | 'ready' | 'error' | 'archived';
  metadata?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface RagDocument {
  id: string;
  space_id: string;
  tenant_id: string;
  title?: string | null;
  source_type: 'file' | 'text' | 'url';
  openai_file_id?: string | null;
  openai_filename?: string | null;
  mime_type?: string | null;
  status: 'indexing' | 'ready' | 'error' | 'archived';
  error_message?: string | null;
  tokens?: number | null;
  created_at: string;
  updated_at: string;
}

export interface RagAgentSpaceBinding {
  id: string;
  agent_config_id: string;
  space_id: string;
  created_at: string;
  rag_space?: RagSpace | null;
}

export interface RagLogEntry {
  id: string;
  tenant_id: string;
  agent_config_id?: string | null;
  conversation_id?: string | null;
  turn_id?: string | null;
  query_text: string;
  vector_store_ids: string[];
  retrieved: any;
  model?: string | null;
  latency_ms?: number | null;
  token_usage?: Record<string, any> | null;
  created_at: string;
}

export interface RagCitation {
  file_id: string;
  title?: string;
  snippet: string;
  relevance?: number;
  url?: string | null;
}

export interface RagAugmentationResult {
  question: string;
  answer: string;
  citations: RagCitation[];
  vectorStoreIds: string[];
  ragMode: RagMode;
  guardrailTriggered?: boolean;
  createdAt: string;
}
