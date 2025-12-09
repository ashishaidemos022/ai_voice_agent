export interface VoiceSession {
  id: string;
  created_at: string;
  updated_at: string;
  session_metadata: Record<string, any>;
  status: 'active' | 'ended' | 'error';
  duration_seconds: number;
  message_count: number;
  tool_execution_count: number;
}

export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  audio_metadata: Record<string, any>;
  timestamp: string;
  tool_calls: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  result?: any;
  status?: 'pending' | 'success' | 'error';
}

export interface ToolExecution {
  id: string;
  message_id?: string | null;
  chat_message_id?: string | null;
  session_id?: string | null;
  chat_session_id?: string | null;
  tool_name: string;
  input_params: Record<string, any>;
  output_result: Record<string, any>;
  execution_time_ms: number;
  status: 'success' | 'error' | 'timeout';
  error_message?: string;
  executed_at: string;
  execution_type: 'mcp' | 'webhook';
}

import type { RagMode } from './rag';

export interface RealtimeConfig {
  model: string;
  voice: string;
  instructions: string;
  temperature: number;
  max_response_output_tokens: number;
  turn_detection?: {
    type: 'server_vad';
    threshold?: number;
    prefix_padding_ms?: number;
    silence_duration_ms?: number;
  } | null;
  rag_enabled?: boolean;
  rag_mode?: RagMode;
  knowledge_vector_store_ids?: string[];
  knowledge_space_ids?: string[];
  rag_default_model?: string | null;
}

export type VoiceToolEventStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface VoiceToolEvent {
  id: string;
  toolName: string;
  status: VoiceToolEventStatus;
  request?: Record<string, any> | null;
  response?: Record<string, any> | null;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface AudioVisualizerData {
  waveform: Uint8Array;
  volume: number;
  isActive: boolean;
}
