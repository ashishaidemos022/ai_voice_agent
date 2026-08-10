/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase RPC has no generated database types in this project. */
import { useEffect, useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import type {
  BenchmarkExperiment,
  BenchmarkRun,
} from "../../types/voice-benchmark";
import { BenchmarkResults } from "./BenchmarkResults";
import { BenchmarkPresentation } from "./BenchmarkPresentation";

export function PublicBenchmarkReport({ slug }: { slug: string }) {
  const [experiment, setExperiment] = useState<BenchmarkExperiment | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<BenchmarkRun | undefined>();

  useEffect(() => {
    const load = async () => {
      const { data, error: reportError } = await supabase.rpc(
        "get_public_voice_benchmark_report",
        { target_slug: slug },
      );
      if (reportError || !data?.experiment) {
        throw reportError || new Error("Benchmark report not found");
      }
      const row = data.experiment;
      const runs: BenchmarkRun[] = (data.runs || []).map((run: any) => ({
        id: run.id,
        experimentId: row.id,
        variantId: run.variant_id,
        scenarioId: run.scenario_id,
        runNumber: run.run_number,
        runOrder: run.run_order,
        traceId: run.trace_id,
        temperature: run.temperature,
        status: run.status,
        userTranscript: run.user_transcript || undefined,
        assistantTranscript: run.assistant_transcript || undefined,
        outputAudioUrl: run.output_audio_url || undefined,
        failureReason: run.failure_reason || undefined,
        startedAt: run.started_at || undefined,
        completedAt: run.completed_at || undefined,
        estimatedCost: run.estimated_cost || undefined,
        rating: run.rating_snapshot || undefined,
        waveforms: run.waveform_snapshot || undefined,
        events: (run.events || []).map((event: any) => ({
          id: String(event.id),
          runId: run.id,
          traceId: event.trace_id,
          turnId: event.turn_id || undefined,
          type: event.event_type,
          clockDomain: event.clock_domain,
          monotonicMs: event.monotonic_ms,
          wallTime: event.wall_time,
          metadata: {},
        })),
        metrics: (run.metrics || []).map((metric: any) => ({
          name: metric.metric_name,
          value: metric.metric_value,
          unit: "ms",
        })),
      }));
      setExperiment({
        id: row.id,
        userId: "public",
        name: row.name,
        description: row.description || "",
        status: row.status,
        repetitionCount: row.repetition_count,
        randomizedOrder: row.randomized_order,
        blindComparison: row.blind_comparison,
        includeColdRuns: row.include_cold_runs,
        environmentSnapshot: {},
        shareSlug: row.share_slug,
        isPublic: true,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        variants: (data.variants || []).map((variant: any) => ({
          id: variant.id,
          slot: variant.slot,
          name: variant.name,
          architecture: variant.architecture,
          provider: variant.provider,
          model: variant.model || "",
          voice: variant.voice || "",
          agentConfigId: "",
          configSnapshot: {},
          estimatedCostPerMinute:
            variant.estimated_cost_per_minute || undefined,
        })),
        scenarios: (data.scenarios || []).map((scenario: any) => ({
          id: scenario.id,
          key: scenario.scenario_key,
          name: scenario.name,
          category: scenario.category,
          prompt: scenario.prompt,
          inputTranscript: scenario.input_transcript || "",
          durationSeconds: scenario.settings?.duration_seconds || 0,
          expectedBehavior: scenario.expected_behavior || [],
          enabled: scenario.settings?.enabled ?? true,
          pauseMs: scenario.settings?.pause_ms || undefined,
        })),
        runs,
      });
    };
    void load().catch((reason) =>
      setError(
        reason instanceof Error ? reason.message : "Unable to load report",
      ),
    );
  }, [slug]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#05070f] text-white flex items-center justify-center p-6">
        <div className="text-center">
          <FlaskConical className="w-10 h-10 text-rose-300 mx-auto" />
          <h1 className="text-2xl font-semibold mt-4">Report unavailable</h1>
          <p className="text-white/50 mt-2">{error}</p>
        </div>
      </div>
    );
  }
  if (!experiment) {
    return (
      <div className="min-h-screen bg-[#05070f] text-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-200" />
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-[#05070f] text-white">
      <header className="border-b border-white/10 bg-slate-950/70 px-6 py-5">
        <div className="max-w-[1500px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-300 to-violet-400 flex items-center justify-center">
              <FlaskConical className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[.3em] text-white/35">
                Public Voice Lab report
              </p>
              <h1 className="text-xl font-semibold">{experiment.name}</h1>
            </div>
          </div>
          <span className="text-xs text-white/35">
            Published {new Date(experiment.updatedAt).toLocaleDateString()}
          </span>
        </div>
      </header>
      <main className="max-w-[1500px] mx-auto p-6 lg:p-8">
        <BenchmarkResults
          experiment={experiment}
          onPresentation={(run) => setPresentation(run)}
          onPublish={() => undefined}
          readOnly
        />
      </main>
      {presentation && (
        <BenchmarkPresentation
          experiment={experiment}
          run={presentation}
          onClose={() => setPresentation(undefined)}
        />
      )}
    </div>
  );
}
