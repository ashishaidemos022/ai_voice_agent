import { supabase } from "./supabase";
import type { AgentConfigPreset } from "./config-service";
import type {
  BenchmarkArchitecture,
  BenchmarkExperiment,
  BenchmarkMetricName,
  BenchmarkRating,
  BenchmarkRun,
  BenchmarkScenario,
  BenchmarkVariantSnapshot,
} from "../types/voice-benchmark";

const STORE_KEY = "voice-benchmark-experiments-v2";

export const BENCHMARK_SCENARIO_PACK: BenchmarkScenario[] = [
  ...[200, 500, 900, 1300].map((pauseMs): BenchmarkScenario => ({
    id: `pause-vad-${pauseMs}`,
    key: `pause-vad-${pauseMs}`,
    name: `Pause / VAD · ${pauseMs} ms`,
    category: "Endpointing",
    durationSeconds: 35,
    enabled: true,
    pauseMs,
    prompt: `Book me a table for four… [pause ${pauseMs} ms] tomorrow at seven.`,
    inputTranscript: "Book me a table for four… tomorrow at seven.",
    expectedBehavior: [
      "Do not cut off before “tomorrow”",
      "Respond only after the final phrase",
    ],
  })),
  {
    id: "barge-in",
    key: "barge-in",
    name: "Barge-in recovery",
    category: "Interruption",
    durationSeconds: 45,
    enabled: true,
    prompt:
      "Begin a detailed restaurant booking confirmation. I will interrupt with: “Actually, make that six people.”",
    inputTranscript: "Actually, make that six people.",
    expectedBehavior: [
      "Stop audio promptly",
      "Acknowledge six people",
      "Do not repeat the whole answer",
    ],
  },
  {
    id: "trailing-word",
    key: "trailing-word",
    name: "Trailing-word recovery",
    category: "Endpointing",
    durationSeconds: 25,
    enabled: true,
    prompt: "Schedule it for Tuesday—no, Wednesday.",
    inputTranscript: "Schedule it for Tuesday—no, Wednesday.",
    expectedBehavior: [
      "Resolve the correction to Wednesday",
      "Preserve the trailing word",
    ],
  },
  {
    id: "language-switch",
    key: "language-switch",
    name: "Language switching",
    category: "Language",
    durationSeconds: 45,
    enabled: true,
    prompt:
      "I’m visiting Madrid. ¿Puedes recomendarme un restaurante? अब हिंदी में संक्षेप करें।",
    inputTranscript:
      "I’m visiting Madrid. ¿Puedes recomendarme un restaurante? अब हिंदी में संक्षेप करें।",
    expectedBehavior: [
      "Understand all three languages",
      "Switch pronunciation smoothly",
      "End with a Hindi summary",
    ],
  },
  {
    id: "expressive",
    key: "expressive",
    name: "Emotional range",
    category: "Expressiveness",
    durationSeconds: 40,
    enabled: true,
    prompt:
      "Say these naturally with the requested delivery: “The test results came back normal” with relief; “We got the contract!” with excitement; “I’m sorry you’re going through this” with empathy; “We need to leave immediately” with urgency.",
    inputTranscript: "Deliver the four emotional lines.",
    expectedBehavior: [
      "Distinct emotions",
      "No spoken stage directions",
      "Consistent identity",
    ],
  },
  {
    id: "entities",
    key: "entities",
    name: "Numbers and entities",
    category: "Accuracy",
    durationSeconds: 30,
    enabled: true,
    prompt:
      "Call +1 312 555 0198 on August 21st and confirm the $1,249.50 payment.",
    inputTranscript:
      "Call +1 312 555 0198 on August 21st and confirm the $1,249.50 payment.",
    expectedBehavior: [
      "Correct phone digits",
      "Correct date",
      "Correct currency",
    ],
  },
  {
    id: "noise",
    key: "noise",
    name: "Noise and microphone",
    category: "Robustness",
    durationSeconds: 45,
    enabled: true,
    prompt:
      "Repeat the entities I say while keyboard or room noise is present.",
    inputTranscript:
      "The project code is Delta seven and the deadline is Friday.",
    expectedBehavior: [
      "No false activation",
      "No missed entities",
      "Stable playback",
    ],
  },
  {
    id: "long-session",
    key: "long-session",
    name: "Long-session stability",
    category: "Reliability",
    durationSeconds: 300,
    enabled: false,
    prompt:
      "Complete twenty short turns including a tool call, interruption, language switch, and correction.",
    inputTranscript: "Twenty-turn scripted stability sequence.",
    expectedBehavior: [
      "No reconnect",
      "No audio gaps",
      "Context remains correct",
    ],
  },
  {
    id: "elevenlabs-native-showcase",
    key: "elevenlabs-native-showcase",
    name: "ElevenLabs v3 native feature showcase",
    category: "Native showcase",
    durationSeconds: 35,
    enabled: false,
    prompt:
      "[whispers] I have a secret. [excited] The launch is approved! [laughs] We actually did it.",
    inputTranscript: "Run the provider-native expressive-tag showcase.",
    expectedBehavior: [
      "Demonstrate native v3 audio tags",
      "Keep this result separate from the cross-provider comparison",
    ],
  },
];

const providerArchitecture = (
  preset: AgentConfigPreset,
): BenchmarkArchitecture => {
  if (preset.voice_provider === "elevenlabs_agent") return "elevenlabs_agent";
  if (preset.voice_provider === "elevenlabs_tts") {
    const model = String(preset.voice_provider_config?.model_id || "");
    return model === "eleven_v3" ||
      preset.voice_provider_config?.expressive_mode
      ? "openai_elevenlabs_expressive"
      : "openai_elevenlabs_flash";
  }
  return preset.voice_provider === "openai_realtime" || !preset.voice_provider
    ? "openai_native"
    : "custom";
};

export function snapshotVariant(
  preset: AgentConfigPreset,
  slot: "A" | "B" | "C",
): BenchmarkVariantSnapshot {
  return {
    id: crypto.randomUUID(),
    slot,
    name: preset.name,
    architecture: providerArchitecture(preset),
    provider: preset.voice_provider || "openai_realtime",
    model:
      preset.voice_provider === "elevenlabs_tts"
        ? String(preset.voice_provider_config?.model_id || "eleven_flash_v2_5")
        : preset.model,
    voice: preset.voice_id || preset.voice,
    agentConfigId: preset.id,
    configSnapshot: JSON.parse(JSON.stringify(preset)),
    estimatedCostPerMinute:
      Number(preset.voice_provider_config?.estimated_cost_per_minute || 0) ||
      undefined,
  };
}

export function captureEnvironment() {
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency,
    connection:
      (
        navigator as Navigator & {
          connection?: { effectiveType?: string; rtt?: number };
        }
      ).connection || null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    capturedAt: new Date().toISOString(),
  };
}

const shuffle = <T>(items: T[]) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
};

export function generateRunQueue(
  experiment: BenchmarkExperiment,
): BenchmarkRun[] {
  const base: Omit<BenchmarkRun, "runOrder">[] = [];
  const scenarios = experiment.scenarios.filter((scenario) => scenario.enabled);
  for (
    let repetition = 1;
    repetition <= experiment.repetitionCount;
    repetition += 1
  ) {
    for (const scenario of scenarios) {
      const variants = experiment.randomizedOrder
        ? shuffle(experiment.variants)
        : experiment.variants;
      variants.forEach((variant) =>
        base.push({
          id: crypto.randomUUID(),
          experimentId: experiment.id,
          variantId: variant.id,
          scenarioId: scenario.id,
          runNumber: repetition,
          traceId: crypto.randomUUID(),
          temperature:
            experiment.includeColdRuns && repetition === 1 ? "cold" : "warm",
          status: "queued",
          events: [],
          metrics: [],
        }),
      );
    }
  }
  return base.map((run, index) => ({ ...run, runOrder: index + 1 }));
}

export function newExperiment(
  userId: string,
  variants: BenchmarkVariantSnapshot[],
): BenchmarkExperiment {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    userId,
    name: `Voice benchmark · ${new Date().toLocaleDateString()}`,
    description: "Native speech-to-speech versus modular voice architectures",
    status: "draft",
    repetitionCount: 20,
    randomizedOrder: true,
    blindComparison: true,
    includeColdRuns: true,
    environmentSnapshot: captureEnvironment(),
    variants,
    scenarios: BENCHMARK_SCENARIO_PACK.map((scenario) => ({
      ...scenario,
      id: crypto.randomUUID(),
    })),
    runs: [],
    isPublic: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function listLocalExperiments(): BenchmarkExperiment[] {
  try {
    return JSON.parse(window.localStorage.getItem(STORE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveLocalExperiment(experiment: BenchmarkExperiment) {
  const next = { ...experiment, updatedAt: new Date().toISOString() };
  const all = [
    next,
    ...listLocalExperiments().filter((item) => item.id !== next.id),
  ].slice(0, 20);
  window.localStorage.setItem(STORE_KEY, JSON.stringify(all));
  return next;
}

export async function syncExperiment(experiment: BenchmarkExperiment) {
  const { error: experimentError } = await supabase
    .from("voice_benchmark_experiments")
    .upsert({
      id: experiment.id,
      user_id: experiment.userId,
      name: experiment.name,
      description: experiment.description,
      status: experiment.status,
      repetition_count: experiment.repetitionCount,
      randomized_order: experiment.randomizedOrder,
      blind_comparison: experiment.blindComparison,
      include_cold_runs: experiment.includeColdRuns,
      environment_snapshot: experiment.environmentSnapshot,
      share_slug: experiment.shareSlug || null,
      is_public: experiment.isPublic,
      updated_at: new Date().toISOString(),
    });
  if (experimentError) throw experimentError;
  const { error: variantError } = await supabase
    .from("voice_benchmark_variants")
    .upsert(
      experiment.variants.map((variant) => ({
        id: variant.id,
        experiment_id: experiment.id,
        slot: variant.slot,
        name: variant.name,
        architecture: variant.architecture,
        provider: variant.provider,
        model: variant.model,
        voice: variant.voice,
        agent_config_id: variant.agentConfigId,
        config_snapshot: variant.configSnapshot,
        estimated_cost_per_minute: variant.estimatedCostPerMinute || null,
      })),
    );
  if (variantError) throw variantError;
  const { error: scenarioError } = await supabase
    .from("voice_benchmark_scenarios")
    .upsert(
      experiment.scenarios.map((scenario) => ({
        id: scenario.id,
        experiment_id: experiment.id,
        scenario_key: scenario.key,
        name: scenario.name,
        category: scenario.category,
        prompt: scenario.prompt,
        input_transcript: scenario.inputTranscript,
        prerecorded_audio_url: scenario.prerecordedAudioUrl || null,
        expected_behavior: scenario.expectedBehavior,
        settings: {
          duration_seconds: scenario.durationSeconds,
          enabled: scenario.enabled,
          pause_ms: scenario.pauseMs || null,
        },
      })),
    );
  if (scenarioError) throw scenarioError;
}

export async function syncRun(
  run: BenchmarkRun,
  experiment: BenchmarkExperiment,
) {
  const variant = experiment.variants.find((item) => item.id === run.variantId);
  const { error } = await supabase.from("voice_benchmark_runs").upsert({
    id: run.id,
    experiment_id: run.experimentId,
    variant_id: run.variantId,
    scenario_id: run.scenarioId,
    run_number: run.runNumber,
    run_order: run.runOrder,
    trace_id: run.traceId,
    temperature: run.temperature,
    status: run.status,
    successful: run.status === "completed",
    failure_reason: run.failureReason || null,
    user_transcript: run.userTranscript || null,
    assistant_transcript: run.assistantTranscript || null,
    output_audio_url: run.outputAudioUrl || null,
    estimated_cost: run.estimatedCost || null,
    rating_snapshot: run.rating || null,
    waveform_snapshot: run.waveforms || {},
    config_snapshot: variant?.configSnapshot || {},
    environment_snapshot: experiment.environmentSnapshot,
    started_at: run.startedAt || null,
    completed_at: run.completedAt || null,
  });
  if (error) throw error;
}

export async function saveRating(
  runId: string,
  reviewerId: string,
  blindLabel: string,
  rating: BenchmarkRating,
) {
  const { error } = await supabase.from("voice_benchmark_ratings").insert({
    run_id: runId,
    reviewer_id: reviewerId,
    blind_label: blindLabel,
    naturalness: rating.naturalness,
    expressiveness: rating.expressiveness,
    emotional_appropriateness: rating.emotionalAppropriateness,
    pronunciation: rating.pronunciation,
    transcript_accuracy: rating.transcriptAccuracy,
    semantic_correctness: rating.semanticCorrectness,
    voice_consistency: rating.voiceConsistency,
    turn_taking: rating.turnTaking,
    instruction_following: rating.instructionFollowing,
    quality_flags: rating.qualityFlags,
    notes: rating.notes,
  });
  if (error) throw error;
}

export function percentile(values: number[], amount: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(amount * sorted.length) - 1),
  );
  return sorted[index];
}

export function metricSummary(
  runs: BenchmarkRun[],
  metric: BenchmarkMetricName,
) {
  const values = runs.flatMap((run) =>
    run.metrics
      .filter((item) => item.name === metric)
      .map((item) => item.value),
  );
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
  };
}
