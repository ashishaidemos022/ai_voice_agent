import { Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { MarkdownContent } from '../ui/MarkdownContent';

type ToolExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed';

type ToolExecutionEvent = {
  id: string;
  toolName: string;
  status: ToolExecutionStatus;
  response?: Record<string, any> | null;
  error?: string | null;
};

type ToolSummary = {
  total: number;
  mcpCount: number;
  n8nCount: number;
  preview: Array<{
    name: string;
    source?: 'mcp' | 'n8n' | 'client';
  }>;
};

type ToolExecutionFeedProps = {
  events: ToolExecutionEvent[];
  toolSummary: ToolSummary;
  className?: string;
  emptyCopy?: string;
  headerCopy?: string;
};

type FormattedToolResult =
  | { kind: 'text'; value: string }
  | { kind: 'json'; value: string }
  | { kind: 'pairs'; value: Array<{ key: string; value: string }> };

const PREFERRED_RESULT_KEYS = ['result', 'output', 'response', 'content', 'message', 'text', 'answer', 'data'];

function toLabel(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function tryParseJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function formatPrimitive(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function formatToolResult(value: unknown, depth = 0): FormattedToolResult | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (depth > 4) {
    return { kind: 'json', value: JSON.stringify(value, null, 2) };
  }

  if (typeof value === 'string') {
    const parsed = tryParseJsonString(value);
    if (parsed !== null) {
      return formatToolResult(parsed, depth + 1);
    }
    return { kind: 'text', value };
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return { kind: 'text', value: String(value) };
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { kind: 'text', value: 'No results returned.' };
    }
    return { kind: 'json', value: JSON.stringify(value, null, 2) };
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;

    for (const key of PREFERRED_RESULT_KEYS) {
      if (record[key] !== undefined && record[key] !== null) {
        const nested = formatToolResult(record[key], depth + 1);
        if (nested) return nested;
      }
    }

    const entries = Object.entries(record);
    const primitiveEntries = entries.filter(([, entryValue]) => {
      return (
        entryValue === null ||
        ['string', 'number', 'boolean'].includes(typeof entryValue)
      );
    });

    if (entries.length > 0 && entries.length === primitiveEntries.length && entries.length <= 10) {
      return {
        kind: 'pairs',
        value: primitiveEntries.map(([key, entryValue]) => ({
          key: toLabel(key),
          value: formatPrimitive(entryValue)
        }))
      };
    }

    return { kind: 'json', value: JSON.stringify(record, null, 2) };
  }

  return { kind: 'text', value: String(value) };
}

function ResultBody({ result }: { result: FormattedToolResult }) {
  if (result.kind === 'pairs') {
    return (
      <dl className="grid gap-2">
        {result.value.map((entry) => (
          <div key={entry.key} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
            <dt className="text-[10px] uppercase tracking-[0.2em] text-white/45">{entry.key}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-white/88">{entry.value || '—'}</dd>
          </div>
        ))}
      </dl>
    );
  }

  if (result.kind === 'json') {
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-white/8 bg-black/25 px-3 py-3 text-xs leading-5 text-white/75">
        {result.value}
      </pre>
    );
  }

  return (
    <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-3">
      <MarkdownContent content={result.value} className="text-sm text-white/88" />
    </div>
  );
}

export function ToolExecutionFeed({
  events,
  toolSummary,
  className,
  emptyCopy = 'No tools called yet.',
  headerCopy = 'Every MCP + workflow call this session'
}: ToolExecutionFeedProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-white/10 bg-slate-900/60 p-5 text-slate-100 shadow-[0_10px_30px_rgba(3,6,15,0.45)] flex flex-col gap-4',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-pink-500 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-slate-950" />
        </div>
        <div>
          <p className="font-semibold text-white">Tool executions</p>
          <p className="text-xs text-white/50">{headerCopy}</p>
        </div>
      </div>

      <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
        {events.length === 0 ? (
          <p className="text-sm text-white/50">{emptyCopy}</p>
        ) : events.map((event) => {
          const result = formatToolResult(event.response);

          return (
            <div
              key={event.id}
              className={cn(
                'rounded-2xl border px-3 py-3',
                event.status === 'failed'
                  ? 'border-rose-400/40 bg-rose-500/10'
                  : event.status === 'succeeded'
                  ? 'border-emerald-400/40 bg-emerald-500/10'
                  : 'border-white/10 bg-white/5'
              )}
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold text-white/90">{event.toolName}</span>
                <span className="shrink-0 text-[11px] uppercase tracking-[0.2em] text-white/50">{event.status}</span>
              </div>

              {event.error && (
                <p className="mt-2 whitespace-pre-wrap break-words text-xs text-rose-200">{event.error}</p>
              )}

              {result && (
                <div className="mt-3 max-h-64 overflow-y-auto">
                  <ResultBody result={result} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-white/10 pt-3">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.3em] text-white/40">
          <span>Connected automations</span>
          <span>{toolSummary.total}</span>
        </div>
        {toolSummary.total === 0 ? (
          <p className="text-xs text-white/50 mt-2">No MCP or n8n tools configured for this preset.</p>
        ) : (
          <>
            <div className="flex gap-4 text-[11px] text-white/60 mt-3">
              <span>MCP: {toolSummary.mcpCount}</span>
              <span>n8n: {toolSummary.n8nCount}</span>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {toolSummary.preview.map((tool) => (
                <span
                  key={tool.name}
                  className={cn(
                    'px-2 py-1 rounded-full border text-[11px]',
                    tool.source === 'n8n'
                      ? 'border-amber-400/50 text-amber-200/90 bg-amber-500/10'
                      : 'border-white/10 text-white/70 bg-white/5'
                  )}
                >
                  {tool.name}
                </span>
              ))}
              {toolSummary.total > toolSummary.preview.length && (
                <span className="text-[11px] text-white/60">
                  +{toolSummary.total - toolSummary.preview.length} more
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
