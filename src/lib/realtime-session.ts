import { supabase } from './supabase';

export type RealtimeClientSecret = {
  token: string;
  expires_at: number | null;
};

export async function requestRealtimeWebSocketSecret(
  agentId: string,
  benchmarkRunId?: string
): Promise<RealtimeClientSecret> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (!supabaseUrl || !anonKey || !session?.access_token) {
    throw new Error('Authenticated Realtime session configuration is unavailable');
  }

  const url = new URL(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/realtime-session`);
  url.searchParams.set('agent_id', agentId);
  if (benchmarkRunId) url.searchParams.set('benchmark_run_id', benchmarkRunId);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ transport: 'websocket' })
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(responseBody || `Failed to create Realtime client secret (${response.status})`);
  }

  const payload = JSON.parse(responseBody) as Partial<RealtimeClientSecret>;
  if (!payload.token) {
    throw new Error('Realtime client secret response is missing a token');
  }
  return { token: payload.token, expires_at: payload.expires_at ?? null };
}
