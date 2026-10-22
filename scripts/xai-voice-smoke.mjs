// Verify the live voice catalog, browser-style ephemeral auth, and Grok V3 audio.
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { build } from 'esbuild';
import WebSocket from 'ws';

const option = (flag, fallback) => process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : fallback;
const project = option('--project-ref'), owner = option('--owner-id'), voice = option('--voice', 'iris');
if (!project || !owner) throw new Error('Pass --project-ref and --owner-id');
const bundle = await build({ entryPoints: ['shared/xai-voice-models.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { XAI_VOICES, XAI_VOICE_MODELS } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', project, '--reveal', '--output', 'json'], { encoding: 'utf8' }));
const serviceKey = keys.find((key) => key.name === 'service_role')?.api_key;
if (!serviceKey) throw new Error('Project service role key is unavailable');
const db = createClient(`https://${project}.supabase.co`, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: providerKeys, error } = await db.from('va_provider_keys').select('encrypted_key').eq('provider', 'xai').eq('user_id', owner).order('created_at', { ascending: false }).limit(1);
if (error || !providerKeys?.length) throw new Error('No xAI provider key for this owner');
const providerKey = Buffer.from(providerKeys[0].encrypted_key, 'base64').toString().trim();
const headers = { Authorization: `Bearer ${providerKey}`, 'Content-Type': 'application/json' };
const catalogResponse = await fetch('https://api.x.ai/v1/tts/voices', { headers });
if (!catalogResponse.ok) throw new Error(`Catalog lookup failed (${catalogResponse.status})`);
const catalog = await catalogResponse.json();
const available = new Set(catalog.voices.map((entry) => entry.voice_id || entry.id));
if (XAI_VOICES.some((entry) => !available.has(entry.value)) || !available.has(voice)) throw new Error('The selected or configured voice is missing from the live catalog');
const tokenResponse = await fetch('https://api.x.ai/v1/realtime/client_secrets', { method: 'POST', headers, body: JSON.stringify({ expires_after: { seconds: 300 } }) });
if (!tokenResponse.ok) throw new Error(`Ephemeral credential request failed (${tokenResponse.status})`);
const token = await tokenResponse.json();
if (!token.value) throw new Error('xAI did not return an ephemeral credential');
try {
  const result = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://api.x.ai/v1/realtime?model=${XAI_VOICE_MODELS.flagship}`, [`xai-client-secret.${token.value}`]);
    let configured = false, finished = false, providerModel = null, echoedVoice = null;
    const finish = (error, result) => {
      if (finished) return; finished = true;
      clearTimeout(timer); ws.close();
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Timed out waiting for Grok V3 audio')), 30000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'session.update', session: {
      voice, instructions: 'Be a warm, expressive assistant. Say exactly: Hello! How can I help you today?',
      reasoning: { effort: 'none' }, turn_detection: null, tools: [],
      audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: { model: 'grok-transcribe' } }, output: { format: { type: 'audio/pcm', rate: 24000 } } }
    } })));
    ws.on('message', (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === 'error') return finish(new Error(`xAI rejected the session: ${event.error?.code || 'provider_error'}`));
      if (event.type === 'session.updated' && !configured) {
        // xAI does not always echo the voice in session.updated.
        echoedVoice = event.session?.voice || event.session?.audio?.output?.voice || null;
        if (echoedVoice && echoedVoice !== voice) return finish(new Error('xAI returned a different voice'));
        providerModel = event.session?.model || null;
        configured = true;
        ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Please greet me.' }] } }));
        ws.send(JSON.stringify({ type: 'response.create', response: { modalities: ['text', 'audio'] } }));
      }
      if (['response.output_audio.delta', 'response.audio.delta'].includes(event.type) && event.delta) finish(null, { model: XAI_VOICE_MODELS.flagship, provider_model: providerModel, requested_voice: voice, echoed_voice: echoedVoice, catalog_voices_verified: XAI_VOICES.length, ephemeral_auth: true, session_accepted: configured, first_audio_bytes: Buffer.from(event.delta, 'base64').length });
    });
    ws.on('error', () => finish(new Error('Grok V3 WebSocket connection failed')));
    ws.on('close', () => { if (!finished) finish(new Error('Grok V3 closed before sending audio')); });
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
