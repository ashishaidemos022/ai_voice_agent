import assert from 'node:assert/strict';
import test from 'node:test';
import {
  base64Pcm16ToFloat32,
  buildTranslationUpstreamUrl,
  inputAudioChunkMessage,
  isFatalTranslationError,
  normalizeTranslationConfig,
  parseTranslationMessage,
  Pcm16Batcher,
  pcm16ToBase64
} from '../shared/realtime-translation.ts';

test('pcm16ToBase64 matches Buffer encoding (little-endian) for odd and even lengths', () => {
  for (const length of [0, 1, 2, 3, 7, 1600]) {
    const samples = new Int16Array(length);
    for (let i = 0; i < length; i++) samples[i] = ((i * 7919) % 65536) - 32768;
    const expected = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64');
    assert.equal(pcm16ToBase64(samples), expected, `length ${length}`);
  }
});

test('base64Pcm16ToFloat32 round-trips PCM16 and drops a trailing odd byte', () => {
  const samples = Int16Array.from([0, 16384, -16384, 32767, -32768]);
  const decoded = base64Pcm16ToFloat32(pcm16ToBase64(samples));
  assert.deepEqual(Array.from(decoded), [0, 0.5, -0.5, 32767 / 32768, -1]);
  const odd = Buffer.from([0x00, 0x40, 0x07]).toString('base64');
  assert.deepEqual(Array.from(base64Pcm16ToFloat32(odd)), [0.5]);
});

test('Pcm16Batcher emits exact 100 ms chunks at 16 kHz and keeps the remainder', () => {
  const batcher = new Pcm16Batcher();
  assert.equal(batcher.chunkSamples, 1600);
  assert.equal(batcher.push(new Int16Array(1000)).length, 0);
  const chunks = batcher.push(Int16Array.from({ length: 2500 }, (_, i) => i));
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length === 1600));
  assert.equal(chunks[1][0], 600); // continuity across the boundary
  const rest = batcher.flush();
  assert.equal(rest?.length, 300);
  assert.equal(rest?.[0], 2200);
  assert.equal(batcher.flush(), null);
});

test('Pcm16Batcher handles frames larger than its internal buffer', () => {
  const batcher = new Pcm16Batcher(4);
  const chunks = batcher.push(Int16Array.from({ length: 42 }, (_, i) => i));
  assert.equal(chunks.length, 10);
  assert.deepEqual(Array.from(chunks[9]), [36, 37, 38, 39]);
  assert.deepEqual(Array.from(batcher.flush()!), [40, 41]);
});

test('inputAudioChunkMessage uses the documented message shape', () => {
  const message = JSON.parse(inputAudioChunkMessage(Int16Array.from([1, 2])));
  assert.deepEqual(Object.keys(message).sort(), ['audio_base_64', 'message_type']);
  assert.equal(message.message_type, 'input_audio_chunk');
});

test('normalizeTranslationConfig applies defaults and rejects bad input', () => {
  assert.deepEqual(normalizeTranslationConfig({ target_language: 'es', voice_id: 'JBFqnCBsd6RMkjVDRZzb' }), {
    target_language: 'es',
    source_language: null,
    voice_id: 'JBFqnCBsd6RMkjVDRZzb',
    tts_model_id: 'eleven_v4_turbo',
    eagerness: 'medium',
    enable_zrm: false
  });
  assert.throws(() => normalizeTranslationConfig({ target_language: 'es&x=1', voice_id: 'abcdefgh' }), /target_language/);
  assert.throws(() => normalizeTranslationConfig({ target_language: 'es', voice_id: '' }), /voice_id/);
  assert.throws(() => normalizeTranslationConfig({ target_language: 'es', source_language: 'es', voice_id: 'abcdefgh' }), /differ/);
  assert.throws(() => normalizeTranslationConfig({ target_language: 'es', voice_id: 'abcdefgh', tts_model_id: 'gpt' as never }), /tts_model_id/);
  assert.throws(() => normalizeTranslationConfig({ target_language: 'es', voice_id: 'abcdefgh', eagerness: 'max' as never }), /eagerness/);
});

test('buildTranslationUpstreamUrl targets /v1/translation/realtime without embedding credentials', () => {
  const config = normalizeTranslationConfig({
    target_language: 'fr', source_language: 'en', voice_id: 'voice123', tts_model_id: 'eleven_flash_v2_5', eagerness: 'high', enable_zrm: true
  });
  const url = new URL(buildTranslationUpstreamUrl('wss://api.elevenlabs.io', config, 'tr_abc_a'));
  assert.equal(url.origin + url.pathname, 'wss://api.elevenlabs.io/v1/translation/realtime');
  assert.equal(url.searchParams.get('target_language'), 'fr');
  assert.equal(url.searchParams.get('source_language'), 'en');
  assert.equal(url.searchParams.get('voice_id'), 'voice123');
  assert.equal(url.searchParams.get('input_format'), 'pcm_16000');
  assert.equal(url.searchParams.get('output_format'), 'pcm_24000');
  assert.equal(url.searchParams.get('tts_model_id'), 'eleven_flash_v2_5');
  assert.equal(url.searchParams.get('eagerness'), 'high');
  assert.equal(url.searchParams.get('enable_zrm'), 'true');
  assert.equal(url.searchParams.get('client_session_id'), 'tr_abc_a');
  assert.equal(url.searchParams.has('authorization'), false);
  assert.equal(url.searchParams.has('xi-api-key'), false);

  const auto = new URL(buildTranslationUpstreamUrl('wss://api.elevenlabs.io', normalizeTranslationConfig({ target_language: 'fr', voice_id: 'voice123' })));
  assert.equal(auto.searchParams.has('source_language'), false); // auto-detect
  assert.equal(auto.searchParams.has('enable_zrm'), false);
});

test('parseTranslationMessage validates every server message type', () => {
  assert.deepEqual(parseTranslationMessage('{"message_type":"session_started","session_id":"s1"}'), { message_type: 'session_started', session_id: 's1', client_session_id: null });
  assert.equal(parseTranslationMessage('{"message_type":"translation","text":"Hola"}')?.message_type, 'translation');
  assert.equal(parseTranslationMessage('{"message_type":"audio","data":"AAA=","sample_rate":24000}')?.message_type, 'audio');
  assert.equal(parseTranslationMessage('{"message_type":"audio","data":"AAA="}'), null);
  assert.equal(parseTranslationMessage('{"message_type":"partial_transcript"}'), null);
  assert.equal(parseTranslationMessage('not json'), null);
  assert.equal(parseTranslationMessage('{"message_type":"something_new"}'), null);
  assert.deepEqual(parseTranslationMessage('{"message_type":"quota_exceeded","error":"Out of credits"}'), { message_type: 'quota_exceeded', error: 'Out of credits' });
  assert.deepEqual(parseTranslationMessage('{"message_type":"gateway_error","error":"nope"}'), { message_type: 'gateway_error', error: 'nope' });
  assert.deepEqual(
    parseTranslationMessage('{"message_type":"invalid_request","error":"Realtime translation is only available for enterprise workspaces"}'),
    { message_type: 'invalid_request', error: 'Realtime translation is only available for enterprise workspaces' }
  );
  assert.deepEqual(parseTranslationMessage('{"message_type":"brand_new_error","error":"boom"}'), { message_type: 'error', error: 'boom' });
  assert.equal(isFatalTranslationError('invalid_request'), true);
  assert.equal(isFatalTranslationError('auth_error'), true);
  assert.equal(isFatalTranslationError('rate_limited'), false);
});
