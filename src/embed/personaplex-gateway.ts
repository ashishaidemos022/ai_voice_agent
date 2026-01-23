import { buildEmbedFunctionUrl, resolveEmbedApiBase } from './embed-api';

export type PersonaPlexGatewayTokenResponse = {
  token: string;
  gateway_ws_url: string;
  expires_in: number;
};

export async function requestPersonaPlexEmbedToken(params: {
  publicId: string;
  sessionId: string;
  origin: string;
}): Promise<PersonaPlexGatewayTokenResponse> {
  const apiBase = resolveEmbedApiBase();
  if (!apiBase) {
    throw new Error('Embed API base is missing');
  }
  const url = buildEmbedFunctionUrl(apiBase, 'personaplex-gateway-token');
  if (!url) {
    throw new Error('Embed API base is missing');
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_public_id: params.publicId,
      session_id: params.sessionId,
      origin: params.origin
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || 'Failed to fetch PersonaPlex gateway token');
  }
  if (!payload?.token || !payload?.gateway_ws_url) {
    throw new Error('PersonaPlex gateway token response missing token or URL');
  }
  return payload as PersonaPlexGatewayTokenResponse;
}
