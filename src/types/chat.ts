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

export type ChatMessage = {
  id: string;
  sessionId: string;
  sender: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: string;
  streamed?: boolean;
  toolName?: string | null;
  raw?: Record<string, any> | null;
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
