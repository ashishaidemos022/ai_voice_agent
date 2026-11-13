// Admin setup for Leo, Viaan's conversation-only coach. No tools are attached.
// Provider credentials stay in memory and are never printed.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createClient } from '@supabase/supabase-js';

const option = (flag) => process.argv[process.argv.indexOf(flag) + 1];
const project = process.argv.includes('--project-ref') ? option('--project-ref') : null;
const owner = process.argv.includes('--owner-id') ? option('--owner-id') : null;
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
const definition = await bundleImport({ entryPoints: ['shared/viaan-companion.ts'] });
const voice = process.argv.includes('--voice-id') ? option('--voice-id') : definition.VIAAN_DEFAULT_VOICE_ID;

const providerKeys = check(await admin.from('va_provider_keys').select('id,encrypted_key').eq('user_id', owner).eq('provider', 'elevenlabs').order('created_at', { ascending: false }).limit(1));
if (!providerKeys.length) throw new Error('This owner needs an ElevenLabs provider key');
const voiceResponse = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voice)}`, { headers: { 'xi-api-key': Buffer.from(providerKeys[0].encrypted_key, 'base64').toString().trim() } });
if (!voiceResponse.ok) throw new Error('The selected ElevenLabs voice is not available');
const voiceInfo = await voiceResponse.json();

const existing = check(await admin.from('va_agent_configs').select('id,voice_provider_config').eq('user_id', owner).eq('name', definition.VIAAN_AGENT_NAME).maybeSingle());
const preset = {
  user_id: owner, name: definition.VIAAN_AGENT_NAME,
  summary: 'Conversation-only, autism-affirming behavior and speech coach for Viaan (12) with a soothing, expressive male voice. No tools.',
  tags: ['kids', 'autism', 'behavior', 'speech', 'vocabulary', 'companion', 'elevenlabs', 'realtime-max'],
  instructions: definition.VIAAN_AGENT_INSTRUCTIONS,
  voice: 'ash', voice_id: voice, voice_provider: 'elevenlabs_agent', voice_provider_key_id: providerKeys[0].id,
  model: 'gpt-realtime-2.1', chat_model: 'gpt-5.4-mini', temperature: 0.6, max_response_output_tokens: 2048,
  // Longer silence window gives Viaan time to finish a thought before Leo replies.
  turn_detection_enabled: true, turn_detection_config: { type: 'server_vad', threshold: 0.6, prefix_padding_ms: 300, silence_duration_ms: 1200 },
  is_default: false, rag_enabled: false, rag_mode: 'guardrail',
  voice_persona_prompt: definition.VIAAN_VOICE_PERSONA,
  voice_provider_config: {
    ...(existing?.voice_provider_config || {}),
    configuration_authority: 'app_managed', workflow: 'viaan-companion',
    realtime_model: 'eleven_realtime_v1_max', language: 'en',
    first_message: definition.VIAAN_FIRST_MESSAGE,
    llm: 'gpt-5.4-mini', model_id: 'eleven_v3', expressive_mode: true,
    output_format: 'pcm_24000', turn_eagerness: 'patient', speculative_turn: false, sync_local_instructions: false,
    voice_settings: { speed: 0.92 }
  }, updated_at: new Date().toISOString()
};
const config = existing
  ? check(await admin.from('va_agent_configs').update(preset).eq('id', existing.id).eq('user_id', owner).select('id').single())
  : check(await admin.from('va_agent_configs').insert(preset).select('id').single());

// Explicitly clear tools: drop any selections and write the sentinel the app uses for "no tools".
check(await admin.from('va_agent_config_tools').delete().eq('config_id', config.id));
check(await admin.from('va_agent_config_tools').insert({
  config_id: config.id, user_id: owner, tool_name: '__none__', tool_source: 'client', tool_id: null,
  metadata: { selectionCleared: true, workflow: 'viaan-companion' }
}));

// Execute the production publisher locally with admin credentials (same approach as setup-irs-agent.mjs).
globalThis.Deno = { env: { get: (key) => ({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey })[key] }, serve: () => {} };
const source = await readFile('supabase/functions/elevenlabs-agent-session/index.ts', 'utf8');
globalThis.viaanSetupAdmin = admin;
const publisher = await bundleImport({
  stdin: { contents: `${source}\nexport { syncAppManagedAgent };`, resolveDir: `${process.cwd()}/supabase/functions/elevenlabs-agent-session`, loader: 'ts' },
  plugins: [{ name: 'supabase-node', setup(builder) {
    builder.onResolve({ filter: /^npm:@supabase\/supabase-js/ }, () => ({ path: 'supabase-node', namespace: 'admin' }));
    builder.onLoad({ filter: /.*/, namespace: 'admin' }, () => ({ contents: 'export const createClient = () => globalThis.viaanSetupAdmin;' }));
  } }]
});
try {
  const result = await publisher.syncAppManagedAgent(config.id, owner);
  console.log(JSON.stringify({ name: definition.VIAAN_AGENT_NAME, config_id: config.id, agent_id: result.agent_id, voice_name: voiceInfo.name, voice_id: voice, realtime_model: result.voice_provider_config.app_managed.effective_realtime_model, tool_count: result.tool_count, status: 'published' }, null, 2));
} catch (error) {
  console.error(`Preset saved (${config.id}); publishing failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  delete globalThis.viaanSetupAdmin;
  delete globalThis.Deno;
}
