import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

type UsageDailyRow = {
  usage_date: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
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
  sessionType: 'voice' | 'chat';
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

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function UsageDashboard() {
  const { vaUser } = useAuth();
  const [rows, setRows] = useState<UsageDailyRow[]>([]);
  const [allTimeTotals, setAllTimeTotals] = useState<UsageDailyRow | null>(null);
  const [sessionSummaries, setSessionSummaries] = useState<SessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(null);
  const selectedSessionKeyRef = useRef<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<SessionMessage[]>([]);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSessionMessages = useCallback(async (session: SessionSummary) => {
    setIsMessagesLoading(true);
    setSessionMessages([]);
    try {
      if (session.sessionType === 'chat') {
        const { data, error: messageError } = await supabase
          .from('va_chat_messages')
          .select('id, sender, message, created_at')
          .eq('session_id', session.sessionId)
          .order('created_at', { ascending: true })
          .limit(200);
        if (messageError) throw messageError;
        const mapped = (data || []).map((row) => ({
          id: row.id,
          role: row.sender,
          content: row.message,
          createdAt: row.created_at
        }));
        setSessionMessages(mapped);
      } else {
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
      }
    } catch (err: any) {
      console.error('Failed to load session messages', err);
      setSessionMessages([]);
      setError(err.message || 'Unable to load session messages.');
    } finally {
      setIsMessagesLoading(false);
    }
  }, []);

  const loadUsage = useCallback(async () => {
    if (!vaUser) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: listError } = await supabase
        .from('va_usage_daily')
        .select('usage_date, input_tokens, output_tokens, total_tokens, cost_usd')
        .order('usage_date', { ascending: false })
        .limit(30);
      if (listError) throw listError;
      setRows(data || []);

      const { data: allRows, error: allError } = await supabase
        .from('va_usage_daily')
        .select('input_tokens, output_tokens, total_tokens, cost_usd');
      if (allError) throw allError;
      const totals = (allRows || []).reduce(
        (acc, row) => ({
          usage_date: 'all-time',
          input_tokens: acc.input_tokens + (row.input_tokens || 0),
          output_tokens: acc.output_tokens + (row.output_tokens || 0),
          total_tokens: acc.total_tokens + (row.total_tokens || 0),
          cost_usd: acc.cost_usd + (row.cost_usd || 0)
        }),
        { usage_date: 'all-time', input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 }
      );
      setAllTimeTotals(totals);

      const { data: presets, error: presetsError } = await supabase
        .from('va_agent_configs')
        .select('id, name');
      if (presetsError) throw presetsError;
      const presetMap = new Map((presets || []).map((preset) => [preset.id, preset.name]));

      const { data: events, error: eventsError } = await supabase
        .from('va_usage_events')
        .select('id, source, model, input_tokens, output_tokens, total_tokens, cost_usd, metadata, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (eventsError) throw eventsError;
      const summaries = new Map<string, SessionSummary>();

      (events || []).forEach((event: UsageEventRow) => {
        const metadata = event.metadata || {};
        const chatSessionId = metadata.chat_session_id as string | undefined;
        const voiceSessionId = metadata.session_id as string | undefined;
        const sessionId = chatSessionId || voiceSessionId;
        if (!sessionId) {
          return;
        }
        const sessionType: 'chat' | 'voice' = chatSessionId ? 'chat' : 'voice';
        const key = `${sessionType}:${sessionId}`;
        const presetId = metadata.agent_preset_id as string | undefined;
        const existing = summaries.get(key);
        const nextTotals = {
          totalTokens: (existing?.totalTokens || 0) + (event.total_tokens || 0),
          costUsd: (existing?.costUsd || 0) + (event.cost_usd || 0)
        };
        const lastAt = existing?.lastAt && existing.lastAt > event.created_at ? existing.lastAt : event.created_at;
        summaries.set(key, {
          key,
          sessionId,
          sessionType,
          model: event.model || existing?.model || null,
          presetId: presetId || existing?.presetId || null,
          presetName: (presetId && presetMap.get(presetId)) || existing?.presetName || null,
          totalTokens: nextTotals.totalTokens,
          costUsd: nextTotals.costUsd,
          lastAt
        });
      });

      const sorted = Array.from(summaries.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
      setSessionSummaries(sorted);
      if (selectedSessionKeyRef.current) {
        const refreshed = sorted.find((session) => session.key === selectedSessionKeyRef.current);
        if (refreshed && refreshed.key !== selectedSession?.key) {
          setSelectedSession(refreshed);
        }
      }
    } catch (err: any) {
      console.error('Failed to load usage', err);
      setError(err.message || 'Unable to load usage data.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedSession?.key, vaUser]);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  useEffect(() => {
    selectedSessionKeyRef.current = selectedSession?.key || null;
  }, [selectedSession?.key]);

  const summary = useMemo(() => {
    const todayKey = toDateKey(new Date());
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - 6);
    const weekKey = toDateKey(startOfWeek);

    const todayRow = rows.find((row) => row.usage_date === todayKey);
    const weekTotals = rows.reduce(
      (acc, row) => {
        if (row.usage_date >= weekKey) {
          acc.input_tokens += row.input_tokens || 0;
          acc.output_tokens += row.output_tokens || 0;
          acc.total_tokens += row.total_tokens || 0;
          acc.cost_usd += row.cost_usd || 0;
        }
        return acc;
      },
      { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 }
    );

    return {
      today: todayRow || { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 },
      week: weekTotals,
      all: allTimeTotals || { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 }
    };
  }, [rows, allTimeTotals]);

  return (
    <div className="h-full flex flex-col gap-6 overflow-hidden">
      <Card className="p-6 bg-slate-900/60 border-white/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Usage</p>
            <h2 className="text-2xl font-semibold text-white font-display">Usage Dashboard</h2>
            <p className="text-sm text-white/60 mt-2">
              Track tokens and spend across voice, chat, and web search activity.
            </p>
          </div>
          <Button size="xs" className="self-start px-4" onClick={loadUsage} disabled={isLoading}>
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
        {error && (
          <p className="text-sm text-rose-300 mt-3">{error}</p>
        )}
      </Card>

      <div className="grid md:grid-cols-3 gap-4">
        {[
          { label: 'Today', data: summary.today },
          { label: 'Last 7 days', data: summary.week },
          { label: 'All time', data: summary.all }
        ].map((item) => (
          <Card key={item.label} className="p-5 bg-slate-900/60 border-white/10">
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">{item.label}</p>
            <p className="text-2xl font-semibold text-white mt-2">{formatTokens(item.data.total_tokens)} tokens</p>
            <div className="mt-3 space-y-1 text-sm text-white/60">
              <div className="flex items-center justify-between">
                <span>Input</span>
                <span>{formatTokens(item.data.input_tokens)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Output</span>
                <span>{formatTokens(item.data.output_tokens)}</span>
              </div>
              <div className="flex items-center justify-between text-white/80 font-semibold">
                <span>Estimated cost</span>
                <span>{formatCost(item.data.cost_usd)}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="flex-1 bg-slate-900/50 border-white/10 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Daily usage</p>
            <p className="text-lg font-semibold text-white">Recent activity</p>
          </div>
          <span className="text-xs text-white/50">Last 30 days</span>
        </div>
        <div className="overflow-y-auto">
          {rows.length === 0 ? (
            <div className="px-6 py-8 text-sm text-white/50">
              {isLoading ? 'Loading usage...' : 'No usage recorded yet.'}
            </div>
          ) : (
            <table className="w-full text-sm text-white/70">
              <thead className="sticky top-0 bg-slate-950/80 backdrop-blur">
                <tr className="text-left">
                  <th className="px-6 py-3 font-medium text-white/60">Date</th>
                  <th className="px-6 py-3 font-medium text-white/60">Input</th>
                  <th className="px-6 py-3 font-medium text-white/60">Output</th>
                  <th className="px-6 py-3 font-medium text-white/60">Total</th>
                  <th className="px-6 py-3 font-medium text-white/60">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.usage_date} className="border-t border-white/5">
                    <td className="px-6 py-3 text-white/80">{row.usage_date}</td>
                    <td className="px-6 py-3">{formatTokens(row.input_tokens)}</td>
                    <td className="px-6 py-3">{formatTokens(row.output_tokens)}</td>
                    <td className={cn('px-6 py-3 font-semibold', row.total_tokens > 0 ? 'text-white' : 'text-white/40')}>
                      {formatTokens(row.total_tokens)}
                    </td>
                    <td className="px-6 py-3">{formatCost(row.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card className="bg-slate-900/50 border-white/10 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Sessions</p>
            <p className="text-lg font-semibold text-white">Usage by session</p>
          </div>
          <span className="text-xs text-white/50">Latest sessions</span>
        </div>
        <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-0">
          <div className="border-r border-white/10">
            {sessionSummaries.length === 0 ? (
              <div className="px-6 py-8 text-sm text-white/50">
                {isLoading ? 'Loading sessions...' : 'No session usage recorded yet.'}
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {sessionSummaries.slice(0, 25).map((session) => {
                  const isSelected = selectedSession?.key === session.key;
                  return (
                    <button
                      key={session.key}
                      type="button"
                      onClick={() => {
                        setSelectedSession(session);
                        selectedSessionKeyRef.current = session.key;
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
                            {session.sessionType === 'chat' ? 'Chat session' : 'Voice session'}
                          </p>
                          <p className="text-xs text-white/50 mt-1">
                            {session.presetName || 'Preset'} · {session.model || 'Model'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-white">{formatTokens(session.totalTokens)}</p>
                          <p className="text-xs text-white/50">{formatCost(session.costUsd)}</p>
                        </div>
                      </div>
                      <p className="text-xs text-white/40 mt-2">Last update {new Date(session.lastAt).toLocaleString()}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="min-h-[240px]">
            <div className="px-6 py-4 border-b border-white/10">
              <p className="text-sm font-semibold text-white">Session messages</p>
              <p className="text-xs text-white/50 mt-1">
                {selectedSession
                  ? `${selectedSession.sessionType === 'chat' ? 'Chat' : 'Voice'} session ${selectedSession.sessionId}`
                  : 'Select a session to view messages'}
              </p>
            </div>
            <div className="max-h-[420px] overflow-y-auto px-6 py-4 space-y-3">
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
      </Card>
    </div>
  );
}
