import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clipboard,
  Cloud,
  Eye,
  FileAudio,
  FlaskConical,
  Gauge,
  Layers3,
  Lock,
  Maximize2,
  Play,
  Radio,
  RefreshCw,
  Save,
  Shuffle,
  Square,
  Upload,
} from "lucide-react";
import {
  getAllConfigPresets,
  type AgentConfigPreset,
} from "../../lib/config-service";
import {
  BENCHMARK_SCENARIO_PACK,
  generateRunQueue,
  listLocalExperiments,
  newExperiment,
  saveLocalExperiment,
  saveRating,
  snapshotVariant,
  syncExperiment,
  syncRun,
} from "../../lib/benchmark-service";
import {
  calculateBenchmarkMetrics,
  clearBenchmarkEvents,
  getBenchmarkEvents,
  getBenchmarkTrace,
  getBenchmarkWaveforms,
  persistBenchmarkMetrics,
  setBenchmarkTrace,
} from "../../lib/benchmark-instrumentation";
import type {
  BenchmarkEvent,
  BenchmarkExperiment,
  BenchmarkRating,
  BenchmarkRun,
} from "../../types/voice-benchmark";
import { useAgentState } from "../../state/agentState";
import { useAuth } from "../../context/AuthContext";
import { MainLayout } from "../layout/MainLayout";
import { Sidebar } from "../layout/Sidebar";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { cn } from "../../lib/utils";
import { BenchmarkResults } from "./BenchmarkResults";
import { BenchmarkPresentation } from "./BenchmarkPresentation";
import {
  getBenchmarkOutputAudio,
  playBenchmarkAudio,
  publishBenchmarkAudio,
  saveBenchmarkAudio,
} from "../../lib/benchmark-audio-store";

type VoiceLabProps = {
  onNavigateVoice: () => void;
  onNavigateChat?: () => void;
  onOpenCreateAgent?: () => void;
  onOpenSkills?: () => void;
  onOpenKnowledgeBase?: () => void;
  onOpenUsage?: () => void;
  onOpenEmbedUsage?: () => void;
};

type LabView = "builder" | "run" | "results";
const slots = ["A", "B", "C"] as const;
const slotClasses = {
  A: "border-cyan-400/25 bg-cyan-500/5",
  B: "border-violet-400/25 bg-violet-500/5",
  C: "border-amber-400/25 bg-amber-500/5",
} as const;
const blankRating = (): BenchmarkRating => ({
  naturalness: 3,
  expressiveness: 3,
  emotionalAppropriateness: 3,
  pronunciation: 3,
  transcriptAccuracy: 3,
  semanticCorrectness: 3,
  voiceConsistency: 3,
  turnTaking: 3,
  instructionFollowing: 3,
  notes: "",
  qualityFlags: {
    falseCutoff: false,
    falseActivation: false,
    missedTrailingWord: false,
    audioGap: false,
    clipping: false,
    reconnect: false,
  },
});

const architectureName = (architecture?: string) =>
  ({
    openai_native: "OpenAI native speech-to-speech",
    openai_elevenlabs_flash: "OpenAI Realtime + ElevenLabs Flash",
    openai_elevenlabs_expressive: "OpenAI Realtime + ElevenLabs v3",
    elevenlabs_agent: "ElevenLabs Conversational Agent",
    custom: "Custom architecture",
  })[architecture || ""] || "Not configured";

const chooseDefaults = (presets: AgentConfigPreset[]) => {
  const native = presets.find(
    (item) => !item.voice_provider || item.voice_provider === "openai_realtime",
  );
  const flash = presets.find(
    (item) =>
      item.voice_provider === "elevenlabs_tts" &&
      item.voice_provider_config?.model_id !== "eleven_v3" &&
      !item.voice_provider_config?.expressive_mode,
  );
  const expressive = presets.find(
    (item) =>
      item.voice_provider === "elevenlabs_tts" &&
      (item.voice_provider_config?.model_id === "eleven_v3" ||
        item.voice_provider_config?.expressive_mode),
  );
  const picked = [native, flash, expressive]
    .map((value, index) => value || presets[index] || presets[0])
    .filter(Boolean) as AgentConfigPreset[];
  return picked.map((preset, index) => snapshotVariant(preset, slots[index]));
};

const inputClass =
  "w-full rounded-xl bg-slate-950 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/50";

export function VoiceLab(props: VoiceLabProps) {
  const { vaUser, signOut } = useAuth();
  const vaUserId = vaUser?.id;
  const setActiveConfigId = useAgentState((state) => state.setActiveConfigId);
  const [presets, setPresets] = useState<AgentConfigPreset[]>([]);
  const [experiment, setExperiment] = useState<BenchmarkExperiment | null>(
    () => listLocalExperiments()[0] || null,
  );
  const [view, setView] = useState<LabView>(() =>
    listLocalExperiments()[0]?.runs.length ? "run" : "builder",
  );
  const [activeRunId, setActiveRunId] = useState(
    () =>
      listLocalExperiments()[0]?.runs.find((run) => run.status === "running")
        ?.id || "",
  );
  const [rating, setRating] = useState<BenchmarkRating>(blankRating);
  const [presentationRun, setPresentationRun] = useState<
    BenchmarkRun | null | undefined
  >(null);
  const [methodOpen, setMethodOpen] = useState(true);
  const [syncState, setSyncState] = useState<
    "local" | "syncing" | "synced" | "unavailable"
  >("local");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getAllConfigPresets()
      .then((data) => {
        setPresets(data);
        setExperiment((current) => {
          if (current || !vaUserId || !data.length) return current;
          return saveLocalExperiment(
            newExperiment(vaUserId, chooseDefaults(data)),
          );
        });
      })
      .catch((error) =>
        console.error("[VoiceLab] failed to load agents", error),
      );
  }, [vaUserId]);

  useEffect(() => {
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<BenchmarkEvent>).detail;
      if (!detail || detail.runId !== activeRunId) return;
      setExperiment((current) =>
        current
          ? {
              ...current,
              runs: current.runs.map((run) =>
                run.id === detail.runId
                  ? { ...run, events: getBenchmarkEvents(run.id) }
                  : run,
              ),
            }
          : current,
      );
    };
    window.addEventListener("voice-benchmark-events", onEvent);
    return () => window.removeEventListener("voice-benchmark-events", onEvent);
  }, [activeRunId]);

  useEffect(() => {
    const stored = listLocalExperiments()[0];
    const running = stored?.runs.find((run) => run.status === "running");
    if (!running) return;
    const events = getBenchmarkEvents(running.id);
    if (stored && events.length && events.length !== running.events.length) {
      setExperiment(
        saveLocalExperiment({
          ...stored,
          runs: stored.runs.map((run) =>
            run.id === running.id ? { ...run, events } : run,
          ),
        }),
      );
    }
    setActiveRunId(running.id);
  }, []);

  const persist = (next: BenchmarkExperiment, remote = false) => {
    const saved = saveLocalExperiment(next);
    setExperiment(saved);
    if (remote) {
      setSyncState("syncing");
      void syncExperiment(saved)
        .then(() => setSyncState("synced"))
        .catch((error) => {
          console.warn(
            "[VoiceLab] Supabase sync unavailable; local copy retained",
            error.message,
          );
          setSyncState("unavailable");
        });
    }
    return saved;
  };

  const activeRun =
    experiment?.runs.find((run) => run.id === activeRunId) ||
    experiment?.runs.find((run) => run.status === "running") ||
    experiment?.runs.find((run) => run.status === "queued");
  const activeVariant = experiment?.variants.find(
    (variant) => variant.id === activeRun?.variantId,
  );
  const activeScenario = experiment?.scenarios.find(
    (scenario) => scenario.id === activeRun?.scenarioId,
  );
  const completedCount =
    experiment?.runs.filter((run) => run.status === "completed").length || 0;

  const replaceVariant = (slot: "A" | "B" | "C", presetId: string) => {
    if (!experiment) return;
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) return;
    const current = experiment.variants.find(
      (variant) => variant.slot === slot,
    );
    const snapshot = {
      ...snapshotVariant(preset, slot),
      id: current?.id || crypto.randomUUID(),
    };
    persist({
      ...experiment,
      variants: [
        ...experiment.variants.filter((variant) => variant.slot !== slot),
        snapshot,
      ].sort((a, b) => a.slot.localeCompare(b.slot)),
    });
  };

  const startExperiment = () => {
    if (!experiment || experiment.variants.length < 2) return;
    const timestamp = new Date().toISOString();
    const base = experiment.runs.length
      ? {
          ...experiment,
          id: crypto.randomUUID(),
          variants: experiment.variants.map((variant) => ({
            ...variant,
            id: crypto.randomUUID(),
          })),
          scenarios: experiment.scenarios.map((scenario) => ({
            ...scenario,
            id: crypto.randomUUID(),
          })),
          runs: [],
          shareSlug: undefined,
          isPublic: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
      : experiment;
    const prepared = {
      ...base,
      status: "running" as const,
      runs: generateRunQueue(base),
    };
    const saved = persist(prepared, true);
    setActiveRunId(saved.runs[0]?.id || "");
    setView("run");
  };

  const launchRun = async (run: BenchmarkRun) => {
    if (!experiment) return;
    const variant = experiment.variants.find(
      (item) => item.id === run.variantId,
    );
    const scenario = experiment.scenarios.find(
      (item) => item.id === run.scenarioId,
    );
    if (!variant || !scenario) return;
    clearBenchmarkEvents(run.id);
    const running = {
      ...run,
      status: "running" as const,
      startedAt: new Date().toISOString(),
      events: [],
      metrics: [],
    };
    const next = persist({
      ...experiment,
      runs: experiment.runs.map((item) =>
        item.id === run.id ? running : item,
      ),
    });
    setActiveRunId(run.id);
    let remoteSnapshotReady = false;
    try {
      await syncExperiment(next);
      await syncRun(running, next);
      remoteSnapshotReady = true;
      setSyncState("synced");
    } catch (error) {
      console.warn(
        "[VoiceLab] remote benchmark storage unavailable; using the local preset",
        error,
      );
      setSyncState("unavailable");
    }
    setBenchmarkTrace({
      experimentId: experiment.id,
      variantId: variant.id,
      scenarioId: scenario.id,
      runId: run.id,
      traceId: run.traceId,
      turnId: crypto.randomUUID(),
      architecture: variant.architecture,
      blindLabel: experiment.blindComparison
        ? `Voice ${variant.slot}`
        : variant.name,
      inputAudioAssetKey: scenario.prerecordedAudioUrl,
      inputTranscript: scenario.inputTranscript,
      autoInjectAudio: Boolean(
        scenario.prerecordedAudioUrl &&
        variant.architecture !== "elevenlabs_agent",
      ),
      remoteSnapshotReady,
    });
    await navigator.clipboard.writeText(scenario.prompt).catch(() => undefined);
    setActiveConfigId(variant.agentConfigId);
    props.onNavigateVoice();
  };

  const finishRun = async (status: "completed" | "failed") => {
    if (!experiment || !activeRun) return;
    const events = getBenchmarkEvents(activeRun.id);
    const metrics = calculateBenchmarkMetrics(events);
    const completedAt = new Date().toISOString();
    const durationMinutes = activeRun.startedAt
      ? Math.max(
          0,
          new Date(completedAt).getTime() -
            new Date(activeRun.startedAt).getTime(),
        ) / 60000
      : 0;
    let outputAudioUrl = getBenchmarkOutputAudio(activeRun.id);
    const trace = getBenchmarkTrace();
    if (outputAudioUrl && trace?.remoteSnapshotReady && vaUser?.auth_user_id) {
      try {
        outputAudioUrl = await publishBenchmarkAudio(
          outputAudioUrl,
          `${vaUser.auth_user_id}/${experiment.id}/${activeRun.id}`,
        );
      } catch (error) {
        console.warn(
          "[VoiceLab] output audio upload unavailable; local replay retained",
          error,
        );
      }
    }
    const finished: BenchmarkRun = {
      ...activeRun,
      status,
      events,
      metrics,
      rating: status === "completed" ? rating : undefined,
      failureReason:
        status === "failed"
          ? rating.notes || "Marked failed by reviewer"
          : undefined,
      userTranscript: String(
        [...events]
          .reverse()
          .find(
            (event: BenchmarkEvent) => event.type === "transcript.user_final",
          )?.metadata.transcript || "",
      ),
      assistantTranscript: String(
        [...events]
          .reverse()
          .find(
            (event: BenchmarkEvent) =>
              event.type === "transcript.assistant_final",
          )?.metadata.transcript || "",
      ),
      completedAt,
      estimatedCost:
        (activeVariant?.estimatedCostPerMinute || 0) * durationMinutes,
      outputAudioUrl,
      waveforms: getBenchmarkWaveforms(activeRun.id),
    };
    const isLast =
      experiment.runs.filter((run) => run.status === "queued").length === 0;
    const next = persist({
      ...experiment,
      status: isLast ? "completed" : experiment.status,
      runs: experiment.runs.map((run) =>
        run.id === activeRun.id ? finished : run,
      ),
    });
    setBenchmarkTrace(null);
    void Promise.all([
      syncRun(finished, next),
      persistBenchmarkMetrics(finished.id, metrics),
      status === "completed" && vaUser
        ? saveRating(finished.id, vaUser.id, activeVariant?.slot || "", rating)
        : Promise.resolve(),
    ]).catch((error) =>
      console.warn("[VoiceLab] remote run save unavailable", error.message),
    );
    const nextRun = next.runs.find((run) => run.status === "queued");
    setActiveRunId(nextRun?.id || finished.id);
    setRating(blankRating());
    if (!nextRun) setView("results");
  };

  const publish = () => {
    if (!experiment) return;
    const next = persist(
      {
        ...experiment,
        isPublic: true,
        shareSlug:
          experiment.shareSlug ||
          `${experiment.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "")}-${experiment.id.slice(0, 6)}`,
      },
      true,
    );
    const url = `${window.location.origin}${window.location.pathname}?voice-report=${next.shareSlug}`;
    void navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const sidebar = (
    <Sidebar
      activeNav="voice-lab"
      onNavigateVoice={props.onNavigateVoice}
      onNavigateChat={props.onNavigateChat}
      onNavigateVoiceLab={() => undefined}
      onNavigateSkills={props.onOpenSkills}
      onOpenKnowledgeBase={props.onOpenKnowledgeBase}
      onOpenUsage={props.onOpenUsage}
      onOpenEmbedUsage={props.onOpenEmbedUsage}
      onOpenSettings={props.onOpenCreateAgent}
    />
  );
  const topBar = (
    <header className="h-16 border-b border-white/10 bg-slate-950/60 px-6 flex items-center justify-between">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-white/40">
        <span>Agent Workspace</span>
        <ArrowRight className="w-3 h-3" />
        <span className="text-violet-200">Voice Lab</span>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "text-[10px] uppercase tracking-[.2em]",
            syncState === "synced"
              ? "text-emerald-300"
              : syncState === "unavailable"
                ? "text-amber-300"
                : "text-white/35",
          )}
        >
          <Cloud className="inline w-3 h-3 mr-1" />
          {syncState}
        </span>
        <span className="hidden md:block text-sm text-white/60">
          {vaUser?.email}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={signOut}
          className="border-white/20 text-white/80"
        >
          Sign out
        </Button>
      </div>
    </header>
  );

  if (!experiment)
    return (
      <MainLayout sidebar={sidebar} topBar={topBar}>
        <div className="h-full flex items-center justify-center text-white/50">
          <RefreshCw className="w-5 h-5 animate-spin mr-3" />
          Preparing Voice Lab…
        </div>
      </MainLayout>
    );

  return (
    <>
      <MainLayout sidebar={sidebar} topBar={topBar}>
        <div className="h-full overflow-y-auto">
          <div className="max-w-[1600px] mx-auto p-6 lg:p-8 space-y-6">
            <section className="rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-500/15 via-slate-950/80 to-cyan-500/10 p-6">
              <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-5">
                <div>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[.3em] text-violet-200">
                    <FlaskConical className="w-4 h-4" /> Instrumented voice
                    systems benchmark
                  </div>
                  <input
                    value={experiment.name}
                    onChange={(event) =>
                      persist({ ...experiment, name: event.target.value })
                    }
                    className="mt-3 bg-transparent text-3xl lg:text-4xl font-semibold font-display text-white focus:outline-none border-b border-transparent focus:border-white/20 max-w-full"
                  />
                  <p className="text-white/50 mt-2">
                    Native audio-to-audio versus modular TTS, measured by
                    pipeline stage—not one vague latency number.
                  </p>
                </div>
                <div className="flex gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
                  {(["builder", "run", "results"] as LabView[]).map((item) => (
                    <button
                      key={item}
                      onClick={() => setView(item)}
                      className={cn(
                        "px-4 py-2 rounded-lg text-sm capitalize transition",
                        view === item
                          ? "bg-white/10 text-white"
                          : "text-white/45 hover:text-white",
                      )}
                    >
                      {item === "run"
                        ? `Live run ${completedCount}/${experiment.runs.length || "—"}`
                        : item}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {view === "builder" && (
              <div className="space-y-6">
                <Card className="p-6 bg-slate-900/60">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[.25em] text-white/40">
                        Experiment builder
                      </p>
                      <h2 className="text-xl font-semibold text-white mt-1">
                        Immutable architecture variants
                      </h2>
                      <p className="text-sm text-white/45 mt-2">
                        Starting the experiment freezes a complete agent
                        configuration snapshot for every run.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-emerald-200 border border-emerald-400/20 bg-emerald-500/10 rounded-full px-3 py-1.5">
                      <Lock className="w-3 h-3" /> Shared controls locked
                    </div>
                  </div>
                  <div className="grid xl:grid-cols-3 gap-4 mt-6">
                    {slots.map((slot) => {
                      const variant = experiment.variants.find(
                        (item) => item.slot === slot,
                      );
                      return (
                        <div
                          key={slot}
                          className={cn(
                            "rounded-2xl border p-5",
                            slotClasses[slot],
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold tracking-[.2em] text-white/60">
                              VARIANT {slot}
                            </span>
                            <span className="text-[10px] uppercase text-white/35">
                              {variant?.provider}
                            </span>
                          </div>
                          <select
                            value={variant?.agentConfigId || ""}
                            onChange={(event) =>
                              replaceVariant(slot, event.target.value)
                            }
                            className={`${inputClass} mt-4`}
                          >
                            <option value="">Choose configured agent</option>
                            {presets.map((preset) => (
                              <option key={preset.id} value={preset.id}>
                                {preset.name}
                              </option>
                            ))}
                          </select>
                          <h3 className="text-base font-semibold text-white mt-4">
                            {architectureName(variant?.architecture)}
                          </h3>
                          <dl className="grid grid-cols-2 gap-2 mt-4 text-xs">
                            <div>
                              <dt className="text-white/35">Model</dt>
                              <dd className="text-white/75 mt-1 truncate">
                                {variant?.model || "—"}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-white/35">Voice</dt>
                              <dd className="text-white/75 mt-1 truncate">
                                {variant?.voice || "—"}
                              </dd>
                            </div>
                          </dl>
                          <label className="block mt-4">
                            <span className="text-[10px] uppercase tracking-[.18em] text-white/35">
                              Estimated cost / minute
                            </span>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-white/35">$</span>
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                value={variant?.estimatedCostPerMinute || ""}
                                placeholder="0.000"
                                onChange={(event) =>
                                  variant &&
                                  persist({
                                    ...experiment,
                                    variants: experiment.variants.map((item) =>
                                      item.id === variant.id
                                        ? {
                                            ...item,
                                            estimatedCostPerMinute:
                                              Number(event.target.value) ||
                                              undefined,
                                          }
                                        : item,
                                    ),
                                  })
                                }
                                className="w-full rounded-lg bg-slate-950 border border-white/10 px-2 py-1.5 text-xs text-white"
                              />
                            </div>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                <div className="grid xl:grid-cols-[1.5fr_1fr] gap-6">
                  <Card className="p-6 bg-slate-900/60">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[.25em] text-white/40">
                          Scenario pack
                        </p>
                        <h2 className="text-xl font-semibold text-white mt-1">
                          Repeatable lab inputs
                        </h2>
                      </div>
                      <span className="text-sm text-white/50">
                        {
                          experiment.scenarios.filter((item) => item.enabled)
                            .length
                        }{" "}
                        / {BENCHMARK_SCENARIO_PACK.length} enabled
                      </span>
                    </div>
                    <div className="grid md:grid-cols-2 gap-3 mt-5">
                      {experiment.scenarios.map((scenario) => (
                        <div
                          key={scenario.id}
                          className={cn(
                            "rounded-xl border p-4 transition",
                            scenario.enabled
                              ? "border-violet-400/25 bg-violet-500/5"
                              : "border-white/5 opacity-55",
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={scenario.enabled}
                              onChange={(event) =>
                                persist({
                                  ...experiment,
                                  scenarios: experiment.scenarios.map((item) =>
                                    item.id === scenario.id
                                      ? {
                                          ...item,
                                          enabled: event.target.checked,
                                        }
                                      : item,
                                  ),
                                })
                              }
                              className="mt-1 accent-violet-400"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex justify-between gap-2">
                                <p className="text-sm font-medium text-white">
                                  {scenario.name}
                                </p>
                                <span className="text-[10px] uppercase text-white/35">
                                  {scenario.category}
                                </span>
                              </div>
                              <p className="text-xs text-white/40 mt-1 line-clamp-2">
                                {scenario.inputTranscript}
                              </p>
                              <label className="mt-3 inline-flex items-center gap-2 text-[11px] text-cyan-200 cursor-pointer hover:text-cyan-100">
                                <Upload className="w-3 h-3" />
                                {scenario.prerecordedAudioUrl
                                  ? "Replace prerecorded WAV"
                                  : "Attach prerecorded WAV"}
                                <input
                                  type="file"
                                  accept="audio/wav,audio/x-wav"
                                  className="hidden"
                                  onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (!file) return;
                                    void saveBenchmarkAudio(
                                      `${experiment.id}:${scenario.id}`,
                                      file,
                                    ).then((reference) =>
                                      persist({
                                        ...experiment,
                                        scenarios: experiment.scenarios.map(
                                          (item) =>
                                            item.id === scenario.id
                                              ? {
                                                  ...item,
                                                  prerecordedAudioUrl:
                                                    reference,
                                                }
                                              : item,
                                        ),
                                      }),
                                    );
                                  }}
                                />
                              </label>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>

                  <div className="space-y-6">
                    <Card className="p-6 bg-slate-900/60">
                      <p className="text-xs uppercase tracking-[.25em] text-white/40">
                        Protocol
                      </p>
                      <div className="space-y-5 mt-5">
                        <label>
                          <span className="text-sm text-white/70">
                            Repetitions per scenario
                          </span>
                          <div className="flex items-center gap-3 mt-2">
                            <input
                              type="range"
                              min="1"
                              max="20"
                              value={experiment.repetitionCount}
                              onChange={(event) =>
                                persist({
                                  ...experiment,
                                  repetitionCount: Number(event.target.value),
                                })
                              }
                              className="flex-1 accent-violet-400"
                            />
                            <span className="w-10 h-9 rounded-lg bg-white/10 flex items-center justify-center font-semibold">
                              {experiment.repetitionCount}
                            </span>
                          </div>
                        </label>
                        {[
                          [
                            "randomizedOrder",
                            "Randomize variant order",
                            "Reduces warm-cache and first-impression bias",
                            Shuffle,
                          ],
                          [
                            "blindComparison",
                            "Blind listening labels",
                            "Shows Voice A/B/C instead of providers",
                            Eye,
                          ],
                          [
                            "includeColdRuns",
                            "Separate cold runs",
                            "First repetition is marked cold",
                            Gauge,
                          ],
                        ].map(([key, title, detail, Icon]) => (
                          <label
                            key={String(key)}
                            className="flex gap-3 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(
                                experiment[
                                  String(key) as keyof BenchmarkExperiment
                                ],
                              )}
                              onChange={(event) =>
                                persist({
                                  ...experiment,
                                  [String(key)]: event.target.checked,
                                } as BenchmarkExperiment)
                              }
                              className="mt-1 accent-violet-400"
                            />
                            <Icon className="w-4 h-4 text-cyan-200 mt-0.5" />
                            <span>
                              <span className="block text-sm text-white/80">
                                {String(title)}
                              </span>
                              <span className="block text-xs text-white/35 mt-0.5">
                                {String(detail)}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </Card>
                    <Button
                      size="lg"
                      className="w-full"
                      onClick={startExperiment}
                      disabled={
                        experiment.variants.length < 2 ||
                        !experiment.scenarios.some((item) => item.enabled)
                      }
                    >
                      <Play className="w-5 h-5" /> Build{" "}
                      {experiment.repetitionCount *
                        experiment.variants.length *
                        experiment.scenarios.filter((item) => item.enabled)
                          .length}{" "}
                      randomized runs
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {view === "run" && (
              <div className="grid xl:grid-cols-[minmax(0,1.55fr)_minmax(350px,.75fr)] gap-6">
                <div className="space-y-6">
                  {!experiment.runs.length ? (
                    <Card className="p-10 text-center">
                      <Layers3 className="w-8 h-8 text-violet-200 mx-auto" />
                      <h2 className="text-xl font-semibold mt-4">
                        Build the run queue first
                      </h2>
                      <Button
                        className="mt-5"
                        onClick={() => setView("builder")}
                      >
                        Open experiment builder
                      </Button>
                    </Card>
                  ) : activeRun && activeVariant && activeScenario ? (
                    <>
                      <Card className="p-6 bg-slate-900/60">
                        <div className="flex items-start justify-between gap-5">
                          <div>
                            <div className="flex items-center gap-2 text-xs uppercase tracking-[.25em] text-white/40">
                              <Radio
                                className={cn(
                                  "w-4 h-4",
                                  activeRun.status === "running" &&
                                    "text-rose-300 animate-pulse",
                                )}
                              />{" "}
                              Run {activeRun.runOrder} /{" "}
                              {experiment.runs.length} · repetition{" "}
                              {activeRun.runNumber}
                            </div>
                            <h2 className="text-2xl font-semibold text-white mt-2">
                              {activeScenario.name}
                            </h2>
                            <p className="text-sm text-white/45 mt-2">
                              {experiment.blindComparison
                                ? `Voice ${activeVariant.slot}`
                                : `${activeVariant.name} · ${architectureName(activeVariant.architecture)}`}{" "}
                              · {activeRun.temperature}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs uppercase tracking-[.2em]",
                              activeRun.status === "running"
                                ? "border-rose-400/30 bg-rose-500/10 text-rose-200"
                                : "border-white/10 text-white/50",
                            )}
                          >
                            {activeRun.status}
                          </span>
                        </div>
                        <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/70 p-5">
                          <p className="text-[10px] uppercase tracking-[.25em] text-violet-200">
                            Controlled input
                          </p>
                          <p className="text-base text-white/80 mt-3 leading-relaxed">
                            {activeScenario.inputTranscript}
                          </p>
                          <div className="flex gap-3 mt-4">
                            <button
                              onClick={() => {
                                void navigator.clipboard.writeText(
                                  activeScenario.prompt,
                                );
                                setCopied(true);
                                window.setTimeout(() => setCopied(false), 1500);
                              }}
                              className="text-xs text-cyan-200 flex items-center gap-2"
                            >
                              {copied ? (
                                <Check className="w-3 h-3" />
                              ) : (
                                <Clipboard className="w-3 h-3" />
                              )}{" "}
                              Copy agent prompt
                            </button>
                            {activeScenario.prerecordedAudioUrl && (
                              <button
                                onClick={() =>
                                  void playBenchmarkAudio(
                                    activeScenario.prerecordedAudioUrl,
                                  )
                                }
                                className="text-xs text-violet-200 flex items-center gap-2"
                              >
                                <FileAudio className="w-3 h-3" /> Play reference
                                WAV
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3 mt-5">
                          {activeRun.status !== "running" ? (
                            <Button onClick={() => launchRun(activeRun)}>
                              <Play className="w-4 h-4" /> Launch isolated
                              session
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              onClick={() => finishRun("failed")}
                            >
                              <Square className="w-4 h-4" /> Mark failed
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            onClick={() => setPresentationRun(activeRun)}
                          >
                            <Maximize2 className="w-4 h-4" /> 16:9 Video mode
                          </Button>
                        </div>
                      </Card>

                      <Card className="p-6 bg-slate-900/60">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs uppercase tracking-[.25em] text-white/40">
                              Live trace
                            </p>
                            <h3 className="text-xl font-semibold text-white mt-1">
                              Synchronized pipeline lanes
                            </h3>
                          </div>
                          <span className="text-xs text-white/35">
                            Browser monotonic clock
                          </span>
                        </div>
                        <div className="space-y-3 mt-5">
                          {[
                            [
                              "User microphone",
                              ["input.", "vad.", "transcript.user"],
                            ],
                            ["OpenAI reasoning", ["response."]],
                            ["Voice output", ["tts.", "audio.", "playback."]],
                          ].map(([label, prefixes]) => {
                            const laneEvents = activeRun.events.filter(
                              (event) =>
                                (prefixes as string[]).some((prefix) =>
                                  event.type.startsWith(prefix),
                                ),
                            );
                            const all = activeRun.events;
                            const start = all[0]?.monotonicMs || 0;
                            const end =
                              all[all.length - 1]?.monotonicMs || start + 1;
                            return (
                              <div
                                key={String(label)}
                                className="grid grid-cols-[140px_1fr] items-center gap-3"
                              >
                                <span className="text-[10px] uppercase tracking-[.2em] text-white/40">
                                  {String(label)}
                                </span>
                                <div className="h-14 rounded-lg border border-white/5 bg-black/20 relative overflow-hidden">
                                  <div className="absolute left-3 right-3 top-1/2 h-px bg-white/10" />
                                  {laneEvents.map((event) => (
                                    <span
                                      key={event.id}
                                      className="absolute top-2 bottom-2 w-px bg-cyan-300"
                                      style={{
                                        left: `${3 + ((event.monotonicMs - start) / Math.max(1, end - start)) * 94}%`,
                                      }}
                                      title={event.type}
                                    />
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-5">
                          {calculateBenchmarkMetrics(activeRun.events).map(
                            (metric) => (
                              <div
                                key={metric.name}
                                className="rounded-xl border border-white/10 bg-black/20 p-3"
                              >
                                <p className="text-[9px] uppercase tracking-[.15em] text-white/35">
                                  {metric.name.replace(/_/g, " ")}
                                </p>
                                <p className="text-xl font-semibold text-cyan-100 mt-1">
                                  {Math.round(metric.value)}
                                  <span className="text-xs text-white/40 ml-1">
                                    ms
                                  </span>
                                </p>
                              </div>
                            ),
                          )}
                        </div>
                      </Card>

                      {activeRun.status === "running" && (
                        <Card className="p-6 bg-slate-900/60">
                          <p className="text-xs uppercase tracking-[.25em] text-white/40">
                            Blinded listening score
                          </p>
                          <div className="grid md:grid-cols-2 gap-x-7 gap-y-4 mt-5">
                            {[
                              ["naturalness", "Naturalness"],
                              ["expressiveness", "Expressiveness"],
                              ["emotionalAppropriateness", "Emotional fit"],
                              ["pronunciation", "Pronunciation"],
                              ["transcriptAccuracy", "Transcript accuracy"],
                              ["semanticCorrectness", "Semantic correctness"],
                              ["voiceConsistency", "Voice consistency"],
                              ["turnTaking", "Turn-taking"],
                              ["instructionFollowing", "Instruction following"],
                            ].map(([key, label]) => (
                              <label key={key}>
                                <span className="flex justify-between text-xs text-white/60">
                                  <span>{label}</span>
                                  <b className="text-white">
                                    {Number(
                                      rating[key as keyof BenchmarkRating],
                                    )}
                                  </b>
                                </span>
                                <input
                                  type="range"
                                  min="1"
                                  max="5"
                                  value={Number(
                                    rating[key as keyof BenchmarkRating],
                                  )}
                                  onChange={(event) =>
                                    setRating({
                                      ...rating,
                                      [key]: Number(event.target.value),
                                    })
                                  }
                                  className="w-full accent-violet-400 mt-1"
                                />
                              </label>
                            ))}
                          </div>
                          <div className="mt-5 pt-4 border-t border-white/10">
                            <p className="text-[10px] uppercase tracking-[.2em] text-white/35">
                              Observed reliability flags
                            </p>
                            <div className="flex flex-wrap gap-2 mt-3">
                              {[
                                ["falseCutoff", "False cutoff"],
                                ["falseActivation", "False activation"],
                                ["missedTrailingWord", "Missed trailing word"],
                                ["audioGap", "Audio gap"],
                                ["clipping", "Clipping"],
                                ["reconnect", "Reconnect"],
                              ].map(([key, label]) => (
                                <label
                                  key={key}
                                  className={cn(
                                    "rounded-full border px-3 py-1.5 text-xs cursor-pointer",
                                    rating.qualityFlags[
                                      key as keyof BenchmarkRating["qualityFlags"]
                                    ]
                                      ? "border-rose-400/40 bg-rose-500/10 text-rose-200"
                                      : "border-white/10 text-white/45",
                                  )}
                                >
                                  <input
                                    type="checkbox"
                                    className="sr-only"
                                    checked={
                                      rating.qualityFlags[
                                        key as keyof BenchmarkRating["qualityFlags"]
                                      ]
                                    }
                                    onChange={(event) =>
                                      setRating({
                                        ...rating,
                                        qualityFlags: {
                                          ...rating.qualityFlags,
                                          [key]: event.target.checked,
                                        },
                                      })
                                    }
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>
                          </div>
                          <textarea
                            value={rating.notes}
                            onChange={(event) =>
                              setRating({
                                ...rating,
                                notes: event.target.value,
                              })
                            }
                            placeholder="Pronunciation errors, leaked audio after interruption, glitches, emotional moments…"
                            className={`${inputClass} min-h-24 mt-5`}
                          />
                          <Button
                            className="w-full mt-4"
                            onClick={() => finishRun("completed")}
                          >
                            <Save className="w-4 h-4" /> Complete run and
                            calculate metrics
                          </Button>
                        </Card>
                      )}
                    </>
                  ) : (
                    <Card className="p-10 text-center">
                      <Check className="w-8 h-8 text-emerald-300 mx-auto" />
                      <h2 className="text-xl font-semibold mt-4">
                        Run queue complete
                      </h2>
                      <Button
                        className="mt-5"
                        onClick={() => setView("results")}
                      >
                        Open results
                      </Button>
                    </Card>
                  )}
                </div>

                <aside className="space-y-6 xl:sticky xl:top-6">
                  <Card className="p-5 bg-slate-900/70">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[.2em] text-white/40">
                          Run queue
                        </p>
                        <h3 className="font-semibold text-white mt-1">
                          {completedCount} completed
                        </h3>
                      </div>
                      <span className="text-xl font-semibold text-cyan-100">
                        {experiment.runs.length
                          ? Math.round(
                              (completedCount / experiment.runs.length) * 100,
                            )
                          : 0}
                        %
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/5 mt-4 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-400 to-violet-400"
                        style={{
                          width: `${experiment.runs.length ? (completedCount / experiment.runs.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="max-h-[420px] overflow-y-auto mt-4 space-y-1">
                      {experiment.runs.slice(0, 120).map((run) => {
                        const variant = experiment.variants.find(
                          (item) => item.id === run.variantId,
                        );
                        const scenario = experiment.scenarios.find(
                          (item) => item.id === run.scenarioId,
                        );
                        return (
                          <button
                            key={run.id}
                            onClick={() => setActiveRunId(run.id)}
                            className={cn(
                              "w-full rounded-lg px-3 py-2 flex items-center gap-3 text-left text-xs",
                              activeRunId === run.id
                                ? "bg-violet-500/15 border border-violet-400/25"
                                : "hover:bg-white/5 border border-transparent",
                            )}
                          >
                            <span
                              className={cn(
                                "w-2 h-2 rounded-full",
                                run.status === "completed"
                                  ? "bg-emerald-400"
                                  : run.status === "running"
                                    ? "bg-rose-400 animate-pulse"
                                    : run.status === "failed"
                                      ? "bg-amber-400"
                                      : "bg-white/15",
                              )}
                            />
                            <span className="w-5 text-white/35">
                              {variant?.slot}
                            </span>
                            <span className="flex-1 truncate text-white/65">
                              {scenario?.name}
                            </span>
                            <span className="text-white/30">
                              #{run.runNumber}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </Card>
                  <Card className="p-5 bg-slate-900/70">
                    <button
                      onClick={() => setMethodOpen((value) => !value)}
                      className="w-full flex items-center justify-between"
                    >
                      <span className="font-semibold text-white">
                        Methodology guardrails
                      </span>
                      <ChevronRight
                        className={cn(
                          "w-4 h-4 transition",
                          methodOpen && "rotate-90",
                        )}
                      />
                    </button>
                    {methodOpen && (
                      <ul className="mt-4 space-y-3 text-xs text-white/50">
                        {[
                          "Agent settings are immutable snapshots.",
                          "Variant order is randomized per repetition.",
                          "Cold and warm sessions are reported separately.",
                          "Pipeline durations stay within one clock domain.",
                          "Main comparison avoids Eleven-specific audio tags.",
                          "Use at least 20 runs for publishable percentiles.",
                        ].map((item) => (
                          <li key={item} className="flex gap-2">
                            <Check className="w-3 h-3 text-emerald-300 shrink-0 mt-0.5" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </aside>
              </div>
            )}

            {view === "results" && (
              <BenchmarkResults
                experiment={experiment}
                onPresentation={(run) => setPresentationRun(run || null)}
                onPublish={publish}
              />
            )}
          </div>
        </div>
      </MainLayout>
      {presentationRun !== undefined && presentationRun !== null && (
        <BenchmarkPresentation
          experiment={experiment}
          run={presentationRun}
          onClose={() => setPresentationRun(undefined)}
        />
      )}
    </>
  );
}
