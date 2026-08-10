import { useMemo, useState } from "react";
import { Download, ExternalLink, Play, Trophy } from "lucide-react";
import type {
  BenchmarkExperiment,
  BenchmarkMetricName,
  BenchmarkRun,
} from "../../types/voice-benchmark";
import { metricSummary } from "../../lib/benchmark-service";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { cn } from "../../lib/utils";
import { playBenchmarkAudio } from "../../lib/benchmark-audio-store";

type Props = {
  experiment: BenchmarkExperiment;
  onPresentation: (run?: BenchmarkRun) => void;
  onPublish: () => void;
  readOnly?: boolean;
};

const METRICS: Array<{ key: BenchmarkMetricName; label: string }> = [
  { key: "connection_ms", label: "Session connection" },
  { key: "response_created_ms", label: "Endpoint → response" },
  { key: "llm_ttft_ms", label: "LLM TTFT" },
  { key: "tts_ttfa_ms", label: "TTS TTFA" },
  { key: "playback_delay_ms", label: "Playback delay" },
  { key: "end_to_end_ms", label: "End-to-end" },
  { key: "barge_in_cutoff_ms", label: "Barge-in cutoff" },
];

const ratingAverage = (run: BenchmarkRun) => {
  if (!run.rating) return null;
  const values = [
    run.rating.naturalness,
    run.rating.expressiveness,
    run.rating.emotionalAppropriateness,
    run.rating.pronunciation,
    run.rating.transcriptAccuracy,
    run.rating.semanticCorrectness,
    run.rating.voiceConsistency,
    run.rating.turnTaking,
    run.rating.instructionFollowing,
  ];
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const variantRuns = (experiment: BenchmarkExperiment, variantId: string) =>
  experiment.runs.filter(
    (run) => run.variantId === variantId && run.status === "completed",
  );

const colors = ["#67e8f9", "#c4b5fd", "#fbbf24"];

export function BenchmarkResults({
  experiment,
  onPresentation,
  onPublish,
  readOnly = false,
}: Props) {
  const completed = experiment.runs.filter((run) => run.status === "completed");
  const [selectedRunId, setSelectedRunId] = useState(completed[0]?.id || "");
  const selectedRun =
    completed.find((run) => run.id === selectedRunId) || completed[0];

  const tradeoff = useMemo(
    () =>
      experiment.variants.map((variant, index) => {
        const runs = variantRuns(experiment, variant.id);
        const latency = metricSummary(runs, "end_to_end_ms").p50 || 0;
        const ratings = runs
          .map(ratingAverage)
          .filter((value): value is number => value !== null);
        const naturalness = ratings.length
          ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length
          : 0;
        const cost = variant.estimatedCostPerMinute || 0.01;
        return { variant, latency, naturalness, cost, color: colors[index] };
      }),
    [experiment],
  );

  const exportFile = (kind: "json" | "csv") => {
    let contents: string;
    let type: string;
    if (kind === "json") {
      contents = JSON.stringify(experiment, null, 2);
      type = "application/json";
    } else {
      const header = [
        "run_id",
        "variant",
        "scenario",
        "repetition",
        "temperature",
        "metric",
        "value_ms",
        "status",
      ];
      const rows = experiment.runs.flatMap((run) => {
        const variant = experiment.variants.find(
          (item) => item.id === run.variantId,
        );
        const scenario = experiment.scenarios.find(
          (item) => item.id === run.scenarioId,
        );
        return (
          run.metrics.length ? run.metrics : [{ name: "", value: "" }]
        ).map((metric) => [
          run.id,
          variant?.name || "",
          scenario?.name || "",
          run.runNumber,
          run.temperature,
          metric.name,
          metric.value,
          run.status,
        ]);
      });
      contents = [header, ...rows]
        .map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
        )
        .join("\n");
      type = "text/csv";
    }
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${experiment.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${kind}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!completed.length) {
    return (
      <Card className="p-10 text-center bg-slate-900/60">
        <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-400/20 mx-auto flex items-center justify-center">
          <Trophy className="w-6 h-6 text-violet-200" />
        </div>
        <h2 className="text-xl font-semibold text-white mt-4">
          Results appear after completed runs
        </h2>
        <p className="text-sm text-white/50 mt-2">
          Run at least one variant and save its trace and rating to unlock
          percentiles, tradeoff charts, and replay.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 justify-end">
        <Button variant="outline" size="sm" onClick={() => exportFile("csv")}>
          <Download className="w-4 h-4" /> CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportFile("json")}>
          <Download className="w-4 h-4" /> JSON + events
        </Button>
        {!readOnly && (
          <Button variant="outline" size="sm" onClick={onPublish}>
            <ExternalLink className="w-4 h-4" /> Publish report
          </Button>
        )}
        <Button size="sm" onClick={() => onPresentation(selectedRun)}>
          <Play className="w-4 h-4" /> Video mode
        </Button>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {experiment.variants.map((variant, index) => {
          const runs = variantRuns(experiment, variant.id);
          const e2e = metricSummary(runs, "end_to_end_ms");
          return (
            <Card
              key={variant.id}
              className="p-5 bg-slate-900/60"
              style={{ borderColor: `${colors[index]}55` }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-xs uppercase tracking-[0.2em]"
                  style={{ color: colors[index] }}
                >
                  Variant {variant.slot}
                </span>
                <span className="text-xs text-white/40">n={e2e.count}</span>
              </div>
              <h3 className="text-lg font-semibold text-white mt-2">
                {variant.name}
              </h3>
              <p className="text-xs text-white/40 mt-1">
                {variant.architecture.replace(/_/g, " ")}
              </p>
              <div className="grid grid-cols-3 gap-2 mt-5 text-center">
                {[
                  ["p50", e2e.p50],
                  ["p90", e2e.p90],
                  ["p95", e2e.p95],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-xl bg-black/20 border border-white/5 p-2"
                  >
                    <p className="text-[10px] uppercase text-white/35">
                      {label}
                    </p>
                    <p className="text-sm font-semibold text-white mt-1">
                      {value === null ? "—" : `${Math.round(Number(value))}ms`}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-white/40">
                <span>Cost / successful turn</span>
                <span className="font-semibold text-white/70">
                  {runs.length &&
                  runs.some((run) => run.estimatedCost !== undefined)
                    ? `$${(runs.reduce((sum, run) => sum + (run.estimatedCost || 0), 0) / runs.length).toFixed(4)}`
                    : "Set cost in builder"}
                </span>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid xl:grid-cols-2 gap-6">
        <Card className="p-6 bg-slate-900/60">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-white/40">
              Core tradeoff
            </p>
            <h3 className="text-xl font-semibold text-white mt-1">
              Latency vs. naturalness
            </h3>
            <p className="text-xs text-white/40 mt-1">
              Bubble size represents estimated cost per minute.
            </p>
          </div>
          <div className="mt-5 relative">
            <svg
              viewBox="0 0 600 320"
              className="w-full"
              role="img"
              aria-label="Latency versus naturalness chart"
            >
              {[0, 1, 2, 3, 4].map((index) => (
                <line
                  key={`h-${index}`}
                  x1="60"
                  x2="575"
                  y1={35 + index * 58}
                  y2={35 + index * 58}
                  stroke="rgba(255,255,255,.08)"
                />
              ))}
              {[0, 1, 2, 3, 4].map((index) => (
                <line
                  key={`v-${index}`}
                  y1="25"
                  y2="270"
                  x1={60 + index * 128}
                  x2={60 + index * 128}
                  stroke="rgba(255,255,255,.06)"
                />
              ))}
              <text
                x="300"
                y="310"
                fill="rgba(255,255,255,.45)"
                fontSize="12"
                textAnchor="middle"
              >
                End-to-end latency (faster → slower)
              </text>
              <text
                x="15"
                y="150"
                fill="rgba(255,255,255,.45)"
                fontSize="12"
                transform="rotate(-90 15 150)"
                textAnchor="middle"
              >
                Naturalness score
              </text>
              {tradeoff.map((point) => {
                const x = 70 + Math.min(1, point.latency / 3000) * 490;
                const y = 270 - Math.min(1, point.naturalness / 5) * 230;
                const radius = 12 + Math.min(20, point.cost * 40);
                return (
                  <g key={point.variant.id}>
                    <circle
                      cx={x}
                      cy={y}
                      r={radius}
                      fill={`${point.color}44`}
                      stroke={point.color}
                      strokeWidth="2"
                    />
                    <text
                      x={x}
                      y={y + 4}
                      fill="white"
                      fontSize="11"
                      textAnchor="middle"
                    >
                      {point.variant.slot}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="flex flex-wrap gap-4 justify-center mt-2">
              {tradeoff.map((point) => (
                <span key={point.variant.id} className="text-xs text-white/50">
                  <i
                    className="inline-block w-2 h-2 rounded-full mr-1"
                    style={{ background: point.color }}
                  />
                  {point.variant.slot} · {point.variant.name}
                </span>
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-6 bg-slate-900/60 overflow-x-auto">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-white/40">
              Distribution
            </p>
            <h3 className="text-xl font-semibold text-white mt-1">
              Pipeline percentiles
            </h3>
          </div>
          <table className="w-full mt-5 text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-white/35 border-b border-white/10">
                <th className="pb-3">Metric</th>
                {experiment.variants.map((variant) => (
                  <th key={variant.id} className="pb-3 text-right">
                    {variant.slot} p50 / p95
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((metric) => (
                <tr key={metric.key} className="border-b border-white/5">
                  <td className="py-3 text-white/65">{metric.label}</td>
                  {experiment.variants.map((variant) => {
                    const summary = metricSummary(
                      variantRuns(experiment, variant.id),
                      metric.key,
                    );
                    return (
                      <td
                        key={variant.id}
                        className="py-3 text-right text-white"
                      >
                        {summary.p50 === null
                          ? "—"
                          : `${Math.round(summary.p50)} / ${Math.round(summary.p95 || summary.p50)} ms`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid xl:grid-cols-2 gap-6">
        <Card className="p-6 bg-slate-900/60">
          <p className="text-xs uppercase tracking-[0.25em] text-white/40">
            Endpointing robustness
          </p>
          <h3 className="text-xl font-semibold text-white mt-1">
            VAD pause-threshold curve
          </h3>
          <p className="text-xs text-white/40 mt-1">
            Lower endpointing delay is better, provided the utterance was not
            cut off.
          </p>
          <svg
            viewBox="0 0 600 270"
            className="w-full mt-5"
            role="img"
            aria-label="VAD pause threshold curve"
          >
            {[0, 1, 2, 3].map((index) => (
              <line
                key={index}
                x1="55"
                x2="575"
                y1={35 + index * 58}
                y2={35 + index * 58}
                stroke="rgba(255,255,255,.08)"
              />
            ))}
            {experiment.variants.map((variant, variantIndex) => {
              const points = experiment.scenarios
                .filter((scenario) => scenario.pauseMs)
                .sort((a, b) => Number(a.pauseMs) - Number(b.pauseMs))
                .map((scenario, index, all) => {
                  const runs = variantRuns(experiment, variant.id).filter(
                    (run) => run.scenarioId === scenario.id,
                  );
                  const values = runs.flatMap((run) =>
                    run.metrics
                      .filter((metric) => metric.name === "endpointing_ms")
                      .map((metric) => metric.value),
                  );
                  const value = values.length
                    ? values.reduce((sum, item) => sum + item, 0) /
                      values.length
                    : 0;
                  return {
                    x: 70 + (index / Math.max(1, all.length - 1)) * 480,
                    y: value ? 230 - Math.min(1, value / 1600) * 190 : 230,
                    pause: scenario.pauseMs,
                  };
                });
              return (
                <g key={variant.id}>
                  <path
                    d={points
                      .map(
                        (point, index) =>
                          `${index ? "L" : "M"}${point.x},${point.y}`,
                      )
                      .join(" ")}
                    fill="none"
                    stroke={colors[variantIndex]}
                    strokeWidth="2"
                  />
                  {points.map((point) => (
                    <circle
                      key={point.pause}
                      cx={point.x}
                      cy={point.y}
                      r="5"
                      fill={colors[variantIndex]}
                    >
                      <title>
                        {variant.name} · {point.pause}ms pause
                      </title>
                    </circle>
                  ))}
                </g>
              );
            })}
            {[200, 500, 900, 1300].map((pause, index) => (
              <text
                key={pause}
                x={70 + (index / 3) * 480}
                y="255"
                fill="rgba(255,255,255,.4)"
                fontSize="11"
                textAnchor="middle"
              >
                {pause}ms
              </text>
            ))}
          </svg>
        </Card>

        <Card className="p-6 bg-slate-900/60 overflow-x-auto">
          <p className="text-xs uppercase tracking-[0.25em] text-white/40">
            Scenario performance
          </p>
          <h3 className="text-xl font-semibold text-white mt-1">
            Language and behavior heatmap
          </h3>
          <table className="w-full mt-5 text-xs">
            <thead>
              <tr className="text-white/35 border-b border-white/10">
                <th className="text-left pb-3">Scenario</th>
                {experiment.variants.map((variant) => (
                  <th key={variant.id} className="text-center pb-3">
                    {variant.slot}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {experiment.scenarios
                .filter((scenario) => scenario.enabled && !scenario.pauseMs)
                .map((scenario) => (
                  <tr key={scenario.id} className="border-b border-white/5">
                    <td className="py-2.5 text-white/60">{scenario.name}</td>
                    {experiment.variants.map((variant) => {
                      const runs = variantRuns(experiment, variant.id).filter(
                        (run) => run.scenarioId === scenario.id,
                      );
                      const scores = runs
                        .map(ratingAverage)
                        .filter((score): score is number => score !== null);
                      const score = scores.length
                        ? scores.reduce((sum, value) => sum + value, 0) /
                          scores.length
                        : null;
                      return (
                        <td key={variant.id} className="py-2.5 text-center">
                          <span
                            className={cn(
                              "inline-flex w-10 h-7 items-center justify-center rounded-md font-semibold",
                              score === null
                                ? "bg-white/5 text-white/25"
                                : score >= 4
                                  ? "bg-emerald-500/25 text-emerald-200"
                                  : score >= 3
                                    ? "bg-amber-500/20 text-amber-200"
                                    : "bg-rose-500/20 text-rose-200",
                            )}
                          >
                            {score === null ? "—" : score.toFixed(1)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid xl:grid-cols-[1.4fr_1fr] gap-6">
        <Card className="p-6 bg-slate-900/60">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-white/40">
                Synchronized replay
              </p>
              <h3 className="text-xl font-semibold text-white mt-1">
                Transcript + event waterfall
              </h3>
            </div>
            <select
              value={selectedRun?.id || ""}
              onChange={(event) => setSelectedRunId(event.target.value)}
              className="rounded-lg bg-slate-950 border border-white/10 px-3 py-2 text-xs text-white"
            >
              {completed.map((run) => {
                const variant = experiment.variants.find(
                  (item) => item.id === run.variantId,
                );
                const scenario = experiment.scenarios.find(
                  (item) => item.id === run.scenarioId,
                );
                return (
                  <option key={run.id} value={run.id}>
                    {variant?.slot} · {scenario?.name} · #{run.runNumber}
                  </option>
                );
              })}
            </select>
          </div>
          {selectedRun && (
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/10 p-3">
                  <p className="text-[10px] uppercase text-white/35">User</p>
                  <p className="text-sm text-white/70 mt-2">
                    {selectedRun.userTranscript || "Transcript not captured"}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 p-3">
                  <p className="text-[10px] uppercase text-white/35">
                    Assistant
                  </p>
                  <p className="text-sm text-white/70 mt-2">
                    {selectedRun.assistantTranscript ||
                      "Transcript not captured"}
                  </p>
                </div>
              </div>
              {selectedRun.outputAudioUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void playBenchmarkAudio(selectedRun.outputAudioUrl)
                  }
                >
                  <Play className="w-4 h-4" /> Replay preserved output audio
                </Button>
              )}
              <div className="relative h-28 rounded-xl border border-white/10 bg-slate-950/70 overflow-hidden">
                <div className="absolute left-4 right-4 top-1/2 h-px bg-white/15" />
                {selectedRun.events.map((event, index) => {
                  const start = selectedRun.events[0]?.monotonicMs || 0;
                  const end =
                    selectedRun.events[selectedRun.events.length - 1]
                      ?.monotonicMs || start + 1;
                  const left =
                    3 +
                    ((event.monotonicMs - start) / Math.max(1, end - start)) *
                      92;
                  return (
                    <div
                      key={event.id}
                      className={cn(
                        "absolute top-5 bottom-5 w-px",
                        event.type.includes("error")
                          ? "bg-rose-400"
                          : event.type.includes("audio") ||
                              event.type.includes("playback")
                            ? "bg-violet-300"
                            : "bg-cyan-300",
                      )}
                      style={{ left: `${left}%` }}
                      title={`${event.type} · ${(event.monotonicMs - start).toFixed(0)}ms`}
                    >
                      <span className="absolute top-full mt-1 text-[8px] text-white/35 -rotate-45 origin-top-left whitespace-nowrap">
                        {index % 2 === 0 ? event.type.replace(/.*\./, "") : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-6 bg-slate-900/60">
          <p className="text-xs uppercase tracking-[0.25em] text-white/40">
            Category winners
          </p>
          <h3 className="text-xl font-semibold text-white mt-1">
            No misleading overall winner
          </h3>
          <div className="space-y-3 mt-5">
            {METRICS.slice(0, 5).map((metric) => {
              const ranked = experiment.variants
                .map((variant) => ({
                  variant,
                  value: metricSummary(
                    variantRuns(experiment, variant.id),
                    metric.key,
                  ).p50,
                }))
                .filter((item) => item.value !== null)
                .sort((a, b) => Number(a.value) - Number(b.value));
              return (
                <div
                  key={metric.key}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3"
                >
                  <span className="text-sm text-white/60">{metric.label}</span>
                  <span className="text-sm font-semibold text-amber-200">
                    {ranked[0]
                      ? `${ranked[0].variant.slot} · ${ranked[0].variant.name}`
                      : "Not enough data"}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 p-3 text-center">
              <p className="text-xl font-semibold text-white">
                {completed.reduce(
                  (sum, run) =>
                    sum +
                    run.events.filter((event) => event.type === "audio.gap")
                      .length +
                    (run.rating?.qualityFlags.audioGap ? 1 : 0),
                  0,
                )}
              </p>
              <p className="text-[10px] uppercase text-white/35 mt-1">
                Audio gaps
              </p>
            </div>
            <div className="rounded-xl border border-white/10 p-3 text-center">
              <p className="text-xl font-semibold text-white">
                {
                  experiment.runs.filter((run) => run.status === "failed")
                    .length
                }
              </p>
              <p className="text-[10px] uppercase text-white/35 mt-1">
                Failed runs
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
