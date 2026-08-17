import type { ChatRouteDecision } from '../../shared/model-routing';

export type AgentTag = {
  id: string;
  label: string;
};

export type AgenticPreset = {
  id: string;
  name: string;
  instructions: string;
  systemPrompt?: string | null;
  summary?: string | null;
  tags: string[];
  model: string;
  chatModel?: string | null;
  agentAvatarUrl?: string | null;
  toolsEnabled?: string[];
};

export type ChatSession = {
  id: string;
  agentPresetId: string;
  status: 'active' | 'completed' | 'error';
  source: 'app' | 'widget';
  messageCount: number;
  toolCallCount: number;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string | null;
};

export type RichMessageContentPart =
  | { type: 'text'; text: string; format?: 'plain' | 'markdown' }
  | { type: 'image'; url: string; alt: string; width?: number; height?: number; caption?: string }
  | {
      type: 'table';
      columns: Array<{ key: string; label: string; align?: 'left' | 'center' | 'right' }>;
      rows: Array<Record<string, string | number | boolean | null>>;
      caption?: string;
    }
  | { type: 'a2ui'; version: '0.8'; payload: Record<string, unknown> };

export type RichMessageContent = {
  version: 1;
  parts: RichMessageContentPart[];
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  sender: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: string;
  streamed?: boolean;
  toolName?: string | null;
  raw?: (Record<string, unknown> & {
    routing?: ChatRouteDecision;
    content?: RichMessageContent;
  }) | null;
  isStreaming?: boolean;
};

export type ChatToolEvent = {
  id: string;
  sessionId: string;
  toolName: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  request?: Record<string, any> | null;
  response?: Record<string, any> | null;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
};

export type ChatComposerState = {
  value: string;
  isSending: boolean;
  error?: string | null;
};
