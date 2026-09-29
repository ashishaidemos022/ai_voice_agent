import { Loader2 } from 'lucide-react';
import { Card } from '../ui/Card';
import { cn } from '../../lib/utils';
import { useVoiceEval } from '../../hooks/useVoiceEval';
import { SCENARIOS } from '../../../shared/voice-eval/scenarios/index';
import type { FingerprintInput } from '../../../shared/voice-eval/fingerprint';
import { Scorecard } from './Scorecard';

interface EvaluatorPanelProps {
  isConnected: boolean;
  sessionId: string | null;
  agentConfigId: string | null;
  fingerprintInput: FingerprintInput;
}

const VERDICT_STYLE: Record<string, string> = {
  pass: 'border-emerald-400/50 bg-emerald-500/15 text-emerald-100',
  fail: 'border-rose-400/50 bg-rose-500/15 text-rose-100',
  invalid_harness: 'border-amber-300/50 bg-amber-500/15 text-amber-100'
};

export function EvaluatorPanel({ isConnected, sessionId, agentConfigId, fingerprintInput }: EvaluatorPanelProps) {
  const evalRun = useVoiceEval({ sessionId, agentConfigId, fingerprintInput });
  const { phase, scenario } = evalRun;
  const running = phase === 'live' || phase === 'arming' || phase === 'scoring';

  return (
    <Card className="p-5 bg-slate-900/60 border-cyan-400/20 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-white">Evaluator</p>
          <p className="text-xs text-white/50">Scores this call against a scenario. Backend state decides pass/fail.</p>
        </div>
        {(phase === 'arming' || phase === 'scoring') && <Loader2 className="h-4 w-4 animate-spin text-white/70" />}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
        <select
          value={evalRun.scenarioId}
          disabled={running}
          onChange={(e) => evalRun.setScenarioId(e.target.value)}
          className="rounded-lg border border-white/15 bg-slate-950/70 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.title}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-slate-950/60 p-1 text-xs">
          <span className="rounded-md bg-cyan-500/20 px-3 py-1 text-center text-cyan-100">You</span>
          <span className="px-3 py-1 text-center text-white/30" title="Synthetic caller arrives in phase 2">Synthetic</span>
        </div>
      </div>

      {scenario && (
        <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3 text-xs text-white/70">
          <p className="text-white/90">{scenario.goal}</p>
          <p className="mt-2 text-[11px] uppercase tracking-[0.3em] text-white/40">Your details</p>
          <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
            {Object.entries(scenario.facts).map(([key, fact]) => <li key={key}><span className="text-white/40">{key}:</span> {fact.value}</li>)}
          </ul>
          {scenario.beats.length > 0 && (
            <ul className="mt-2 list-disc pl-4 text-white/60">
              {scenario.beats.map((beat, index) => (
                <li key={index}>
                  {beat.kind === 'silence' ? `After turn ${beat.afterTurn}, stay silent ~${Math.round((beat.durationMs ?? 0) / 1000)}s` : beat.kind === 'barge_in' ? `Interrupt the agent's readback: "${beat.line}"` : `Around turn ${beat.afterTurn}: "${beat.line}"`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {phase !== 'live' ? (
          <button
            type="button"
            disabled={!isConnected || phase === 'arming' || phase === 'scoring'}
            onClick={() => { evalRun.reset(); void evalRun.arm(); }}
            className="rounded-lg border border-cyan-300/40 bg-cyan-400/15 px-3 py-2 text-xs font-semibold text-cyan-100 disabled:opacity-40"
          >
            {isConnected ? 'Start eval' : 'Start the voice session first'}
          </button>
        ) : (
          <>
            <button type="button" onClick={() => void evalRun.end()} className="rounded-lg border border-emerald-300/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-100">End & score</button>
            <button type="button" onClick={() => void evalRun.abort()} className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/70">Abort</button>
          </>
        )}
      </div>

      {evalRun.error && <p className="text-xs text-rose-300">{evalRun.error}</p>}

      {phase === 'done' && evalRun.result && (
        <div className={cn('rounded-xl border px-3 py-2 text-sm font-semibold uppercase tracking-[0.2em]', VERDICT_STYLE[evalRun.result.status])}>
          {evalRun.result.status.replace('_', ' ')}
        </div>
      )}

      {phase === 'done' && evalRun.result
        ? <Scorecard score={evalRun.result.score} judge={evalRun.result.judge} />
        : evalRun.liveScore && <Scorecard score={evalRun.liveScore} />}
    </Card>
  );
}
