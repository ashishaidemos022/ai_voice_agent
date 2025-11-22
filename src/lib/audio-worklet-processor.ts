/// <reference lib="webworker" />

// Minimal AudioWorklet type declarations for the isolated worklet context.
declare const registerProcessor: (name: string, processorCtor: any) => void;
declare const sampleRate: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: any);
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

// AudioWorkletProcessor that downsamples input to 24kHz and outputs PCM16 frames.
class PCMDownsamplerProcessor extends AudioWorkletProcessor {
  private readonly targetSampleRate: number;
  private readonly sampleRateRatio: number;
  private phase: number;

  constructor(options: any) {
    super(options);
    this.targetSampleRate = options?.processorOptions?.targetSampleRate || 24000;
    this.sampleRateRatio = sampleRate / this.targetSampleRate;
    this.phase = 0;
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) {
      return true;
    }

    let resampled = input;

    if (this.sampleRateRatio !== 1) {
      // Simple linear resampling to maintain output at 24kHz when AudioContext runs at 48kHz.
      const outLength = Math.floor((input.length + this.phase) / this.sampleRateRatio);
      const output = new Float32Array(outLength);

      for (let i = 0; i < outLength; i++) {
        const sourcePos = i * this.sampleRateRatio + this.phase;
        const index = Math.floor(sourcePos);
        const frac = sourcePos - index;
        const nextIndex = Math.min(index + 1, input.length - 1);
        output[i] = input[index] * (1 - frac) + input[nextIndex] * frac;
      }

      this.phase = (input.length + this.phase) - outLength * this.sampleRateRatio;
      resampled = output;
    }

    const pcm = new Int16Array(resampled.length);
    for (let i = 0; i < resampled.length; i++) {
      const s = Math.max(-1, Math.min(1, resampled[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    this.port.postMessage(pcm, [pcm.buffer]);
    return true;
  }
}

registerProcessor('pcm-downsampler', PCMDownsamplerProcessor);

export {};
