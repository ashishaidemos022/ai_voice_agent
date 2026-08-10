export type BenchmarkArchitecture =
  | "openai_native"
  | "openai_elevenlabs_flash"
  | "openai_elevenlabs_expressive"
  | "elevenlabs_agent"
  | "custom";

export type BenchmarkEventType =
  | "session.connect_started"
  | "session.connected"
  | "microphone.capture_started"
  | "input.first_audio"
  | "input.audio_ended"
  | "vad.speech_started"
  | "vad.speech_stopped"
  | "transcript.user_final"
  | "transcript.assistant_final"
  | "response.created"
  | "response.first_text"
  | "tts.request_started"
  | "tts.first_audio"
  | "audio.first_chunk"
  | "playback.started"
  | "response.completed"
  | "interruption.requested"
  | "interruption.audio_stopped"
  | "audio.gap"
  | "session.disconnected"
  | "session.error";

export type BenchmarkTraceContext = {
  experimentId: string;
  variantId: string;
  scenarioId: string;
  runId: string;
  traceId: string;
  turnId: string;
  architecture: BenchmarkArchitecture;
  blindLabel: string;
  inputAudioAssetKey?: string;
  inputTranscript?: string;
  autoInjectAudio?: boolean;
  remoteSnapshotReady?: boolean;
};

export type BenchmarkEvent = {
  id: string;
  runId: string;
  traceId: string;
  turnId?: string;
  type: BenchmarkEventType;
  clockDomain: "browser" | "gateway";
  monotonicMs: number;
  wallTime: string;
  metadata: Record<string, unknown>;
};

export type BenchmarkMetricName =
  | "connection_ms"
  | "endpointing_ms"
  | "response_created_ms"
  | "llm_ttft_ms"
  | "tts_ttfa_ms"
  | "playback_delay_ms"
  | "end_to_end_ms"
  | "barge_in_cutoff_ms";

export type BenchmarkMetric = {
  name: BenchmarkMetricName;
  value: number;
  unit: "ms";
};

export type BenchmarkVariantSnapshot = {
  id: string;
  slot: "A" | "B" | "C";
  name: string;
  architecture: BenchmarkArchitecture;
  provider: string;
  model: string;
  voice: string;
  agentConfigId: string;
  configSnapshot: Record<string, unknown>;
  estimatedCostPerMinute?: number;
};

export type BenchmarkScenario = {
  id: string;
  key: string;
  name: string;
  category: string;
  prompt: string;
  inputTranscript: string;
  prerecordedAudioUrl?: string;
  durationSeconds: number;
  expectedBehavior: string[];
  enabled: boolean;
  pauseMs?: number;
};

export type BenchmarkRun = {
  id: string;
  experimentId: string;
  variantId: string;
  scenarioId: string;
  runNumber: number;
  runOrder: number;
  traceId: string;
  temperature: "cold" | "warm";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  events: BenchmarkEvent[];
  metrics: BenchmarkMetric[];
  rating?: BenchmarkRating;
  userTranscript?: string;
  assistantTranscript?: string;
  outputAudioUrl?: string;
  failureReason?: string;
  startedAt?: string;
  completedAt?: string;
  estimatedCost?: number;
  waveforms?: Record<
    "user" | "output",
    Array<{ timeMs: number; value: number }>
  >;
};

export type BenchmarkRating = {
  naturalness: number;
  expressiveness: number;
  emotionalAppropriateness: number;
  pronunciation: number;
  transcriptAccuracy: number;
  semanticCorrectness: number;
  voiceConsistency: number;
  turnTaking: number;
  instructionFollowing: number;
  notes: string;
  qualityFlags: {
    falseCutoff: boolean;
    falseActivation: boolean;
    missedTrailingWord: boolean;
    audioGap: boolean;
    clipping: boolean;
    reconnect: boolean;
  };
};

export type BenchmarkExperiment = {
  id: string;
  userId: string;
  name: string;
  description: string;
  status: "draft" | "running" | "completed" | "archived";
  repetitionCount: number;
  randomizedOrder: boolean;
  blindComparison: boolean;
  includeColdRuns: boolean;
  environmentSnapshot: Record<string, unknown>;
  variants: BenchmarkVariantSnapshot[];
  scenarios: BenchmarkScenario[];
  runs: BenchmarkRun[];
  shareSlug?: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};
