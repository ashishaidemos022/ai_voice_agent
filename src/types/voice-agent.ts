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
  message_id: string;
  session_id: string;
  tool_name: string;
  input_params: Record<string, any>;
  output_result: Record<string, any>;
  execution_time_ms: number;
  status: 'success' | 'error' | 'timeout';
  error_message?: string;
  executed_at: string;
  execution_type: 'client' | 'server';
}

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
}

export interface AudioVisualizerData {
  waveform: Uint8Array;
  volume: number;
  isActive: boolean;
}
