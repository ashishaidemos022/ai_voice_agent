import { supabase } from './supabase';

export type PersonaPlexGatewayTokenResponse = {
  token: string;
  gateway_ws_url: string;
  expires_in: number;
};

export async function requestPersonaPlexGatewayToken(params: {
  agentId: string;
  sessionId: string;
  origin: string;
}): Promise<PersonaPlexGatewayTokenResponse> {
  const { agentId, sessionId, origin } = params;
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  const { data, error } = await supabase.functions.invoke('personaplex-gateway-token', {
    body: {
      agent_id: agentId,
      session_id: sessionId,
      origin
    },
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined
  });

  if (error) {
    throw new Error(error.message || 'Failed to fetch PersonaPlex gateway token');
  }

  if (!data?.token || !data?.gateway_ws_url) {
    throw new Error('PersonaPlex gateway token response missing token or URL');
  }

  return data as PersonaPlexGatewayTokenResponse;
}
