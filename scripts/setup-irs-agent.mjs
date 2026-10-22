// Admin setup for the IRS demo. Provider credentials stay in memory and are never printed.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createClient } from '@supabase/supabase-js';

const option = (flag) => process.argv[process.argv.indexOf(flag) + 1];
const project = process.argv.includes('--project-ref') ? option('--project-ref') : null;
const owner = process.argv.includes('--owner-id') ? option('--owner-id') : null;
const voice = process.argv.includes('--voice-id') ? option('--voice-id') : 'XrExE9yKIg1WjnnlVkGX';
if (!project || !owner) throw new Error('Pass --project-ref and --owner-id');
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', project, '--reveal', '--output', 'json'], { encoding: 'utf8' }));
const serviceKey = keys.find((key) => key.name === 'service_role')?.api_key;
if (!serviceKey) throw new Error('Unable to resolve the project service role key');
const url = `https://${project}.supabase.co`;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const check = (result) => { if (result.error) throw new Error(result.error.message); return result.data; };
const bundleImport = async (options) => {
  const result = await build({ ...options, bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
};
const definition = await bundleImport({ entryPoints: ['shared/irs-resolution.ts'] });
const providerKeys = check(await admin.from('va_provider_keys').select('id,encrypted_key').eq('user_id', owner).eq('provider', 'elevenlabs').order('created_at', { ascending: false }).limit(1));
if (!providerKeys.length) throw new Error('This owner needs an ElevenLabs provider key');
const voiceResponse = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voice)}`, { headers: { 'xi-api-key': Buffer.from(providerKeys[0].encrypted_key, 'base64').toString().trim() } });
if (!voiceResponse.ok) throw new Error('The selected ElevenLabs voice is not available');
const voiceInfo = await voiceResponse.json();
const taxpayers = check(await admin.from('irs_taxpayers').select('taxpayer_reference').like('taxpayer_reference', 'IRS-DEMO-%'));
if (!taxpayers.length) throw new Error('No IRS demo taxpayer records found');
const existing = check(await admin.from('va_agent_configs').select('id,voice_provider_config').eq('user_id', owner).eq('name', definition.IRS_AGENT_NAME).maybeSingle());
const preset = {
  user_id: owner, name: definition.IRS_AGENT_NAME,
  summary: 'Identity-gated notice and refund support using irs_* records, Jev decisions, and expressive ElevenLabs Realtime Max voice.',
  tags: ['irs', 'demo', 'jev', 'elevenlabs', 'realtime-max', 'notices', 'refunds'],
  instructions: definition.IRS_AGENT_INSTRUCTIONS,
  voice: 'alloy', voice_id: voice, voice_provider: 'elevenlabs_agent', voice_provider_key_id: providerKeys[0].id,
  model: 'gpt-realtime-2.1', chat_model: 'gpt-5.4-mini', temperature: 0.3, max_response_output_tokens: 4096,
  turn_detection_enabled: true, turn_detection_config: { type: 'server_vad', threshold: 0.65, prefix_padding_ms: 200, silence_duration_ms: 650 },
  is_default: false, rag_enabled: false, rag_mode: 'guardrail',
  voice_persona_prompt: 'Warm, calm, naturally expressive notice-resolution specialist. Speak amounts, dates, and notice codes clearly; acknowledge financial stress without theatrical emotion.',
  voice_provider_config: {
    ...(existing?.voice_provider_config || {}),
    configuration_authority: 'app_managed', workflow: 'irs-resolution', jev_every_turn: true,
    allowed_taxpayer_references: taxpayers.map((row) => row.taxpayer_reference),
    realtime_model: 'eleven_realtime_v1_max', language: 'en',
    first_message: 'Welcome to the IRS notice and refund support demo. I can help you understand a notice or check a case. What would you like help with?',
    llm: 'gpt-5.4-mini', model_id: 'eleven_v3', expressive_mode: true,
    output_format: 'pcm_24000', turn_eagerness: 'normal', speculative_turn: false, sync_local_instructions: false
  }, updated_at: new Date().toISOString()
};
const config = existing
  ? check(await admin.from('va_agent_configs').update(preset).eq('id', existing.id).eq('user_id', owner).select('id').single())
  : check(await admin.from('va_agent_configs').insert(preset).select('id').single());
const tool = {
  config_id: config.id, user_id: owner, tool_name: definition.IRS_TOOL_NAME, tool_source: 'client',
  metadata: { workflow: 'irs-resolution', source: 'Supabase irs_* + TypeSafe Jev', description: definition.IRS_TOOL_DESCRIPTION, parameters: definition.IRS_TOOL_PARAMETERS }
};
const selected = check(await admin.from('va_agent_config_tools').select('id').eq('config_id', config.id).eq('tool_name', definition.IRS_TOOL_NAME).maybeSingle());
if (selected) check(await admin.from('va_agent_config_tools').update(tool).eq('id', selected.id));
else check(await admin.from('va_agent_config_tools').insert(tool));

// Execute the production publisher locally with admin credentials. Its owner check
// still runs, and it creates a new remote agent rather than reusing another preset's agent.
globalThis.Deno = { env: { get: (key) => ({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey })[key] }, serve: () => {} };
const source = await readFile('supabase/functions/elevenlabs-agent-session/index.ts', 'utf8');
globalThis.irsSetupAdmin = admin;
const publisher = await bundleImport({
  stdin: { contents: `${source}\nexport { syncAppManagedAgent };`, resolveDir: `${process.cwd()}/supabase/functions/elevenlabs-agent-session`, loader: 'ts' },
  plugins: [{ name: 'supabase-node', setup(builder) {
    builder.onResolve({ filter: /^npm:@supabase\/supabase-js/ }, () => ({ path: 'supabase-node', namespace: 'admin' }));
    builder.onLoad({ filter: /.*/, namespace: 'admin' }, () => ({ contents: 'export const createClient = () => globalThis.irsSetupAdmin;' }));
  } }]
});
try {
  const result = await publisher.syncAppManagedAgent(config.id, owner);
  console.log(JSON.stringify({ name: definition.IRS_AGENT_NAME, config_id: config.id, agent_id: result.agent_id, voice_name: voiceInfo.name, voice_id: voice, realtime_model: result.voice_provider_config.app_managed.effective_realtime_model, tool_count: result.tool_count, status: 'published' }, null, 2));
} catch (error) {
  // Data URL stack traces contain bundled source. Print the message only.
  console.error(`Preset saved (${config.id}); publishing failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  delete globalThis.irsSetupAdmin;
  delete globalThis.Deno;
}
