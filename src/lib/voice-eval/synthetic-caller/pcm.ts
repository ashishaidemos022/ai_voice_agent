/** ElevenLabs pcm_24000 is 16-bit little-endian mono. */
export function decodePcm16Base64(b64: string): Float32Array {
  const binary = atob(b64);
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) view.setUint8(i, binary.charCodeAt(i));
  const out = new Float32Array(Math.floor(binary.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}
