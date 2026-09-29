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

interface ArmToken {
  cancelled: boolean;
}

const LIVE_SCORE_THROTTLE_MS = 250;
const FLUSH_INTERVAL_MS = 2000;
const FLUSH_RETRY_BACKOFF_MS = [250, 500, 1000];

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function discardServerRun(runId: string) {
  void abortEvalRun(runId).catch((abortError) => {
    console.warn('[useVoiceEval] teardown failed; the stale sweep will clean up', abortError);
  });
}

export function useVoiceEval(options: UseVoiceEvalOptions) {
  const [phase, setPhase] = useState<EvalPhase>('idle');
  const [scenarioId, setScenarioId] = useState<string>(SCENARIOS[0].id);
  const [liveScore, setLiveScore] = useState<RunScore | null>(null);
  const [result, setResult] = useState<ScoreEvalRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evidenceIncomplete, setEvidenceIncomplete] = useState(false);
  const runRef = useRef<ActiveRun | null>(null);
  const armTokenRef = useRef<ArmToken | null>(null);
  const scoreTimerRef = useRef<number | null>(null);
  // Every flush goes through this chain, so at most one upsert is in flight and
  // awaiting the tail guarantees all previously taken batches have settled.
  const flushChainRef = useRef<Promise<void>>(Promise.resolve());
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // The voice session id goes null when the call hangs up; keep the last one seen
  // during a run so "End & score" can still link the run to its session.
  const lastSessionIdRef = useRef<string | null>(null);
  if (options.sessionId && (runRef.current || armTokenRef.current)) lastSessionIdRef.current = options.sessionId;

  const enqueueFlush = useCallback((run: ActiveRun): Promise<void> => {
    const next = flushChainRef.current.then(async () => {
      const batch = run.recorder.takeUnflushed();
      if (!batch.events.length) return;
      try {
        await flushEvidence(run.runId, batch.fromSeq, batch.events);
      } catch (flushError) {
        run.recorder.markUnflushed(batch.fromSeq);
        console.warn('[useVoiceEval] evidence flush failed; will retry', flushError);
      }
    });
    flushChainRef.current = next;
    return next;
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
    if (!scenario || runRef.current || armTokenRef.current) return;
    const token: ArmToken = { cancelled: false };
    armTokenRef.current = token;
    setPhase('arming');
    setError(null);
    setResult(null);
    setEvidenceIncomplete(false);
    lastSessionIdRef.current = optionsRef.current.sessionId;
    let setupRunId: string | null = null;
    try {
      const { fingerprintInput, agentConfigId } = optionsRef.current;
      const fingerprint = await configFingerprint(fingerprintInput);
      if (token.cancelled) return;
      const setup = await setupEvalRun({
        scenarioId: scenario.id,
        callerType: 'human',
        agentConfigId,
        configFingerprint: fingerprint,
        configSnapshot: { ...fingerprintInput }
      });
      setupRunId = setup.run_id;
      if (token.cancelled) {
        discardServerRun(setup.run_id);
        return;
      }
      const recorder = new EvidenceRecorder(performance.now());
      setActiveEvalContext({ evalRunId: setup.eval_run_id, patientReference: setup.patient_reference });
      const run: ActiveRun = { runId: setup.run_id, scenario, recorder, unsubscribe: () => undefined, flushTimer: 0 };
      runRef.current = run;
      run.unsubscribe = subscribeVoiceEvalSignals((signal) => {
        recorder.record(signal);
        if (scoreTimerRef.current !== null) return;
        scoreTimerRef.current = window.setTimeout(() => {
          scoreTimerRef.current = null;
          setLiveScore(scoreRun(scenario, recorder.events(), { mode: 'live', snapshot: null }));
        }, LIVE_SCORE_THROTTLE_MS);
      });
      run.flushTimer = window.setInterval(() => { void enqueueFlush(run); }, FLUSH_INTERVAL_MS);
      setLiveScore(scoreRun(scenario, [], { mode: 'live', snapshot: null }));
      setPhase('live');
    } catch (armError) {
      if (runRef.current) {
        stopRecording();
        runRef.current = null;
      } else {
        setActiveEvalContext(null);
      }
      if (setupRunId) discardServerRun(setupRunId);
      if (token.cancelled) return;
      setError(armError instanceof Error ? armError.message : 'Could not start the eval');
      setPhase('error');
    } finally {
      if (armTokenRef.current === token) armTokenRef.current = null;
    }
  }, [enqueueFlush, scenarioId, stopRecording]);

  const end = useCallback(async () => {
    const run = runRef.current;
    if (!run) return;
    stopRecording();
    setPhase('scoring');
    // Awaiting the chain tail waits for any in-flight interval flush, then flushes the rest.
    await enqueueFlush(run);
    for (let attempt = 0; attempt < FLUSH_RETRY_BACKOFF_MS.length && run.recorder.hasUnflushed(); attempt += 1) {
      await delay(FLUSH_RETRY_BACKOFF_MS[attempt]);
      await enqueueFlush(run);
    }
    const incomplete = run.recorder.hasUnflushed();
    if (incomplete) console.warn('[useVoiceEval] scoring with incomplete evidence; some events could not be saved');
    setEvidenceIncomplete(incomplete);
    try {
      setResult(await scoreEvalRun(run.runId, optionsRef.current.sessionId ?? lastSessionIdRef.current));
      setPhase('done');
    } catch (scoreError) {
      setError(scoreError instanceof Error ? scoreError.message : 'Scoring failed');
      setPhase('error');
    } finally {
      runRef.current = null;
    }
  }, [enqueueFlush, stopRecording]);

  const abort = useCallback(async () => {
    const armToken = armTokenRef.current;
    if (armToken) {
      armToken.cancelled = true;
      armTokenRef.current = null;
      setPhase('idle');
      setLiveScore(null);
      return;
    }
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
    if (runRef.current || armTokenRef.current) return;
    setPhase('idle');
    setResult(null);
    setLiveScore(null);
    setError(null);
    setEvidenceIncomplete(false);
    lastSessionIdRef.current = null;
  }, []);

  useEffect(() => () => {
    const armToken = armTokenRef.current;
    if (armToken) {
      armToken.cancelled = true;
      armTokenRef.current = null;
    }
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
    evidenceIncomplete,
    arm,
    end,
    abort,
    reset
  };
}
