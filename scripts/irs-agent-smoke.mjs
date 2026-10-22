// Exercise the deployed workflow using a temporary authenticated test account.
// Cleanup removes the test account, preset, and its interaction rows; no email is sent.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const project = process.argv[process.argv.indexOf('--project-ref') + 1];
if (!process.argv.includes('--project-ref') || !project) throw new Error('Pass --project-ref');
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', project, '--reveal', '--output', 'json'], { encoding: 'utf8' }));
const service = keys.find((row) => row.name === 'service_role')?.api_key;
const anon = keys.find((row) => row.name === 'anon')?.api_key;
const url = `https://${project}.supabase.co`;
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const checked = (result) => { if (result.error) throw new Error(result.error.message); return result.data; };
let authId, configId;
try {
  const email = `irs-smoke-${randomUUID()}@example.invalid`, password = `Smoke!${randomUUID()}aA9`;
  const created = checked(await admin.auth.admin.createUser({ email, password, email_confirm: true }));
  authId = created.user.id;
  const user = checked(await admin.from('va_users').select('id').eq('auth_user_id', authId).single());
  const config = checked(await admin.from('va_agent_configs').insert({
    user_id: user.id, name: 'Temporary IRS workflow smoke', instructions: 'Temporary automated test', voice: 'alloy', model: 'gpt-realtime-2.1', temperature: 0.3,
    voice_provider_config: { workflow: 'irs-resolution', allowed_taxpayer_references: ['IRS-DEMO-4827'] }
  }).select('id').single());
  configId = config.id;
  checked(await admin.from('va_agent_config_tools').insert({ config_id: configId, user_id: user.id, tool_name: 'irs_notice_resolution', tool_source: 'client' }));
  checked(await client.auth.signInWithPassword({ email, password }));
  const taxpayer = checked(await admin.from('irs_taxpayers').select('demo_access_code,mailing_zip').eq('taxpayer_reference', 'IRS-DEMO-4827').single());
  const invoke = async (body) => {
    const { data, error } = await client.functions.invoke('irs-notice-resolution', { body: {
      config_id: configId, taxpayer_reference: '4827', action: 'refund_status', utterance: 'Why is my refund still under review?',
      ...body
    } });
    if (error) {
      const details = error.context instanceof Response ? await error.context.text() : '';
      throw new Error(`Deployed workflow failed: ${details || error.message}`);
    }
    return data;
  };
  const denied = await invoke({ access_code: 'invalid', mailing_zip: taxpayer.mailing_zip });
  assert.equal(denied.verified, false); assert.equal(denied.notices, undefined);
  const review = await invoke({ access_code: taxpayer.demo_access_code, mailing_zip: taxpayer.mailing_zip });
  assert.equal(review.verified, true); assert.ok(review.notices.length > 0);
  assert.equal(review.decision.next_step.applied, 'route_to_specialist');
  assert.ok(review.jev.model); assert.equal(review.action.financial_changes, false);
  assert.equal(review.handoff.submitted, false);
  console.log(JSON.stringify({ unverified_data_blocked: true, verified_notice_count: review.notices.length, decision: review.decision.next_step.applied, reason: review.decision.reason, jev: review.jev, financial_changes: false, irs_handoff_submitted: false }, null, 2));
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  if (configId) {
    checked(await admin.from('irs_interactions').delete().contains('details', { agent_config_id: configId }));
    checked(await admin.from('va_agent_configs').delete().eq('id', configId));
  }
  if (authId) checked(await admin.auth.admin.deleteUser(authId));
}
