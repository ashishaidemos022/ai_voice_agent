import { useCallback, useEffect, useRef, useState } from 'react';
import { EvidenceRecorder } from '../../shared/voice-eval/evidence';
import { configFingerprint, type FingerprintInput } from '../../shared/voice-eval/fingerprint';
import { getScenario, SCENARIOS } from '../../shared/voice-eval/scenarios/index';
import { scoreRun } from '../../shared/voice-eval/scoring/index';
import type { RunScore, Scenario } from '../../shared/voice-eval/types';
import { abortEvalRun, flushEvidence, scoreEvalRun, setupEvalRun, type ScoreEvalRunResponse } from '../lib/voice-eval/api';
import { setActiveEvalContext } from '../lib/voice-eval/eval-context';
import { subscribeVoiceEvalSignals } from '../lib/voice-eval/signal-bus';

export type EvalPhase = 'idle' | 'arming' | 'live' | 'scoring' | 'done' | 'error';

export interface UseVoiceEvalOptions {
  sessionId: string | null;
  agentConfigId: string | null;
  fingerprintInput: FingerprintInput;
}

interface ActiveRun {
  runId: string;
  scenario: Scenario;
  recorder: EvidenceRecorder;
  unsubscribe: () => void;
  flushTimer: number;
}

const LIVE_SCORE_THROTTLE_MS = 250;
const FLUSH_INTERVAL_MS = 2000;

export function useVoiceEval(options: UseVoiceEvalOptions) {
  const [phase, setPhase] = useState<EvalPhase>('idle');
  const [scenarioId, setScenarioId] = useState<string>(SCENARIOS[0].id);
  const [liveScore, setLiveScore] = useState<RunScore | null>(null);
  const [result, setResult] = useState<ScoreEvalRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runRef = useRef<ActiveRun | null>(null);
  const scoreTimerRef = useRef<number | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const flush = useCallback(async () => {
    const run = runRef.current;
    if (!run) return;
    const batch = run.recorder.takeUnflushed();
    if (!batch.events.length) return;
    try {
      await flushEvidence(run.runId, batch.fromSeq, batch.events);
    } catch (flushError) {
      run.recorder.markUnflushed(batch.fromSeq);
      console.warn('[useVoiceEval] evidence flush failed; will retry', flushError);
    }
  }, []);

  const stopRecording = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    run.unsubscribe();
    window.clearInterval(run.flushTimer);
    if (scoreTimerRef.current !== null) window.clearTimeout(scoreTimerRef.current);
    scoreTimerRef.current = null;
    setActiveEvalContext(null);
  }, []);

  const arm = useCallback(async () => {
    const scenario = getScenario(scenarioId);
    if (!scenario || runRef.current) return;
    setPhase('arming');
    setError(null);
    setResult(null);
    try {
      const { fingerprintInput, agentConfigId } = optionsRef.current;
      const setup = await setupEvalRun({
        scenarioId: scenario.id,
        callerType: 'human',
        agentConfigId,
        configFingerprint: await configFingerprint(fingerprintInput),
        configSnapshot: { ...fingerprintInput }
      });
      const recorder = new EvidenceRecorder(performance.now());
      setActiveEvalContext({ evalRunId: setup.eval_run_id, patientReference: setup.patient_reference });
      const unsubscribe = subscribeVoiceEvalSignals((signal) => {
        recorder.record(signal);
        if (scoreTimerRef.current !== null) return;
        scoreTimerRef.current = window.setTimeout(() => {
          scoreTimerRef.current = null;
          setLiveScore(scoreRun(scenario, recorder.events(), { mode: 'live', snapshot: null }));
        }, LIVE_SCORE_THROTTLE_MS);
      });
      const flushTimer = window.setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);
      runRef.current = { runId: setup.run_id, scenario, recorder, unsubscribe, flushTimer };
      setLiveScore(scoreRun(scenario, [], { mode: 'live', snapshot: null }));
      setPhase('live');
    } catch (armError) {
      setError(armError instanceof Error ? armError.message : 'Could not start the eval');
      setPhase('error');
    }
  }, [flush, scenarioId]);

  const end = useCallback(async () => {
    const run = runRef.current;
    if (!run) return;
    stopRecording();
    setPhase('scoring');
    for (let attempt = 0; attempt < 3 && run.recorder.hasUnflushed(); attempt += 1) await flush();
    try {
      setResult(await scoreEvalRun(run.runId, optionsRef.current.sessionId));
      setPhase('done');
    } catch (scoreError) {
      setError(scoreError instanceof Error ? scoreError.message : 'Scoring failed');
      setPhase('error');
    } finally {
      runRef.current = null;
    }
  }, [flush, stopRecording]);

  const abort = useCallback(async () => {
    const run = runRef.current;
    if (!run) return;
    stopRecording();
    runRef.current = null;
    setPhase('idle');
    setLiveScore(null);
    try {
      await abortEvalRun(run.runId);
    } catch (abortError) {
      console.warn('[useVoiceEval] abort failed; the stale sweep will clean up', abortError);
    }
  }, [stopRecording]);

  const reset = useCallback(() => {
    if (runRef.current) return;
    setPhase('idle');
    setResult(null);
    setLiveScore(null);
    setError(null);
  }, []);

  useEffect(() => () => {
    const run = runRef.current;
    if (!run) return;
    stopRecording();
    runRef.current = null;
    void abortEvalRun(run.runId).catch(() => undefined);
  }, [stopRecording]);

  return {
    phase,
    scenarioId,
    setScenarioId,
    scenario: getScenario(scenarioId) ?? null,
    liveScore,
    result,
    error,
    arm,
    end,
    abort,
    reset
  };
}
