import { useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

interface WebSearchSkillCardProps {
  configId: string | null;
  onUpdated?: () => void;
}

export function WebSearchSkillCard({ configId, onUpdated }: WebSearchSkillCardProps) {
  const { vaUser } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [domains, setDomains] = useState('');
  const [maxResults, setMaxResults] = useState(5);
  const [timeRange, setTimeRange] = useState('any');
  const [snippetsOnly, setSnippetsOnly] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!configId) return;
    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('va_agent_config_tools')
          .select('metadata')
          .eq('config_id', configId)
          .eq('tool_name', 'web_search')
          .maybeSingle();

        if (!active) return;
        if (error || !data) {
          setEnabled(false);
          setDomains('');
          setMaxResults(5);
          setTimeRange('any');
          setSnippetsOnly(true);
          return;
        }

        const metadata = data.metadata || {};
        const domainList = Array.isArray(metadata.allowed_domains) ? metadata.allowed_domains.join('\n') : '';
        setEnabled(true);
        setDomains(domainList);
        setMaxResults(Number(metadata.max_results ?? 5));
        setTimeRange(String(metadata.time_range ?? 'any'));
        setSnippetsOnly(Boolean(metadata.snippets_only ?? true));
      } finally {
        if (active) setIsLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [configId]);

  const handleSave = async () => {
    if (!configId || !vaUser) return;
    setIsSaving(true);
    setMessage(null);
    const allowedDomains = domains
      .split('\n')
      .map((domain) => domain.trim())
      .filter(Boolean);
    try {
      await supabase
        .from('va_agent_config_tools')
        .delete()
        .eq('config_id', configId)
        .eq('tool_name', 'web_search');

      if (enabled) {
        const { error } = await supabase.from('va_agent_config_tools').insert({
          config_id: configId,
          tool_name: 'web_search',
          tool_source: 'client',
          user_id: vaUser.id,
          metadata: {
            allowed_domains: allowedDomains,
            max_results: maxResults,
            time_range: timeRange,
            snippets_only: snippetsOnly
          }
        });
        if (error) {
          throw error;
        }
      }
      onUpdated?.();
      setMessage('Saved web search settings.');
    } catch (error: any) {
      setMessage(error?.message || 'Failed to save web search settings.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="p-6 bg-slate-900/60 border-white/10 flex flex-col gap-4">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Web Search</p>
        <h3 className="text-lg font-semibold text-white">Grounded website search</h3>
        <p className="text-sm text-white/60 mt-2">
          Restrict answers to approved domains and control freshness.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm text-white/80">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="w-4 h-4 rounded border-white/20 text-cyan-400 focus:ring-cyan-400"
          disabled={isLoading}
        />
        Enable Web Search for this agent
      </label>
      <div className="space-y-1">
        <label className="text-xs text-white/60">Allowed domains (one per line)</label>
        <textarea
          rows={3}
          value={domains}
          onChange={(event) => setDomains(event.target.value)}
          placeholder="example.com\ndocs.example.com"
          className="w-full rounded-lg bg-slate-950 border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40"
          disabled={isLoading}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-white/60">Max results</label>
          <input
            type="number"
            min={1}
            max={10}
            value={maxResults}
            onChange={(event) => setMaxResults(Number(event.target.value || 1))}
            className="mt-1 w-full rounded-lg bg-slate-950 border border-white/10 px-3 py-2 text-xs text-white"
            disabled={isLoading}
          />
        </div>
        <div>
          <label className="text-xs text-white/60">Time range</label>
          <select
            value={timeRange}
            onChange={(event) => setTimeRange(event.target.value)}
            className="mt-1 w-full rounded-lg bg-slate-950 border border-white/10 px-3 py-2 text-xs text-white"
            disabled={isLoading}
          >
            <option value="any">Any time</option>
            <option value="day">Past day</option>
            <option value="week">Past week</option>
            <option value="month">Past month</option>
            <option value="year">Past year</option>
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-white/60">
        <input
          type="checkbox"
          checked={snippetsOnly}
          onChange={(event) => setSnippetsOnly(event.target.checked)}
          className="w-4 h-4 rounded border-white/20 text-cyan-400 focus:ring-cyan-400"
          disabled={isLoading}
        />
        Return snippets only
      </label>
      <div className="flex items-center justify-between">
        {message && <span className="text-xs text-white/60">{message}</span>}
        <Button size="xs" className="self-start px-4" onClick={handleSave} disabled={isSaving || !configId}>
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </Card>
  );
}
