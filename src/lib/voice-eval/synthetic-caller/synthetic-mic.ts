import type { Scenario } from '../../../../shared/voice-eval/types.ts';
import { generateNoiseBed } from './noise.ts';
import type { MicLike } from './types.ts';

const SAMPLE_RATE = 24000;
const START_LEAD_S = 0.05;
const MONITOR_GAIN = 0.5;

function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i += 1) {
    const x = (i * 2) / curve.length - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

/** A persistent mic track: silence by default, caller utterances on demand, and a looped noise bed. */
export async function createSyntheticMic(noise: Scenario['persona']['noise'], seed: string): Promise<MicLike> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  if (context.state === 'suspended') await context.resume().catch(() => undefined);
  if (context.state === 'suspended') {
    await context.close();
    throw new Error('Browser audio is suspended; click the page and start the eval again.');
  }
  const destination = context.createMediaStreamDestination();
  const voiceBus = context.createGain();
  // The owner watches runs hands-free, so they also hear the caller through the speakers. There is no
  // echo risk: the real mic is replaced for the whole call.
  const monitor = context.createGain();
  monitor.gain.value = MONITOR_GAIN;
  monitor.connect(context.destination);

  if (noise === 'speakerphone') {
    const highPass = context.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 300;
    const lowPass = context.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 3400;
    const shaper = context.createWaveShaper();
    shaper.curve = distortionCurve(4);
    voiceBus.connect(highPass).connect(lowPass).connect(shaper);
    shaper.connect(destination);
    shaper.connect(monitor);
  } else {
    voiceBus.connect(destination);
    voiceBus.connect(monitor);
  }

  let noiseSource: AudioBufferSourceNode | null = null;
  if (noise === 'cafe' || noise === 'car') {
    const samples = generateNoiseBed(noise, seed, SAMPLE_RATE);
    const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    noiseSource = context.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.loop = true;
    noiseSource.connect(destination);
    noiseSource.connect(monitor);
    noiseSource.start();
  }

  const track = destination.stream.getAudioTracks()[0];
  let current: { source: AudioBufferSourceNode; finish: () => void } | null = null;

  const mic: MicLike = {
    track,
    play(samples) {
      const buffer = context.createBuffer(1, Math.max(1, samples.length), SAMPLE_RATE);
      buffer.getChannelData(0).set(samples);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(voiceBus);
      const startedAt = performance.now() + START_LEAD_S * 1000;
      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          if (current?.source === source) current = null;
          resolve({ startedAt, endedAt: performance.now() });
        };
        source.onended = finish;
        current = { source, finish };
        source.start(context.currentTime + START_LEAD_S);
      });
    },
    stopPlayback() {
      const playing = current;
      if (!playing) return;
      try {
        playing.source.stop();
      } catch {
        // Already stopped.
      }
      playing.finish();
    },
    async close() {
      mic.stopPlayback();
      try {
        noiseSource?.stop();
      } catch {
        // Already stopped.
      }
      monitor.disconnect();
      track.stop();
      await context.close().catch(() => undefined);
    }
  };
  return mic;
}
