import { supabase } from "./supabase";
import type {
  BenchmarkEvent,
  BenchmarkEventType,
  BenchmarkMetric,
  BenchmarkMetricName,
  BenchmarkTraceContext,
} from "../types/voice-benchmark";

const CONTEXT_KEY = "voice-benchmark-active-trace";
const EVENT_PREFIX = "voice-benchmark-events:";
const WAVEFORM_PREFIX = "voice-benchmark-waveforms:";
const CHANNEL_NAME = "voice-benchmark-events";

const now = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

export function getBenchmarkTrace(): BenchmarkTraceContext | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(CONTEXT_KEY) || "null");
  } catch {
    return null;
  }
}

export function setBenchmarkTrace(context: BenchmarkTraceContext | null) {
  if (typeof window === "undefined") return;
  if (context) {
    window.localStorage.setItem(CONTEXT_KEY, JSON.stringify(context));
  } else {
    window.localStorage.removeItem(CONTEXT_KEY);
  }
}

export function beginBenchmarkTurn(): BenchmarkTraceContext | null {
  const context = getBenchmarkTrace();
  if (!context) return null;
  const next = { ...context, turnId: crypto.randomUUID() };
  setBenchmarkTrace(next);
  return next;
}

export function getBenchmarkEvents(runId: string): BenchmarkEvent[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(
      window.localStorage.getItem(`${EVENT_PREFIX}${runId}`) || "[]",
    );
  } catch {
    return [];
  }
}

export function clearBenchmarkEvents(runId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(`${EVENT_PREFIX}${runId}`);
  window.localStorage.removeItem(`${WAVEFORM_PREFIX}${runId}`);
}

type BenchmarkWaveforms = Record<
  "user" | "output",
  Array<{ timeMs: number; value: number }>
>;

export function getBenchmarkWaveforms(runId: string): BenchmarkWaveforms {
  try {
    return JSON.parse(
      window.localStorage.getItem(`${WAVEFORM_PREFIX}${runId}`) ||
        '{"user":[],"output":[]}',
    );
  } catch {
    return { user: [], output: [] };
  }
}

export function recordBenchmarkWaveform(
  lane: "user" | "output",
  value: number,
) {
  const context = getBenchmarkTrace();
  if (!context || !Number.isFinite(value)) return;
  const waveforms = getBenchmarkWaveforms(context.runId);
  const samples = [
    ...waveforms[lane],
    { timeMs: now(), value: Math.max(0, Math.min(1, value)) },
  ];
  waveforms[lane] =
    samples.length > 800
      ? samples.filter((_, index) => index % 2 === 0)
      : samples;
  window.localStorage.setItem(
    `${WAVEFORM_PREFIX}${context.runId}`,
    JSON.stringify(waveforms),
  );
}

export function emitBenchmarkEvent(
  type: BenchmarkEventType,
  metadata: Record<string, unknown> = {},
  options?: { clockDomain?: "browser" | "gateway"; monotonicMs?: number },
): BenchmarkEvent | null {
  const context = getBenchmarkTrace();
  if (!context || typeof window === "undefined") return null;
  const event: BenchmarkEvent = {
    id: crypto.randomUUID(),
    runId: context.runId,
    traceId: context.traceId,
    turnId: context.turnId,
    type,
    clockDomain: options?.clockDomain || "browser",
    monotonicMs: options?.monotonicMs ?? now(),
    wallTime: new Date().toISOString(),
    metadata,
  };
  const events = [...getBenchmarkEvents(context.runId), event].slice(-2000);
  window.localStorage.setItem(
    `${EVENT_PREFIX}${context.runId}`,
    JSON.stringify(events),
  );
  window.dispatchEvent(new CustomEvent(CHANNEL_NAME, { detail: event }));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(event);
    channel.close();
  }
  void supabase
    .from("voice_benchmark_events")
    .insert({
      run_id: event.runId,
      trace_id: event.traceId,
      turn_id: event.turnId || null,
      event_type: event.type,
      clock_domain: event.clockDomain,
      monotonic_ms: event.monotonicMs,
      wall_time: event.wallTime,
      metadata: event.metadata,
    })
    .then(({ error }) => {
      if (error && !/does not exist|schema cache/i.test(error.message)) {
        console.warn(
          "[VoiceBenchmark] event persistence failed",
          error.message,
        );
      }
    });
  return event;
}

export function emitBenchmarkMilestone(
  type: BenchmarkEventType,
  metadata: Record<string, unknown> = {},
): BenchmarkEvent | null {
  const context = getBenchmarkTrace();
  if (!context) return null;
  const exists = getBenchmarkEvents(context.runId).some(
    (event) => event.turnId === context.turnId && event.type === type,
  );
  return exists ? null : emitBenchmarkEvent(type, metadata);
}

const first = (events: BenchmarkEvent[], type: BenchmarkEventType) =>
  events.find((event) => event.type === type && event.clockDomain === "browser")
    ?.monotonicMs;

const duration = (start?: number, end?: number) =>
  start !== undefined && end !== undefined && end >= start ? end - start : null;

export function calculateBenchmarkMetrics(
  events: BenchmarkEvent[],
): BenchmarkMetric[] {
  const speechStopped = first(events, "vad.speech_stopped");
  const connectStarted = first(events, "session.connect_started");
  const connected = first(events, "session.connected");
  const inputEnded = first(events, "input.audio_ended");
  const responseCreated = first(events, "response.created");
  const firstText = first(events, "response.first_text");
  const ttsRequest = first(events, "tts.request_started");
  const ttsAudio = first(events, "tts.first_audio");
  const audioChunk = first(events, "audio.first_chunk");
  const playback = first(events, "playback.started");
  const interruption = first(events, "interruption.requested");
  const interruptionStopped = first(events, "interruption.audio_stopped");
  const candidates: Array<[BenchmarkMetricName, number | null]> = [
    ["connection_ms", duration(connectStarted, connected)],
    ["endpointing_ms", duration(inputEnded, speechStopped)],
    ["response_created_ms", duration(speechStopped, responseCreated)],
    ["llm_ttft_ms", duration(responseCreated, firstText)],
    ["tts_ttfa_ms", duration(ttsRequest, ttsAudio)],
    ["playback_delay_ms", duration(audioChunk ?? ttsAudio, playback)],
    [
      "end_to_end_ms",
      duration(speechStopped, playback ?? audioChunk ?? ttsAudio),
    ],
    ["barge_in_cutoff_ms", duration(interruption, interruptionStopped)],
  ];
  return candidates
    .filter(
      (entry): entry is [BenchmarkMetricName, number] => entry[1] !== null,
    )
    .map(([name, value]) => ({
      name,
      value: Math.round(value * 10) / 10,
      unit: "ms",
    }));
}

export async function persistBenchmarkMetrics(
  runId: string,
  metrics: BenchmarkMetric[],
) {
  if (!metrics.length) return;
  const { error } = await supabase.from("voice_benchmark_metrics").upsert(
    metrics.map((metric) => ({
      run_id: runId,
      metric_name: metric.name,
      metric_value: metric.value,
      unit: metric.unit,
    })),
    { onConflict: "run_id,metric_name" },
  );
  if (error && !/does not exist|schema cache/i.test(error.message)) throw error;
}
