/** Streams a MediaStreamTrack as 24 kHz PCM16 frames via the existing pcm-downsampler worklet (WebSocket transport). */
export async function startPcmPump(track: MediaStreamTrack, onFrame: (pcm: Int16Array) => void): Promise<() => void> {
  const context = new AudioContext({ sampleRate: 24000 });
  try {
    await context.audioWorklet.addModule(new URL('/audio-worklet-processor.js', window.location.origin).toString());
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const node = new AudioWorkletNode(context, 'pcm-downsampler', { processorOptions: { targetSampleRate: 24000 } });
    node.port.onmessage = (event: MessageEvent<Int16Array>) => onFrame(event.data);
    source.connect(node);
    if (context.state === 'suspended') await context.resume();
    return () => {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      void context.close();
    };
  } catch (error) {
    void context.close();
    throw error;
  }
}
