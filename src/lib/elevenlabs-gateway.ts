import { supabase } from './supabase';

export type ElevenLabsGatewayTokenResponse = {
  token: string;
  gateway_ws_url: string;
  expires_in: number;
};

export async function requestElevenLabsGatewayToken(params: {
  agentId: string;
  sessionId: string;
  origin: string;
}): Promise<ElevenLabsGatewayTokenResponse> {
  const { agentId, sessionId, origin } = params;
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  const { data, error } = await supabase.functions.invoke('elevenlabs-gateway-token', {
    body: {
      agent_id: agentId,
      session_id: sessionId,
      origin
    },
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined
  });

  if (error) {
    throw new Error(error.message || 'Failed to fetch ElevenLabs gateway token');
  }

  if (!data?.token || !data?.gateway_ws_url) {
    throw new Error('ElevenLabs gateway token response missing token or URL');
  }

  return data as ElevenLabsGatewayTokenResponse;
}
