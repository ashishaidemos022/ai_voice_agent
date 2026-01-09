import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

type EmbedInfo = {
  id: string;
  publicId: string;
  agentConfigId: string;
  agentName: string | null;
  embedType: 'chat' | 'voice';
};

type UsageEventRow = {
  id: string;
  source: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  metadata: Record<string, any> | null;
  created_at: string;
};

type SessionSummary = {
  key: string;
  sessionId: string;
  embedId: string;
  embedType: 'chat' | 'voice';
  publicId: string | null;
  model: string | null;
  presetId: string | null;
  presetName: string | null;
  totalTokens: number;
  costUsd: number;
  lastAt: string;
};

type SessionMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4
});

const numberFormatter = new Intl.NumberFormat('en-US');

function formatTokens(value: number) {
  return numberFormatter.format(Math.max(0, Math.round(value)));
}

function formatCost(value: number) {
  return currencyFormatter.format(Math.max(0, value || 0));
}

export function EmbedUsageDashboard() {
  const { vaUser } = useAuth();
  const [embedList, setEmbedList] = useState<EmbedInfo[]>([]);
  const [sessionSummaries, setSessionSummaries] = useState<SessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(null);
  const [sessionMessages, setSessionMessages] = useState<SessionMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSessionMessages = useCallback(async (session: SessionSummary) => {
    setIsMessagesLoading(true);
    setSessionMessages([]);
    try {
      const { data, error: messageError } = await supabase
        .from('va_messages')
        .select('id, role, content, timestamp')
        .eq('session_id', session.sessionId)
        .order('timestamp', { ascending: true })
        .limit(200);
      if (messageError) throw messageError;
      const mapped = (data || []).map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.timestamp
      }));
      setSessionMessages(mapped);
    } catch (err: any) {
      console.error('Failed to load embed session messages', err);
      setError(err.message || 'Unable to load embed session messages.');
    } finally {
      setIsMessagesLoading(false);
    }
  }, []);

  const loadEmbedUsage = useCallback(async () => {
    if (!vaUser) return;
    setIsLoading(true);
    setError(null);
    try {
      const [chatEmbeds, voiceEmbeds, presets] = await Promise.all([
        supabase
          .from('va_agent_embeds')
          .select('id, public_id, agent_config_id, agent_config:va_agent_configs(name)')
          .order('created_at', { ascending: false }),
        supabase
          .from('va_voice_embeds')
          .select('id, public_id, agent_config_id, agent_config:va_agent_configs(name)')
          .order('created_at', { ascending: false }),
        supabase
          .from('va_agent_configs')
          .select('id, name')
      ]);

      if (chatEmbeds.error) throw chatEmbeds.error;
      if (voiceEmbeds.error) throw voiceEmbeds.error;
      if (presets.error) throw presets.error;

      const embedItems: EmbedInfo[] = [
        ...(chatEmbeds.data || []).map((row: any) => ({
          id: row.id,
          publicId: row.public_id,
          agentConfigId: row.agent_config_id,
          agentName: row.agent_config?.name || null,
          embedType: 'chat' as const
        })),
        ...(voiceEmbeds.data || []).map((row: any) => ({
          id: row.id,
          publicId: row.public_id,
          agentConfigId: row.agent_config_id,
          agentName: row.agent_config?.name || null,
          embedType: 'voice' as const
        }))
      ];
      setEmbedList(embedItems);

      const presetMap = new Map((presets.data || []).map((preset: any) => [preset.id, preset.name]));
      const { data: events, error: eventsError } = await supabase
        .from('va_usage_events')
        .select('id, source, model, input_tokens, output_tokens, total_tokens, cost_usd, metadata, created_at')
        .in('source', ['embed_chat', 'embed_voice'])
        .order('created_at', { ascending: false })
        .limit(500);
      if (eventsError) throw eventsError;

      const summaries = new Map<string, SessionSummary>();
      (events || []).forEach((event: UsageEventRow) => {
        const metadata = event.metadata || {};
        const sessionId = metadata.session_id as string | undefined;
        const embedId = metadata.embed_id as string | undefined;
        if (!sessionId || !embedId) return;
        const embedType: 'chat' | 'voice' = metadata.embed_type === 'voice' ? 'voice' : 'chat';
        const key = `${embedType}:${sessionId}`;
        const presetId = metadata.agent_preset_id as string | undefined;
        const existing = summaries.get(key);
        const totalTokens = (existing?.totalTokens || 0) + (event.total_tokens || 0);
        const costUsd = (existing?.costUsd || 0) + (event.cost_usd || 0);
        const lastAt = existing?.lastAt && existing.lastAt > event.created_at ? existing.lastAt : event.created_at;
        summaries.set(key, {
          key,
          sessionId,
          embedId,
          embedType,
          publicId: metadata.embed_public_id || null,
          model: event.model || existing?.model || null,
          presetId: presetId || existing?.presetId || null,
          presetName: (presetId && presetMap.get(presetId)) || existing?.presetName || null,
          totalTokens,
          costUsd,
          lastAt
        });
      });

      const sorted = Array.from(summaries.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
      setSessionSummaries(sorted);
    } catch (err: any) {
      console.error('Failed to load embed usage', err);
      setError(err.message || 'Unable to load embed usage data.');
    } finally {
      setIsLoading(false);
    }
  }, [vaUser]);

  useEffect(() => {
    loadEmbedUsage();
  }, [loadEmbedUsage]);

  const embedTotals = useMemo(() => {
    const totals = new Map<string, { tokens: number; cost: number }>();
    sessionSummaries.forEach((session) => {
      const key = session.embedId;
      const existing = totals.get(key) || { tokens: 0, cost: 0 };
      totals.set(key, {
        tokens: existing.tokens + session.totalTokens,
        cost: existing.cost + session.costUsd
      });
    });
    return totals;
  }, [sessionSummaries]);

  return (
    <div className="h-full flex flex-col gap-6 overflow-hidden">
      <Card className="p-6 bg-slate-900/60 border-white/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Embeds</p>
            <h2 className="text-2xl font-semibold text-white font-display">Embed Usage Stats</h2>
            <p className="text-sm text-white/60 mt-2">
              Track usage for your embedded chat and voice experiences.
            </p>
          </div>
          <Button size="xs" className="self-start px-4" onClick={loadEmbedUsage} disabled={isLoading}>
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
        {error && (
          <p className="text-sm text-rose-300 mt-3">{error}</p>
        )}
      </Card>

      <Card className="flex-1 bg-slate-900/50 border-white/10 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Embeds</p>
            <p className="text-lg font-semibold text-white">Embed usage overview</p>
          </div>
          <span className="text-xs text-white/50">Latest sessions</span>
        </div>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-0 h-full">
          <div className="border-r border-white/10 overflow-y-auto">
            {embedList.length === 0 ? (
              <div className="px-6 py-8 text-sm text-white/50">
                {isLoading ? 'Loading embeds...' : 'No embeds found.'}
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {embedList.map((embed) => {
                  const total = embedTotals.get(embed.id);
                  return (
                    <div key={embed.id} className="px-6 py-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-white">
                            {embed.embedType === 'voice' ? 'Voice embed' : 'Chat embed'}
                          </p>
                          <p className="text-xs text-white/50 mt-1">
                            {embed.agentName || 'Agent'} · {embed.publicId}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-white">{formatTokens(total?.tokens || 0)}</p>
                          <p className="text-xs text-white/50">{formatCost(total?.cost || 0)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col min-h-0">
            <div className="border-b border-white/10 px-6 py-4">
              <p className="text-sm font-semibold text-white">Embed sessions</p>
              <p className="text-xs text-white/50 mt-1">
                Select a session to view messages and usage.
              </p>
            </div>
            <div className="flex-1 grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-0 min-h-0">
              <div className="border-r border-white/10 overflow-y-auto">
                {sessionSummaries.length === 0 ? (
                  <div className="px-6 py-8 text-sm text-white/50">
                    {isLoading ? 'Loading sessions...' : 'No embed usage recorded yet.'}
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {sessionSummaries.slice(0, 30).map((session) => {
                      const isSelected = selectedSession?.key === session.key;
                      return (
                        <button
                          key={session.key}
                          type="button"
                          onClick={() => {
                            setSelectedSession(session);
                            loadSessionMessages(session);
                          }}
                          className={cn(
                            'w-full text-left px-6 py-4 transition',
                            isSelected ? 'bg-cyan-500/10' : 'hover:bg-white/5'
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-semibold text-white">
                                {session.embedType === 'voice' ? 'Voice embed session' : 'Chat embed session'}
                              </p>
                              <p className="text-xs text-white/50 mt-1">
                                {session.presetName || 'Preset'} · {session.publicId || session.embedId}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm text-white">{formatTokens(session.totalTokens)}</p>
                              <p className="text-xs text-white/50">{formatCost(session.costUsd)}</p>
                            </div>
                          </div>
                          <p className="text-xs text-white/40 mt-2">
                            Last update {new Date(session.lastAt).toLocaleString()}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="min-h-[240px] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-white/10">
                  <p className="text-sm font-semibold text-white">Session messages</p>
                  <p className="text-xs text-white/50 mt-1">
                    {selectedSession
                      ? `Session ${selectedSession.sessionId}`
                      : 'Select a session to view messages'}
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                  {!selectedSession ? (
                    <p className="text-sm text-white/50">Choose a session to inspect messages.</p>
                  ) : isMessagesLoading ? (
                    <p className="text-sm text-white/50">Loading messages...</p>
                  ) : sessionMessages.length === 0 ? (
                    <p className="text-sm text-white/50">No messages found for this session.</p>
                  ) : (
                    sessionMessages.map((message) => (
                      <div
                        key={message.id}
                        className={cn(
                          'rounded-xl border px-4 py-3 text-sm',
                          message.role === 'assistant'
                            ? 'border-white/10 bg-white/5 text-white/80'
                            : message.role === 'user'
                              ? 'border-cyan-400/30 bg-cyan-500/10 text-white'
                              : 'border-white/10 bg-slate-950/40 text-white/70'
                        )}
                      >
                        <div className="flex items-center justify-between text-xs text-white/50 mb-1">
                          <span className="uppercase tracking-[0.2em]">{message.role}</span>
                          <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
