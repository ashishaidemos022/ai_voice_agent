import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import Anthropic from 'npm:@anthropic-ai/sdk@0.129.0';
import { fromEvidenceRow, mergeToolLog, type ToolExecutionRow } from '../../../shared/voice-eval/evidence.ts';
import { JUDGE_MODEL, JUDGE_OUTPUT_SCHEMA, buildJudgeRequest, judgeUnavailable, transcriptTurns, validateJudgeOutput } from '../../../shared/voice-eval/judge.ts';
import { getScenario } from '../../../shared/voice-eval/scenarios/index.ts';
import { scoreRun } from '../../../shared/voice-eval/scoring/index.ts';
import { STALE_RUN_MS, setupRun, snapshotRun, sweepStale, teardownRun, type EhrStore } from '../../../shared/voice-eval/server/lifecycle.ts';
import type { EvidenceEvent, JudgeResult, RunScore, Scenario, SetupResult, StateSnapshot } from '../../../shared/voice-eval/types.ts';
import { createEhrRestStore } from './ehr-rest-store.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const EHR_SUPABASE_URL = Deno.env.get('EHR_SUPABASE_URL');
const EHR_SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('EHR_SUPABASE_SERVICE_ROLE_KEY');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase service role credentials are missing');
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type JsonRecord = Record<string, any>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function uuidOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

function ehrStore(): EhrStore {
  if (!EHR_SUPABASE_URL || !EHR_SUPABASE_SERVICE_ROLE_KEY) throw new Error('EHR connection is not configured');
  return createEhrRestStore(EHR_SUPABASE_URL, EHR_SUPABASE_SERVICE_ROLE_KEY);
}

async function loadOwnedRun(ownerId: string, runId: unknown) {
  const id = uuidOrNull(runId);
  if (!id) return null;
  const { data } = await adminClient.from('voice_eval_runs').select('*').eq('id', id).eq('owner_id', ownerId).maybeSingle();
  return data;
}

async function sweepAll(store: EhrStore) {
  const swept = await sweepStale(store, new Date());
  await adminClient
    .from('voice_eval_runs')
    .update({ status: 'aborted', ended_at: new Date().toISOString() })
    .in('status', ['running', 'scoring'])
    .lt('started_at', new Date(Date.now() - STALE_RUN_MS).toISOString());
  if (swept.length) console.log('[voice-eval] swept stale eval runs', swept);
}

async function handleSetup(ownerId: string, body: JsonRecord) {
  const scenario = getScenario(String(body.scenario_id || ''));
  if (!scenario) return jsonResponse({ error: 'Unknown scenario' }, 400);
  const fingerprint = typeof body.config_fingerprint === 'string' && /^[0-9a-f]{64}$/.test(body.config_fingerprint) ? body.config_fingerprint : null;
  if (!fingerprint) return jsonResponse({ error: 'config_fingerprint must be a sha256 hex string' }, 400);

  const store = ehrStore();
  await sweepAll(store).catch((error) => console.warn('[voice-eval] sweep failed', error));
  const evalRunId = crypto.randomUUID();
  const setup = await setupRun(store, scenario, evalRunId, new Date());
  const { data: run, error } = await adminClient
    .from('voice_eval_runs')
    .insert({
      owner_id: ownerId,
      scenario_id: scenario.id,
      scenario_version: scenario.version,
      caller_type: body.caller_type === 'synthetic' ? 'synthetic' : 'human',
      agent_config_id: uuidOrNull(body.agent_config_id),
      config_fingerprint: fingerprint,
      config_snapshot: asRecord(body.config_snapshot),
      eval_run_id: evalRunId,
      eval_patient: scenario.evalPatient,
      setup,
      status: 'running'
    })
    .select('id, started_at')
    .single();
  if (error || !run) {
    await teardownRun(store, evalRunId, setup.patientId).catch(() => undefined);
    throw new Error(error?.message || 'Could not create the eval run');
  }
  return jsonResponse({ run_id: run.id, eval_run_id: evalRunId, patient_reference: scenario.evalPatient, started_at: run.started_at });
}

async function runJudge(scenario: Scenario, events: EvidenceEvent[], score: RunScore): Promise<JudgeResult> {
  if (!ANTHROPIC_API_KEY) return judgeUnavailable('ANTHROPIC_API_KEY is not configured');
  const turns = transcriptTurns(events);
  if (!turns.length) return { ...judgeUnavailable('No transcript to judge'), status: 'skipped' };
  const request = buildJudgeRequest(scenario, turns, events, score);
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 0 });
    const response = await client.beta.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema: JUDGE_OUTPUT_SCHEMA } },
      system: request.system,
      messages: [{ role: 'user', content: request.user }]
    });
    if (response.stop_reason === 'refusal') return judgeUnavailable('Judge declined to grade this call');
    const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
    return validateJudgeOutput(JSON.parse(text), scenario.expected.policy.judgeRubric, turns, response.model);
  } catch (error) {
    if (error instanceof Anthropic.APIError) return judgeUnavailable(`Judge API error ${error.status}: ${error.message}`);
    if (error instanceof SyntaxError) return judgeUnavailable('Judge returned malformed JSON');
    return judgeUnavailable(error instanceof Error ? error.message : 'Judge failed');
  }
}

async function handleScore(ownerId: string, body: JsonRecord) {
  const run = await loadOwnedRun(ownerId, body.run_id);
  if (!run) return jsonResponse({ error: 'Eval run not found' }, 404);
  if (run.status !== 'running') return jsonResponse({ error: `Eval run is already ${run.status}` }, 409);
  const scenario = getScenario(run.scenario_id);
  if (!scenario) return jsonResponse({ error: 'Scenario no longer exists' }, 409);

  let sessionId = uuidOrNull(body.session_id);
  if (sessionId) {
    const { data: session, error: sessionError } = await adminClient
      .from('va_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('user_id', ownerId)
      .maybeSingle();
    if (sessionError) console.warn('[voice-eval] session ownership check failed', sessionError.message);
    if (!session) sessionId = null;
  }

  const { data: claimed, error: claimError } = await adminClient
    .from('voice_eval_runs')
    .update({ status: 'scoring', session_id: sessionId, ended_at: new Date().toISOString() })
    .eq('id', run.id)
    .eq('status', 'running')
    .select('id');
  if (claimError) throw new Error(`Could not start scoring: ${claimError.message}`);
  if (!claimed || claimed.length === 0) return jsonResponse({ error: 'Eval run is already being scored' }, 409);

  const harnessErrors: EvidenceEvent[] = [];
  const { data: evidenceRows, error: evidenceError } = await adminClient
    .from('voice_eval_evidence')
    .select('seq, at_ms, kind, payload')
    .eq('run_id', run.id)
    .order('seq');
  if (evidenceError) harnessErrors.push({ kind: 'harness_error', atMs: 0, message: `evidence load failed: ${evidenceError.message}` });

  let toolRows: ToolExecutionRow[] = [];
  if (sessionId) {
    const { data, error: toolError } = await adminClient
      .from('va_tool_executions')
      .select('id, tool_name, input_params, output_result, execution_time_ms, status, created_at:executed_at')
      .eq('session_id', sessionId)
      .eq('user_id', ownerId)
      .gte('executed_at', run.started_at)
      .order('executed_at');
    if (toolError) harnessErrors.push({ kind: 'harness_error', atMs: 0, message: `tool log load failed: ${toolError.message}` });
    else toolRows = (data ?? []) as ToolExecutionRow[];
  }
  const events = [...harnessErrors, ...mergeToolLog((evidenceRows ?? []).map(fromEvidenceRow), toolRows, run.started_at)];

  const store = ehrStore();
  const setup = asRecord(run.setup) as SetupResult;
  let snapshot: StateSnapshot | null = null;
  try {
    snapshot = await snapshotRun(store, run.eval_run_id, setup);
  } catch (error) {
    console.error('[voice-eval] state snapshot failed', error);
  }
  const score = scoreRun(scenario, events, { mode: 'final', snapshot, sensitiveStrings: setup.sensitiveStrings ?? [] });
  await teardownRun(store, run.eval_run_id, setup.patientId ?? null).catch((error) => console.error('[voice-eval] teardown failed', error));

  // Persist the deterministic verdict first so a slow or failed judge can never lose it.
  const status = score.verdict === 'pass' || score.verdict === 'invalid_harness' ? score.verdict : 'fail';
  const { data: finalized, error: finalError } = await adminClient.from('voice_eval_runs').update({
    status,
    gates: score.gates,
    scores: { tools: score.tools, entities: score.entities, turnTaking: score.turnTaking, safety: score.safety },
    latency: score.latency,
    scored_at: new Date().toISOString()
  }).eq('id', run.id).eq('status', 'scoring').select('id');
  if (finalError) throw new Error(`Could not save the eval result: ${finalError.message}`);
  if (!finalized || finalized.length === 0) throw new Error('Eval run left the scoring state before its result was saved');

  const judge = await runJudge(scenario, events, score);
  const { error: judgeError } = await adminClient.from('voice_eval_runs').update({ judge }).eq('id', run.id);
  if (judgeError) console.error('[voice-eval] could not save the judge result', judgeError.message);
  return jsonResponse({ run_id: run.id, status, score, judge });
}

async function handleTeardown(ownerId: string, body: JsonRecord) {
  const run = await loadOwnedRun(ownerId, body.run_id);
  if (!run) return jsonResponse({ error: 'Eval run not found' }, 404);
  // An in-flight score owns the EHR teardown (it snapshots state first); never race it.
  if (run.status === 'scoring') return jsonResponse({ run_id: run.id, status: run.status, removed: 0 });
  const removed = await teardownRun(ehrStore(), run.eval_run_id, asRecord(run.setup).patientId ?? null);
  let status = run.status;
  if (run.status === 'running') {
    const { data: aborted, error } = await adminClient
      .from('voice_eval_runs')
      .update({ status: 'aborted', ended_at: run.ended_at ?? new Date().toISOString() })
      .eq('id', run.id)
      .eq('status', 'running')
      .select('status');
    if (error) throw new Error(`Could not abort the eval run: ${error.message}`);
    if (aborted && aborted.length) {
      status = 'aborted';
    } else {
      const current = await loadOwnedRun(ownerId, run.id);
      status = current?.status ?? run.status;
    }
  }
  return jsonResponse({ run_id: run.id, status, removed });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return jsonResponse({ error: 'Authentication required' }, 401);
    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData.user) return jsonResponse({ error: 'Invalid session' }, 401);
    const { data: vaUser } = await adminClient.from('va_users').select('id').eq('auth_user_id', authData.user.id).maybeSingle();
    if (!vaUser) return jsonResponse({ error: 'User profile not found' }, 403);

    const body = asRecord(await req.json().catch(() => ({})));
    if (body.action === 'setup') return await handleSetup(vaUser.id, body);
    if (body.action === 'score') return await handleScore(vaUser.id, body);
    if (body.action === 'teardown') return await handleTeardown(vaUser.id, body);
    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (error) {
    console.error('[voice-eval]', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Voice eval failed' }, 500);
  }
});
