import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { IRS_AGENT_INSTRUCTIONS, IRS_TOOL_PARAMETERS, applyIrsDecision, redactIrsCredentials, verifyIrsDemoIdentity, type IrsContext } from '../shared/irs-resolution.ts';
import { normalizeMCPArguments } from '../src/lib/mcp-normalizer.ts';

const approved = () => ({ model: 'jev-latest', answers: { intent: { choice: 'notice', confidence: 0.95 }, next_step: { choice: 'explain_notice', confidence: 0.95 }, needs_human_review: { noul: 0.01 } } });
const context = (): IrsContext => ({ verified: true, action: 'review_notice', utterance: 'Explain the notice', notices: [], cases: [], documents: [], now: '2026-10-22T15:00:00Z' });
test('demo identity requires caller factors even for a stored VERIFIED record', () => {
  const taxpayer = { taxpayer_reference: 'IRS-DEMO-5501', identity_status: 'VERIFIED', demo_access_code: 'TEST-CODE', mailing_zip: '00000' };
  assert.equal(verifyIrsDemoIdentity(taxpayer, '', ''), false);
  assert.equal(verifyIrsDemoIdentity(taxpayer, 'wrong', '00000'), false);
  assert.equal(verifyIrsDemoIdentity(taxpayer, 'TEST-CODE', '00000'), true);
  assert.equal(verifyIrsDemoIdentity({ ...taxpayer, taxpayer_reference: 'REAL-5501' }, 'TEST-CODE', '00000'), false);
  const redacted = redactIrsCredentials({ demo_access_code: 'TEST-CODE', mailing_zip: '00000', utterance: 'My code is TEST-CODE and zip 00000' });
  assert.ok(!JSON.stringify(redacted).includes('TEST-CODE'));
  assert.ok(!JSON.stringify(redacted).includes('00000'));
});

test('normalizer preserves identity factors for execution but redacts its debug logs', (t) => {
  const logs: any[] = [];
  t.mock.method(console, 'log', (...args: any[]) => { logs.push(args); });
  const args = normalizeMCPArguments('irs_notice_resolution', IRS_TOOL_PARAMETERS as any, {
    utterance: 'Check my notice', taxpayer_reference: 'IRS-DEMO-5501', action: 'review_notice', demo_access_code: 'TEST-CODE', mailing_zip: '00000'
  }, { redactLogs: true });
  assert.equal(args.demo_access_code, 'TEST-CODE');
  assert.equal(args.mailing_zip, '00000');
  assert.ok(!JSON.stringify(logs).includes('TEST-CODE'));
  assert.ok(!JSON.stringify(logs).includes('00000'));
  const email = normalizeMCPArguments('send_email', { type: 'object', properties: { cc: { type: 'string' } } }, { cc: 'TEAM@EXAMPLE.COM' }, { redactLogs: true });
  assert.equal(email.cc, 'team@example.com');
});

test('Jev decisions are gated by verified identity, overdue deadlines, risk, and conflicting records', () => {
  assert.equal(applyIrsDecision({ ...context(), verified: false }, approved()).disclose, false);
  assert.equal(applyIrsDecision(context(), approved()).next_step, 'explain_notice');
  for (const updated of [
    { notices: [{ status: 'OPEN', response_required: true, response_due_date: '2026-09-30' }] },
    { cases: [{ status: 'IN_REVIEW', risk_level: 'HIGH' }] },
    { cases: [{ status: 'IN_REVIEW', recommended_action: 'Inquiry closed; paid in full' }] },
    { documents: [{ required: true, status: 'NEEDED', due_date: '2026-09-30' }] }
  ]) assert.equal(applyIrsDecision({ ...context(), ...updated }, approved()).next_step, 'route_to_specialist');
  assert.equal(applyIrsDecision({ ...context(), notices: [{ status: 'CLOSED', response_required: true, response_due_date: '2026-09-30' }] }, approved()).next_step, 'explain_notice');
  for (const choice of ['hardship', 'tax_advice', 'human_help']) {
    const result = approved(); result.answers.intent.choice = choice;
    assert.equal(applyIrsDecision(context(), result).next_step, 'route_to_specialist');
  }
  assert.equal(applyIrsDecision(context(), { answers: {} }).next_step, 'route_to_specialist');
  const arbitrary = approved(); arbitrary.answers.next_step.choice = 'approve_payment_plan';
  assert.equal(applyIrsDecision(context(), arbitrary).next_step, 'route_to_specialist');
  assert.match(IRS_AGENT_INSTRUCTIONS, /Expressive speech guidelines/);
  assert.match(IRS_AGENT_INSTRUCTIONS, /EVERY substantive request/);
});

test('IRS endpoint limits data to the owned agent and verified taxpayer; Jev failures disclose nothing', async (t) => {
  const runtime = globalThis as any;
  const original = { Deno: runtime.Deno, fetch: runtime.fetch, fixture: runtime.irsFixture };
  let handler: any;
  let mode = 'ok';
  let reads: string[] = [], inserts: any[] = [], jevRequest: any;
  const db: Record<string, any[]> = {
    va_users: [{ id: 'owner', auth_user_id: 'auth-user' }],
    va_agent_configs: [{ id: 'config', user_id: 'owner', voice_provider_config: { workflow: 'irs-resolution', allowed_taxpayer_references: ['IRS-DEMO-5501'] } }],
    va_agent_config_tools: [{ config_id: 'config', tool_name: 'irs_notice_resolution' }],
    irs_taxpayers: [{ id: 'taxpayer', taxpayer_reference: 'IRS-DEMO-5501', first_name: 'Demo', identity_status: 'VERIFIED', demo_access_code: 'TEST-CODE', mailing_zip: '00000' }],
    irs_notices: [{ id: 'notice', taxpayer_id: 'taxpayer', notice_number: 'CP14-ONE', notice_type: 'CP14', status: 'OPEN', issue_date: '2026-10-01', response_due_date: '2026-12-01' }, { id: 'foreign-notice', taxpayer_id: 'other', notice_number: 'PRIVATE-OTHER' }],
    irs_resolution_cases: [{ id: 'case', notice_id: 'notice', taxpayer_id: 'taxpayer', status: 'OPEN', risk_level: 'LOW' }],
    irs_case_documents: [{ case_id: 'case', document_name: 'Demo form', status: 'RECEIVED' }, { case_id: 'foreign-case', document_name: 'PRIVATE-OTHER' }],
    irs_payment_plans: [{ taxpayer_id: 'taxpayer', notice_id: 'notice', status: 'PROPOSED', monthly_amount: 100 }],
    irs_tasks: [], irs_interactions: [], irs_kb_articles: []
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'auth-user' } }, error: null }) },
    from(table: string) {
      reads.push(table);
      const filters: Array<(row: any) => boolean> = [];
      let single = false, insert: any;
      const query: any = {
        select: () => query, order: () => query, limit: () => query,
        eq: (key: string, value: any) => { filters.push((row) => row[key] === value); return query; },
        in: (key: string, values: any[]) => { filters.push((row) => values.includes(row[key])); return query; },
        maybeSingle: () => { single = true; return query; },
        insert: (value: any) => { insert = value; return query; },
        then(resolve: any, reject: any) {
          if (insert) { inserts.push({ table, ...insert }); return Promise.resolve({ data: null, error: null }).then(resolve, reject); }
          const matches = (db[table] || []).filter((row) => filters.every((filter) => filter(row)));
          return Promise.resolve({ data: single ? matches[0] || null : matches, error: null }).then(resolve, reject);
        }
      };
      return query;
    }
  };
  runtime.irsFixture = client;
  runtime.Deno = { env: { get: () => 'test' }, serve: (fn: any) => { handler = fn; } };
  runtime.fetch = async (_url: string, init: RequestInit) => {
    jevRequest = JSON.parse(init.body as string);
    return mode === 'fail' ? Response.json({}, { status: 503 }) : Response.json(approved());
  };
  const invoke = async (patch: any = {}) => {
    reads = []; inserts = []; jevRequest = null;
    const response = await handler(new Request('https://function.test', { method: 'POST', headers: { Authorization: 'Bearer auth' }, body: JSON.stringify({
      config_id: 'config', taxpayer_reference: 'IRS-DEMO-5501', action: 'review_notice', utterance: 'Explain my notice', demo_access_code: 'TEST-CODE', mailing_zip: '00000', ...patch
    }) }));
    return { status: response.status, body: await response.json() };
  };
  try {
    const bundle = await build({ entryPoints: ['supabase/functions/irs-notice-resolution/index.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'admin', setup(builder) {
      builder.onResolve({ filter: /^npm:/ }, () => ({ path: 'admin', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const createClient = () => globalThis.irsFixture;' }));
    } }] });
    await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    await t.test('unverified caller sees no account data, and Jev receives no factors', async () => {
      const result = await invoke({ demo_access_code: 'wrong' });
      assert.equal(result.body.verified, false);
      assert.equal(result.body.notices, undefined);
      assert.ok(!reads.includes('irs_notices'));
      assert.equal(jevRequest.state.identity_verified, false);
      assert.ok(!JSON.stringify(jevRequest).includes('00000'));
      assert.equal(inserts.length, 0);
    });
    await t.test('verified account returns only its records and keeps plans proposed', async () => {
      const result = await invoke();
      assert.equal(result.status, 200);
      assert.equal(result.body.notices.length, 1);
      assert.equal(result.body.documents.length, 1);
      assert.equal(result.body.payment_plans[0].status, 'PROPOSED');
      assert.equal(result.body.handoff.submitted, false);
      assert.equal(result.body.action.financial_changes, false);
      assert.ok(!JSON.stringify(result.body).includes('TEST-CODE'));
      assert.ok(!JSON.stringify(result.body).includes('PRIVATE-OTHER'));
      assert.equal(inserts.length, 1); assert.equal(inserts[0].table, 'irs_interactions');
    });
    await t.test('unowned config and unconfigured taxpayer are rejected before lookup', async () => {
      assert.equal((await invoke({ config_id: 'foreign-config' })).status, 403);
      assert.ok(!reads.includes('irs_taxpayers'));
      assert.equal((await invoke({ taxpayer_reference: 'IRS-DEMO-5502' })).status, 400);
      assert.ok(!reads.includes('irs_taxpayers'));
    });
    await t.test('a notice from another account cannot be selected', async () => {
      const result = await invoke({ notice_number: 'PRIVATE-OTHER' });
      assert.equal(result.body.notices.length, 0);
      assert.equal(result.body.decision.next_step.applied, 'clarify');
      assert.ok(!reads.includes('irs_resolution_cases'));
    });
    await t.test('Jev outage cannot fall back to an invented decision or disclose records', async () => {
      mode = 'fail';
      const result = await invoke();
      assert.equal(result.status, 502); assert.equal(result.body.notices, undefined);
      assert.equal(inserts.length, 0);
    });
  } finally {
    runtime.Deno = original.Deno; runtime.fetch = original.fetch; runtime.irsFixture = original.fixture;
  }
});
