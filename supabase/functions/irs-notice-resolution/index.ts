import { createClient } from 'npm:@supabase/supabase-js@2.112.2';
import { IRS_ACTIONS, IRS_TOOL_NAME, applyIrsDecision, irsJevQuestions, irsRecordFlags, normalizeIrsReference, redactIrsCredentials, verifyIrsDemoIdentity, type IrsAction, type IrsJevResult } from '../../../shared/irs-resolution.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey' };
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const rows = async (query: PromiseLike<{ data: any; error: any }>) => {
  const { data, error } = await query;
  if (error) throw new Error('Unable to read IRS workflow records');
  return data || [];
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return reply({});
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const started = Date.now();
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return reply({ error: 'Authentication required' }, 401);
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return reply({ error: 'Invalid session' }, 401);
    const { data: user } = await admin.from('va_users').select('id').eq('auth_user_id', auth.user.id).maybeSingle();
    if (!user) return reply({ error: 'Forbidden' }, 403);
    const body = await req.json();
    const { data: config } = await admin.from('va_agent_configs').select('id,user_id,voice_provider_config').eq('id', body.config_id).eq('user_id', user.id).maybeSingle();
    if (!config || config.voice_provider_config?.workflow !== 'irs-resolution') return reply({ error: 'IRS agent not found' }, 403);
    const { data: selection } = await admin.from('va_agent_config_tools').select('tool_name').eq('config_id', config.id).eq('tool_name', IRS_TOOL_NAME).maybeSingle();
    if (!selection) return reply({ error: 'IRS workflow is not enabled for this preset' }, 403);
    const reference = normalizeIrsReference(body.taxpayer_reference);
    const utterance = typeof body.utterance === 'string' ? body.utterance.trim() : '';
    if (!utterance || utterance.length > 4000 || !IRS_ACTIONS.includes(body.action)) return reply({ error: 'A valid IRS action and request are required' }, 400);
    if (!/^IRS-DEMO-\d{4}$/.test(reference) || !(config.voice_provider_config.allowed_taxpayer_references || []).includes(reference)) return reply({ error: 'Identity could not be verified' }, 400);
    const { data: taxpayer, error: lookupError } = await admin.from('irs_taxpayers').select('id,taxpayer_reference,first_name,identity_status,demo_access_code,mailing_zip').eq('taxpayer_reference', reference).maybeSingle();
    if (lookupError) throw new Error('Unable to verify the taxpayer record');
    const verified = verifyIrsDemoIdentity(taxpayer, body.access_code ?? body.demo_access_code, body.mailing_zip);
    const serverNow = new Date().toISOString();
    let notices: any[] = [], cases: any[] = [], documents: any[] = [], plans: any[] = [], tasks: any[] = [], interactions: any[] = [], articles: any[] = [];
    const readStarted = Date.now();
    if (verified) {
      let noticeQuery = admin.from('irs_notices').select('id,notice_number,notice_type,tax_year,issue_date,response_due_date,balance_due,penalty_amount,interest_amount,refund_amount,status,summary,response_required,updated_at').eq('taxpayer_id', taxpayer.id);
      if (typeof body.notice_number === 'string' && body.notice_number.trim()) noticeQuery = noticeQuery.eq('notice_number', body.notice_number.trim());
      notices = await rows(noticeQuery.order('issue_date', { ascending: false }).limit(30));
      const noticeIds = notices.map((row) => row.id);
      if (noticeIds.length) {
        cases = await rows(admin.from('irs_resolution_cases').select('id,notice_id,case_number,case_type,status,assigned_team,risk_level,recommended_action,next_action,next_action_due_at,updated_at').eq('taxpayer_id', taxpayer.id).in('notice_id', noticeIds).order('updated_at', { ascending: false }).limit(30));
        const caseIds = cases.map((row) => row.id);
        [documents, plans, tasks, interactions, articles] = await Promise.all([
          caseIds.length ? rows(admin.from('irs_case_documents').select('case_id,document_code,document_name,status,required,received_at,due_date').in('case_id', caseIds).limit(100)) : [],
          rows(admin.from('irs_payment_plans').select('case_id,notice_id,confirmation_number,balance_at_creation,monthly_amount,term_months,first_payment_date,status,created_via').eq('taxpayer_id', taxpayer.id).in('notice_id', noticeIds).limit(30)),
          caseIds.length ? rows(admin.from('irs_tasks').select('case_id,type,skill_required,status,resolution_note,updated_at').in('case_id', caseIds).limit(50)) : [],
          caseIds.length ? rows(admin.from('irs_interactions').select('case_id,event_type,channel,outcome,created_at').eq('taxpayer_id', taxpayer.id).in('case_id', caseIds).order('created_at', { ascending: false }).limit(5)) : [],
          rows(admin.from('irs_kb_articles').select('title,body,tags').limit(20))
        ]);
      }
    }
    const readMs = Date.now() - readStarted;
    const safeUtterance = redactIrsCredentials(body).utterance;
    const context = { verified, action: body.action as IrsAction, utterance: safeUtterance, notices, cases, documents, now: serverNow };
    const apiKey = Deno.env.get('TYPESAFE_API_KEY');
    if (!apiKey) throw new Error('Jev decisioning is not configured');
    const jevStarted = Date.now();
    const response = await fetch(`${Deno.env.get('TYPESAFE_BASE_URL') || 'https://api.typesafe.ai/v1'}/systemone`, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(25000),
      body: JSON.stringify({ model: 'jev-latest', state: {
        latest_caller_request: safeUtterance, server_now: serverNow, identity_verified: verified, requested_action: body.action,
        record_flags: irsRecordFlags(context),
        notices: notices.map(({ notice_type, tax_year, status, response_due_date, response_required }) => ({ notice_type, tax_year, status, response_due_date, response_required })),
        cases: cases.map(({ case_type, status, risk_level }) => ({ case_type, status, risk_level })),
        documents: documents.map(({ document_name, status, required, due_date }) => ({ document_name, status, required, due_date })),
        existing_plan_statuses: plans.map((row) => row.status)
      }, questions: irsJevQuestions(context) })
    });
    if (!response.ok) throw new Error('Jev decisioning is temporarily unavailable; no account action was performed');
    const jev = await response.json() as IrsJevResult;
    if (!jev.answers || typeof jev.answers !== 'object') throw new Error('Jev did not return a valid decision');
    const applied = applyIrsDecision(context, jev);
    if (verified && !notices.length && applied.next_step !== 'route_to_specialist') {
      applied.next_step = 'clarify'; applied.reason = 'no_matching_notice';
    }
    const usage = jev.usage || {};
    const telemetry = { model: jev.model || 'jev-latest', latency_ms: Date.now() - jevStarted, input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null, total_tokens: usage.total_tokens ?? null, cost_usd: usage.cost_usd ?? null, cost_kind: usage.cost_usd != null ? 'billed' : null };
    let interactionRecorded = false;
    if (applied.disclose && cases.length) {
      const { error: logError } = await admin.from('irs_interactions').insert({
        taxpayer_id: taxpayer.id, case_id: cases[0].id, event_type: 'AGENT_REVIEW', channel: 'voice', outcome: applied.next_step,
        details: { agent_config_id: config.id, requested_action: body.action, reason: applied.reason, decision_model: telemetry.model, no_financial_changes: true }
      });
      interactionRecorded = !logError;
    }
    return reply({
      verified, server_now: serverNow,
      decision: { intent: jev.answers.intent, next_step: { ...jev.answers.next_step, applied: applied.next_step }, needs_human_review: jev.answers.needs_human_review, reason: applied.reason, model: telemetry.model, answers: jev.answers },
      ...(!applied.disclose ? { verification_message: 'Ask for the caller-supplied four-digit taxpayer reference, access code, and mailing ZIP. Never reveal expected values.' } : {
        taxpayer: { first_name: taxpayer.first_name }, notices, cases, documents, payment_plans: plans, tasks, recent_interactions: interactions,
        knowledge_articles: articles, record_flags: irsRecordFlags(context), interaction_recorded: interactionRecorded
      }),
      handoff: { submitted: false, guidance: 'For specialist review, use the contact information on the notice. No transfer or review request has been submitted.' },
      action: { status: 'read_only', financial_changes: false },
      jev: telemetry, timing: { database_ms: readMs, jev_ms: telemetry.latency_ms, total_ms: Date.now() - started }
    });
  } catch {
    // Never log access factors or provider response bodies.
    return reply({ error: 'The IRS workflow could not complete. No account action was performed.' }, 502);
  }
});
