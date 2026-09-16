export type AgentModelPolicy = 'rag' | 'adapter' | 'automatic';

export type VoiceAdapterCheckpoint = {
  id: string;
  name: string;
  datasetName: string;
  backend: 'local' | 'tinker';
  artifactSha256?: string;
  completedAt?: number;
};

export type ModelRouteMetric = {
  route: 'rag' | 'adapter';
  label: string;
  model?: string | null;
  checkpoint?: string | null;
  latencyMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  recordedAt: string;
};

export type AgentModelPolicyConfig = {
  mode: AgentModelPolicy;
  adapter: VoiceAdapterCheckpoint | null;
  adapterSystemPrompt: string;
};
