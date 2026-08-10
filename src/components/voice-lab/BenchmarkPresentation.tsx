import { useEffect, useState } from "react";
import { Eye, EyeOff, Maximize2, X } from "lucide-react";
import type {
  BenchmarkExperiment,
  BenchmarkRun,
} from "../../types/voice-benchmark";
import { Button } from "../ui/Button";

type Props = {
  experiment: BenchmarkExperiment;
  run?: BenchmarkRun;
  onClose: () => void;
};

export function BenchmarkPresentation({ experiment, run, onClose }: Props) {
  const [showMethod, setShowMethod] = useState(false);
  const variant = experiment.variants.find(
    (item) => item.id === run?.variantId,
  );
  const scenario = experiment.scenarios.find(
    (item) => item.id === run?.scenarioId,
  );
  const currentIndex = run
    ? experiment.runs.findIndex((item) => item.id === run.id) + 1
    : 0;
  const [elapsed, setElapsed] = useState(0);
  const waveformPath = (lane: number) => {
    if (!run) return "M0,22 L1000,22";
    if (lane === 1) {
      const events = run.events.filter((event) =>
        event.type.startsWith("response."),
      );
      const start = run.events[0]?.monotonicMs || 0;
      const end = run.events[run.events.length - 1]?.monotonicMs || start + 1;
      return [
        `M0,22`,
        ...events.flatMap((event) => {
          const x =
            ((event.monotonicMs - start) / Math.max(1, end - start)) * 1000;
          return [`L${x},22`, `L${x + 3},7`, `L${x + 6},35`, `L${x + 9},22`];
        }),
        `L1000,22`,
      ].join(" ");
    }
    const samples =
      lane === 0 ? run.waveforms?.user || [] : run.waveforms?.output || [];
    if (!samples.length) return "M0,22 L1000,22";
    return samples
      .map((sample, index) => {
        const x = (index / Math.max(1, samples.length - 1)) * 1000;
        return `${index ? "L" : "M"}${x},${22 - sample.value * 20}`;
      })
      .join(" ");
  };

  useEffect(() => {
    if (!run?.startedAt || run.status !== "running") return;
    const update = () =>
      setElapsed(Date.now() - new Date(run.startedAt!).getTime());
    update();
    const timer = window.setInterval(update, 50);
    return () => window.clearInterval(timer);
  }, [run?.startedAt, run?.status]);

  return (
    <div className="fixed inset-0 z-[100] bg-[#03050b] text-white flex items-center justify-center p-4">
      <div className="relative aspect-video w-full max-w-[1600px] border border-white/10 bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,.12),transparent_40%),radial-gradient(circle_at_90%_80%,rgba(139,92,246,.13),transparent_45%)] rounded-3xl overflow-hidden p-[4%] flex flex-col">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[.35em] text-cyan-200">
              <Maximize2 className="w-4 h-4" /> Voice Lab · Live benchmark
            </div>
            <h1 className="text-[clamp(2rem,4vw,4.5rem)] font-semibold mt-4 font-display">
              {scenario?.name || "Experiment overview"}
            </h1>
            <p className="text-[clamp(.8rem,1.3vw,1.25rem)] text-white/50 mt-2">
              {experiment.name}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowMethod((value) => !value)}
            >
              {showMethod ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}{" "}
              Method
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center gap-[5%]">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs uppercase tracking-[.3em] text-white/40">
                Current variant
              </p>
              <p className="text-[clamp(1.4rem,2.5vw,3rem)] font-semibold mt-2">
                {experiment.blindComparison
                  ? `Voice ${variant?.slot || "—"}`
                  : variant?.name || "—"}
              </p>
              {!experiment.blindComparison && (
                <p className="text-white/40 mt-1">
                  {variant?.architecture.replace(/_/g, " ")}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-[.3em] text-white/40">
                Response onset
              </p>
              <p className="text-[clamp(2.5rem,6vw,7rem)] leading-none tabular-nums font-light text-cyan-100 mt-2">
                {run?.metrics.find((metric) => metric.name === "end_to_end_ms")
                  ?.value
                  ? `${Math.round(run.metrics.find((metric) => metric.name === "end_to_end_ms")!.value)}ms`
                  : `${(elapsed / 1000).toFixed(2)}s`}
              </p>
            </div>
          </div>
          <div className="space-y-4">
            {[
              ["USER MICROPHONE", "#67e8f9"],
              ["OPENAI / REASONING", "#fbbf24"],
              ["VOICE OUTPUT", "#c4b5fd"],
            ].map(([label, color], lane) => (
              <div
                key={label}
                className="grid grid-cols-[180px_1fr] items-center gap-5"
              >
                <span className="text-[10px] uppercase tracking-[.25em] text-white/40">
                  {label}
                </span>
                <svg
                  viewBox="0 0 1000 44"
                  preserveAspectRatio="none"
                  className="w-full h-11 rounded-lg bg-white/[.025]"
                >
                  <path
                    d={waveformPath(lane)}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    opacity=".8"
                  />
                </svg>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-end justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[.3em] text-white/35">
              Test input
            </p>
            <p className="text-[clamp(.9rem,1.4vw,1.35rem)] text-white/70 mt-2 line-clamp-2">
              {scenario?.inputTranscript || scenario?.prompt || "Select a run"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">
              Run {currentIndex || "—"} / {experiment.runs.length || "—"}
            </p>
            <p className="text-xs uppercase tracking-[.25em] text-white/35 mt-1">
              {run?.temperature || "warm"} session
            </p>
          </div>
        </div>

        {showMethod && (
          <div className="absolute inset-x-[18%] top-[22%] rounded-3xl border border-white/15 bg-slate-950/95 backdrop-blur-xl p-8 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Methodology</h2>
              <button onClick={() => setShowMethod(false)}>
                <X className="w-5 h-5 text-white/50" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-5 mt-6 text-sm text-white/60">
              {[
                [
                  "Repetitions",
                  `${experiment.repetitionCount} per scenario / variant`,
                ],
                [
                  "Ordering",
                  experiment.randomizedOrder
                    ? "Randomized every repetition"
                    : "Fixed A → B → C",
                ],
                [
                  "Listening",
                  experiment.blindComparison
                    ? "Provider identities hidden"
                    : "Provider identities visible",
                ],
                [
                  "Timing",
                  "Browser monotonic clock; clock domains never subtracted",
                ],
                ["Configuration", "Immutable agent snapshots"],
                [
                  "Environment",
                  String(
                    experiment.environmentSnapshot.userAgent ||
                      "Captured at experiment creation",
                  ),
                ],
              ].map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-xl border border-white/10 p-4"
                >
                  <p className="text-xs uppercase tracking-[.2em] text-white/35">
                    {key}
                  </p>
                  <p className="text-white/80 mt-2">{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
