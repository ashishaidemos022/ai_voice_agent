export interface FingerprintInput {
  instructions: string;
  model: string;
  voice: string;
  provider: string;
  toolNames: string[];
}

export async function configFingerprint(input: FingerprintInput): Promise<string> {
  const canonical = JSON.stringify({
    instructions: input.instructions,
    model: input.model,
    voice: input.voice,
    provider: input.provider,
    toolNames: [...input.toolNames].sort()
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
