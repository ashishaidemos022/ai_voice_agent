import { readFile } from 'node:fs/promises';

function parseEnv(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return values;
}

async function loadProjectEnv() {
  try {
    return parseEnv(await readFile('.env', 'utf8'));
  } catch {
    return {};
  }
}

const projectEnv = await loadProjectEnv();
const supabaseUrl = process.env.VITE_SUPABASE_URL || projectEnv.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || projectEnv.VITE_SUPABASE_ANON_KEY;
const accessToken = process.env.VOICE_AGENT_USER_JWT;
const agentId = process.env.VOICE_AGENT_ID;
const sdpPath = process.env.VOICE_AGENT_SDP_FILE;

const missing = [
  !supabaseUrl && 'VITE_SUPABASE_URL',
  !anonKey && 'VITE_SUPABASE_ANON_KEY',
  !accessToken && 'VOICE_AGENT_USER_JWT',
  !agentId && 'VOICE_AGENT_ID',
  !sdpPath && 'VOICE_AGENT_SDP_FILE'
].filter(Boolean);

if (missing.length) {
  console.error(`Missing required configuration: ${missing.join(', ')}`);
  console.error('The Supabase URL and anon key may be supplied by .env; user JWTs are never read from disk automatically.');
  process.exit(2);
}

const offerSdp = await readFile(sdpPath, 'utf8');
if (!offerSdp.includes('v=0') || !offerSdp.includes('m=audio')) {
  console.error('VOICE_AGENT_SDP_FILE does not look like a WebRTC audio offer.');
  process.exit(2);
}

const endpoint = new URL('/functions/v1/realtime-session', supabaseUrl);
endpoint.searchParams.set('agent_id', agentId);

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    apikey: anonKey,
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json'
  },
  body: JSON.stringify({ transport: 'webrtc', sdp: offerSdp })
});
const responseText = await response.text();

if (!response.ok) {
  console.error(`GPT-Live handshake failed (${response.status}): ${responseText.slice(0, 1_000)}`);
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(responseText);
} catch {
  console.error('GPT-Live handshake returned a non-JSON success response.');
  process.exit(1);
}

const answerSdp = payload?.transport?.sdp;
if (payload?.transport?.type !== 'webrtc' || typeof answerSdp !== 'string' || !answerSdp.includes('v=0')) {
  console.error('GPT-Live handshake response did not include a valid WebRTC answer.');
  process.exit(1);
}

console.log(`GPT-Live handshake succeeded for session ${payload?.session?.id || payload?.id || '(id unavailable)'}.`);
console.log(`Answer SDP received (${Buffer.byteLength(answerSdp)} bytes).`);
