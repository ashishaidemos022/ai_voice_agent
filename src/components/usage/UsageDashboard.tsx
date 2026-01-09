import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (err: any) {
      console.error('Failed to load usage', err);
      setError(err.message || 'Unable to load usage data.');
    } finally {
      setIsLoading(false);
    }
  }, [vaUser]);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

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
    </div>
  );
}
