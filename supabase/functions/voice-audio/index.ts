import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { ROUTED_VOICES, VOICE_AUDIO_LIMIT, speechSegments } from '../../../shared/voice-speech.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Expose-Headers': 'X-Voice-Usage-Saved' };
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Sign in to use voice' }, 401);
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return json({ error: 'Invalid session' }, 401);
    const { data: user } = await db.from('va_users').select('id').eq('auth_user_id', auth.user.id).maybeSingle();
    if (!user) return json({ error: 'User profile unavailable' }, 403);

    // Bound the multipart body before parsing it, including requests without Content-Length.
    const reader = req.body?.getReader();
    if (!reader) return json({ error: 'Audio request required' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > VOICE_AUDIO_LIMIT + 65536) { await reader.cancel(); return json({ error: 'Recording is too large' }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const form = await new Response(bytes, { headers: { 'Content-Type': req.headers.get('content-type') || '' } }).formData();
    const sessionId = String(form.get('session_id') || '');
    const agentId = String(form.get('agent_id') || '');
    const { data: session } = await db.from('va_chat_sessions').select('id,metadata,status').eq('id', sessionId).eq('user_id', user.id).eq('agent_preset_id', agentId).maybeSingle();
    if (!session || session.status !== 'active' || session.metadata?.channel !== 'routed_voice') return json({ error: 'Active routed voice session required' }, 403);
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) return json({ error: 'Voice service is not configured' }, 503);
    const action = form.get('action');
    let response: Response;
    const started = Date.now();
    const event: Record<string, unknown> = { user_id: user.id, session_id: sessionId, operation: action };
    async function saveUsage(usage: unknown = null) {
      try {
      const { error } = await db.from('va_voice_audio_events').insert({ ...event, usage, latency_ms: Date.now() - started, provider_request_id: response.headers.get('x-request-id') });
      if (error) console.error('Voice usage persistence failed', error.code);
      return !error;
      } catch { console.error('Voice usage persistence unavailable'); return false; }
    }
    if (action === 'transcribe') {
      const file = form.get('audio');
      if (!(file instanceof File) || !file.size || file.size > VOICE_AUDIO_LIMIT) return json({ error: 'A recording up to 10 MB is required' }, 400);
      const extensions: Record<string, string> = { 'audio/webm': 'webm', 'video/webm': 'webm', 'audio/mp4': 'mp4', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };
      const extension = extensions[file.type.split(';')[0]];
      if (!extension) return json({ error: 'Unsupported recording format' }, 400);
      const seconds = Number(form.get('duration_seconds'));
      const duration = Number.isFinite(seconds) && seconds > 0 && seconds <= 65 ? seconds : null;
      Object.assign(event, { model: 'gpt-4o-mini-transcribe', input_bytes: file.size, duration_seconds: duration, estimated_cost_usd: duration === null ? null : duration / 60 * 0.003 });
      const upload = new FormData(); upload.append('file', file, `recording.${extension}`); upload.append('model', 'gpt-4o-mini-transcribe');
      response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: upload, signal: AbortSignal.timeout(60000) });
    } else if (action === 'speak') {
      const { data: message } = await db.from('va_chat_messages').select('message').eq('raw->sources->>turnId', String(form.get('turn_id') || '')).eq('session_id', sessionId).eq('user_id', user.id).eq('sender', 'assistant').maybeSingle();
      if (!message) return json({ error: 'Saved assistant answer not found' }, 404);
      const voice = String(form.get('voice') || 'coral');
      if (!(ROUTED_VOICES as readonly string[]).includes(voice)) return json({ error: 'Unsupported voice' }, 400);
      const segments = speechSegments(message.message);
      const segment = Number(form.get('segment') || 0);
      if (!Number.isInteger(segment) || segment < 0 || segment >= segments.length) return json({ error: 'Invalid speech segment' }, 400);
      const text = segments[segment];
      Object.assign(event, { model: 'gpt-4o-mini-tts', turn_id: String(form.get('turn_id')), segment, input_characters: text.length });
      // Optional account-specific estimate. Leave cost unknown until a rate is configured.
      const rateValue = Deno.env.get('VOICE_TTS_USD_PER_MILLION_CHARACTERS');
      const rate = rateValue ? Number(rateValue) : NaN;
      event.estimated_cost_usd = Number.isFinite(rate) && rate >= 0 ? text.length / 1e6 * rate : null;
      if (!text) return json({ error: 'This answer has no spoken text' }, 400);
      // Resolve each bounded segment from the saved answer, never caller-supplied text.
      response = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text, response_format: 'mp3' }), signal: AbortSignal.timeout(60000) });
    } else return json({ error: 'Unknown audio operation' }, 400);
    if (!response.ok) return json({ error: `Speech provider request failed (${response.status}). Please try again.` }, 502);
    if (action === 'transcribe') { const result = await response.json(); const usageSaved = await saveUsage(result.usage); return json({ text: result.text || '', usageSaved }); }
    const usageSaved = await saveUsage();
    return new Response(response.body, { headers: { ...cors, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice-Usage-Saved': String(usageSaved) } });
  } catch (error) {
    console.error('Voice audio request failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Voice request could not be completed. Your conversation is still available.' }, 500);
  }
});
