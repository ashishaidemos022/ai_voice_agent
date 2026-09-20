import { useEffect, useRef, useState } from 'react';
import { BrainCircuit, CalendarCheck2, Database, ShieldCheck, Sparkles, Stethoscope, X } from 'lucide-react';
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

function confidenceLabel(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${Math.round(parsed * 100)}%` : '—';
}

function HealthcareDecisionResult({ value }: { value: Record<string, any> }) {
  const decision = value.decision || {};
  const intent = decision.intent || {};
  const nextStep = decision.next_step || {};
  const review = decision.needs_human_review || {};
  const slots = Array.isArray(value.ehr?.eligible_slots) ? value.ehr.eligible_slots : [];
  const appointments = Array.isArray(value.ehr?.appointments) ? value.ehr.appointments : [];
  const referrals = Array.isArray(value.ehr?.referrals) ? value.ehr.referrals : [];
  const appointment = value.change?.appointment;
  const formatSlot = (slot: any) => {
    const date = new Date(slot.starts_at);
    return Number.isNaN(date.getTime())
      ? String(slot.starts_at || 'Unknown time')
      : new Intl.DateTimeFormat(undefined, {
          weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        }).format(date);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-cyan-300/20 bg-cyan-400/[0.06] p-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-cyan-100/55">
            <Stethoscope className="h-3.5 w-3.5" /> Jev intent
          </div>
          <p className="mt-2 text-sm font-semibold text-white">{String(intent.choice || 'Review')}</p>
          <p className="mt-1 text-[11px] text-white/50">Confidence {confidenceLabel(intent.confidence)}</p>
        </div>
        <div className="rounded-xl border border-violet-300/20 bg-violet-400/[0.06] p-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-violet-100/55">
            <ShieldCheck className="h-3.5 w-3.5" /> Applied action
          </div>
          <p className="mt-2 text-sm font-semibold text-white">{String(nextStep.applied || nextStep.choice || value.action?.next_step || 'Review')}</p>
          <p className="mt-1 text-[11px] text-white/50">Human review {Math.round(Number(review.noul || 0) * 100)}%</p>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-white/75">
          <Database className="h-4 w-4 text-emerald-300" /> Ashish_EHR evidence
        </div>
        <p className="mt-2 text-xs text-white/60">
          {value.verification?.verified
            ? `${appointments.length} upcoming appointment${appointments.length === 1 ? '' : 's'} · ${referrals.length} open referral${referrals.length === 1 ? '' : 's'}`
            : 'Identity verification is required before appointment details can be displayed'}
        </p>
        {slots.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {slots.slice(0, 3).map((slot: any) => (
              <div key={slot.slot_id} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.04] px-2.5 py-2 text-xs">
                <span className="text-white/75">{formatSlot(slot)}</span>
                <span className="text-white/40">{slot.provider?.first_name} {slot.provider?.last_name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {appointment && (
        <div className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-100">
            <CalendarCheck2 className="h-4 w-4" /> Appointment {String(value.change?.type || 'updated')}
          </div>
          <p className="mt-2 text-sm text-white">{formatSlot(appointment)}</p>
          <p className="mt-1 text-xs text-emerald-100/65">Confirmation {appointment.confirmation_number}</p>
        </div>
      )}

      <p className="text-[10px] leading-4 text-white/35">Identity-gated patient access · Jev decision support · connected EHR</p>
    </div>
  );
}

function HealthcareDecisionPopup({
  value,
  queuedCount,
  onClose
}: {
  value: Record<string, any>;
  queuedCount: number;
  onClose: () => void;
}) {
  const decision = value.decision || {};
  const intent = decision.intent || {};
  const nextStep = decision.next_step || {};
  const review = decision.needs_human_review || {};
  const applied = String(nextStep.applied || nextStep.choice || value.action?.next_step || 'review');
  const reason = String(decision.policy_reason || 'Jev evaluation complete');
  const verified = value.verification?.verified === true;

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center bg-slate-950/45 px-4 pt-[8vh] backdrop-blur-[2px] pointer-events-auto">
      <div
        role="status"
        aria-live="assertive"
        className="w-full max-w-xl overflow-hidden rounded-[28px] border border-cyan-300/35 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_38%),linear-gradient(145deg,rgba(8,20,35,0.98),rgba(15,23,42,0.98))] shadow-[0_30px_100px_rgba(6,182,212,0.24)]"
      >
        <div className="h-1 w-full bg-gradient-to-r from-cyan-300 via-violet-400 to-fuchsia-400" />
        <div className="p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-200/30 bg-cyan-300/10 shadow-[0_0_30px_rgba(34,211,238,0.2)]">
                <BrainCircuit className="h-6 w-6 text-cyan-200" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-cyan-200/70">Jev decision</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Patient-access policy evaluated</h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/5 p-2 text-white/55 transition hover:bg-white/10 hover:text-white"
              aria-label="Dismiss Jev decision"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-cyan-300/25 bg-cyan-300/[0.07] p-4">
              <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-100/55">Detected intent</p>
              <p className="mt-2 text-lg font-semibold text-white">{toLabel(String(intent.choice || 'review'))}</p>
              <p className="mt-1 text-xs text-white/50">Confidence {confidenceLabel(intent.confidence)}</p>
            </div>
            <div className="rounded-2xl border border-violet-300/25 bg-violet-300/[0.07] p-4">
              <p className="text-[10px] uppercase tracking-[0.22em] text-violet-100/55">Applied action</p>
              <p className="mt-2 text-lg font-semibold text-white">{toLabel(applied)}</p>
              <p className="mt-1 text-xs text-white/50">Human review {Math.round(Number(review.noul || 0) * 100)}%</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs">
            <span className={cn(
              'rounded-full border px-2.5 py-1 font-medium',
              verified
                ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100'
                : 'border-amber-300/30 bg-amber-300/10 text-amber-100'
            )}>
              {verified ? 'Identity verified' : 'Verification required'}
            </span>
            <span className="text-white/45">Policy reason</span>
            <span className="font-medium text-white/80">{toLabel(reason)}</span>
          </div>

          <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/10 pt-4">
            <p className="text-xs text-white/40">This decision is also saved in Tool executions.</p>
            <div className="flex items-center gap-3">
              {queuedCount > 0 && <span className="text-xs text-cyan-100/60">{queuedCount} more queued</span>}
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-white px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-cyan-100"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      </div>
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
  const initiallySeenIds = useRef(new Set(
    events
      .filter((event) => event.toolName === 'healthcare_patient_access' && event.status === 'succeeded' && event.response?.decision)
      .map((event) => event.id)
  ));
  const [decisionQueue, setDecisionQueue] = useState<Array<{ id: string; value: Record<string, any> }>>([]);
  const [activeDecision, setActiveDecision] = useState<{ id: string; value: Record<string, any> } | null>(null);

  useEffect(() => {
    const unseen = events.filter((event) => {
      const isDecision = event.toolName === 'healthcare_patient_access'
        && event.status === 'succeeded'
        && event.response
        && typeof event.response === 'object'
        && event.response.decision;
      if (!isDecision || initiallySeenIds.current.has(event.id)) return false;
      initiallySeenIds.current.add(event.id);
      return true;
    });
    if (unseen.length) {
      setDecisionQueue((current) => [
        ...current,
        ...unseen.map((event) => ({ id: event.id, value: event.response as Record<string, any> }))
      ]);
    }
  }, [events]);

  useEffect(() => {
    if (activeDecision || decisionQueue.length === 0) return;
    setActiveDecision(decisionQueue[0]);
    setDecisionQueue((current) => current.slice(1));
  }, [activeDecision, decisionQueue]);

  useEffect(() => {
    if (!activeDecision) return;
    const timer = window.setTimeout(() => setActiveDecision(null), 7000);
    return () => window.clearTimeout(timer);
  }, [activeDecision]);

  return (
    <>
      {activeDecision && (
        <HealthcareDecisionPopup
          value={activeDecision.value}
          queuedCount={decisionQueue.length}
          onClose={() => setActiveDecision(null)}
        />
      )}
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
          const healthcareResult = event.toolName === 'healthcare_patient_access' && event.response && typeof event.response === 'object'
            ? event.response
            : null;

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

              {healthcareResult ? (
                <div className="mt-3 max-h-96 overflow-y-auto">
                  <HealthcareDecisionResult value={healthcareResult} />
                </div>
              ) : result && (
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
    </>
  );
}
