import { supabase } from './supabase';
import type { MemoryEvent, MemoryRecord, MemorySubject } from '../../shared/agent-memory';

export type MemoryCandidate = Pick<MemoryRecord, 'kind' | 'memory_key' | 'title' | 'content' | 'source_quote' | 'source_message_id'>;
export type MemoryApiResult = {
  subjects?: MemorySubject[]; subject?: MemorySubject; records?: MemoryRecord[]; record?: MemoryRecord;
  events?: MemoryEvent[]; candidates?: MemoryCandidate[];
  versions?: Array<{ version: number; snapshot: MemoryRecord; created_at: string }>;
};
export async function memoryRequest(agentId: string, subjectId: string | null, action: string, extra: Record<string, unknown> = {}, signal?: AbortSignal): Promise<MemoryApiResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in to access memory');
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-memory`, {
    signal,
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ ...extra, agent_id: agentId, subject_id: subjectId, action })
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('Memory service is unavailable. Deploy the memory migration and Edge Functions.'); }
  if (!response.ok) throw new Error(result.error || 'Memory request failed');
  return result;
}
