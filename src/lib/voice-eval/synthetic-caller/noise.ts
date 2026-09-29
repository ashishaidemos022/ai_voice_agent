import { seededRandom } from '../../../../shared/voice-eval/caller/random.ts';

/** Noise RMS that sits roughly 10 dB under typical TTS speech. */
export const NOISE_RMS = 0.03;
export type NoiseBedKind = 'cafe' | 'car';

export function generateNoiseBed(kind: NoiseBedKind, seed: string, sampleRate = 24000, seconds = 8): Float32Array {
  const random = seededRandom(`${kind}:${seed}`);
  const white = () => random() * 2 - 1;
  const out = new Float32Array(Math.round(sampleRate * seconds));

  if (kind === 'car') {
    // Low rumble: brown noise through a one-pole low-pass.
    let brown = 0;
    let low = 0;
    for (let i = 0; i < out.length; i += 1) {
      brown = (brown + 0.02 * white()) / 1.02;
      low += 0.05 * (brown - low);
      out[i] = low;
    }
  } else {
    // Café: pink-noise room tone, a swelling low murmur, and short cutlery/cup clatters.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let murmur = 0;
    const phase = random() * Math.PI * 2;
    const clatterLength = Math.round(sampleRate * 0.03);
    let nextClatter = Math.round(sampleRate * (0.4 + random() * 1.1));
    let clatterLeft = 0;
    let clatterGain = 0;
    for (let i = 0; i < out.length; i += 1) {
      const w = white();
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      const pink = (b0 + b1 + b2 + w * 0.1848) * 0.05;
      murmur += 0.08 * (white() - murmur);
      const swell = 0.5 + 0.35 * Math.sin(phase + (2 * Math.PI * 0.4 * i) / sampleRate);
      let sample = pink * 0.6 + murmur * swell;
      if (i >= nextClatter) {
        clatterLeft = clatterLength;
        clatterGain = 0.6 + random() * 0.6;
        nextClatter = i + Math.round(sampleRate * (0.4 + random() * 1.1));
      }
      if (clatterLeft > 0) {
        sample += white() * clatterGain * (clatterLeft / clatterLength);
        clatterLeft -= 1;
      }
      out[i] = sample;
    }
  }

  const current = Math.sqrt(out.reduce((sum, v) => sum + v * v, 0) / out.length) || 1;
  const gain = NOISE_RMS / current;
  for (let i = 0; i < out.length; i += 1) out[i] = Math.max(-1, Math.min(1, out[i] * gain));
  return out;
}
