import { supabase } from '../supabase';
import { toEvidenceRows } from '../../../shared/voice-eval/evidence';
import type { EvidenceEvent, JudgeResult, RunScore } from '../../../shared/voice-eval/types';

export interface SetupEvalRunInput {
  scenarioId: string;
  callerType: 'human' | 'synthetic';
  agentConfigId: string | null;
  configFingerprint: string;
  configSnapshot: Record<string, unknown>;
}

export interface SetupEvalRunResponse {
  run_id: string;
  eval_run_id: string;
  patient_reference: string;
  started_at: string;
}

export interface ScoreEvalRunResponse {
  run_id: string;
  status: 'pass' | 'fail' | 'invalid_harness';
  score: RunScore;
  judge: JudgeResult;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('voice-eval', { body });
  if (error) throw new Error(error.message || 'Evaluator request failed');
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export function setupEvalRun(input: SetupEvalRunInput) {
  return invoke<SetupEvalRunResponse>({
    action: 'setup',
    scenario_id: input.scenarioId,
    caller_type: input.callerType,
    agent_config_id: input.agentConfigId,
    config_fingerprint: input.configFingerprint,
    config_snapshot: input.configSnapshot
  });
}

export function scoreEvalRun(runId: string, sessionId: string | null) {
  return invoke<ScoreEvalRunResponse>({ action: 'score', run_id: runId, session_id: sessionId });
}

export function abortEvalRun(runId: string) {
  return invoke<{ run_id: string; status: string; removed: number }>({ action: 'teardown', run_id: runId });
}

export async function flushEvidence(runId: string, fromSeq: number, events: EvidenceEvent[]): Promise<void> {
  if (!events.length) return;
  const { error } = await supabase
    .from('voice_eval_evidence')
    .upsert(toEvidenceRows(runId, fromSeq, events), { onConflict: 'run_id,seq', ignoreDuplicates: true });
  if (error) throw error;
}
