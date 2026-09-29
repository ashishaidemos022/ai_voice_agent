import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePcm16Base64 } from '../src/lib/voice-eval/synthetic-caller/pcm.ts';
import { generateNoiseBed, NOISE_RMS } from '../src/lib/voice-eval/synthetic-caller/noise.ts';

const rms = (x: Float32Array) => Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length);

test('decodes little-endian PCM16 base64 into floats', () => {
  const b64 = Buffer.from(new Int16Array([0, 16384, -32768, 32767]).buffer).toString('base64');
  const out = decodePcm16Base64(b64);
  assert.equal(out.length, 4);
  assert.equal(out[0], 0);
  assert.equal(out[1], 0.5);
  assert.equal(out[2], -1);
  assert.ok(Math.abs(out[3] - 0.99997) < 1e-4);
});

test('noise beds are deterministic per seed, the right length, and normalised', () => {
  for (const kind of ['cafe', 'car'] as const) {
    const a = generateNoiseBed(kind, 'run-1', 24000, 2);
    const b = generateNoiseBed(kind, 'run-1', 24000, 2);
    const c = generateNoiseBed(kind, 'run-2', 24000, 2);
    assert.equal(a.length, 48000);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
    assert.ok(Math.abs(rms(a) - NOISE_RMS) < 0.002, `${kind} rms ${rms(a)}`);
    assert.ok(a.every((v) => Math.abs(v) <= 1));
  }
});

test('café noise has clatter transients well above its RMS', () => {
  const cafe = generateNoiseBed('cafe', 'run-1', 24000, 4);
  const peak = cafe.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
  assert.ok(peak > 4 * rms(cafe), `peak ${peak}`);
});

test('mic noise floor is continuous, deterministic and quiet like a real microphone (never digital silence)', async () => {
  const { generateNoiseFloor, NOISE_FLOOR_RMS } = await import('../src/lib/voice-eval/synthetic-caller/noise.ts');
  const a = generateNoiseFloor('run-1', 24000, 2);
  assert.equal(a.length, 48000);
  assert.deepEqual(a, generateNoiseFloor('run-1', 24000, 2));
  assert.ok(Math.abs(rms(a) - NOISE_FLOOR_RMS) < 0.0002, `rms ${rms(a)}`);
  assert.ok(NOISE_FLOOR_RMS < 0.01, 'well below speech level');
  // No run of exact zeros longer than 1 ms anywhere in the loop.
  let zeros = 0;
  let longest = 0;
  for (const v of a) { zeros = v === 0 ? zeros + 1 : 0; longest = Math.max(longest, zeros); }
  assert.ok(longest < 24, `longest zero run ${longest}`);
});
