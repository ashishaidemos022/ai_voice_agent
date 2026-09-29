import { cn } from '../../lib/utils';
import type { DimensionStatus, Gate, JudgeResult, RunScore } from '../../../shared/voice-eval/types';

const STATUS_STYLE: Record<DimensionStatus, string> = {
  pass: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100',
  warn: 'border-amber-300/40 bg-amber-500/10 text-amber-100',
  fail: 'border-rose-400/40 bg-rose-500/10 text-rose-100',
  no_data: 'border-white/10 bg-white/5 text-white/50',
  pending: 'border-cyan-300/30 bg-cyan-500/10 text-cyan-100'
};

function StatusChip({ status }: { status: DimensionStatus }) {
  return <span className={cn('rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em]', STATUS_STYLE[status])}>{status.replace('_', ' ')}</span>;
}

function GateRow({ gate }: { gate: Gate }) {
  const mark = gate.passed === true ? '✓' : gate.passed === false ? '✗' : '…';
  const tone = gate.passed === true ? 'text-emerald-200' : gate.passed === false ? 'text-rose-200' : 'text-white/40';
  return (
    <li className="flex gap-2 text-xs">
      <span className={cn('w-3 shrink-0 font-semibold', tone)}>{mark}</span>
      <span className="min-w-0">
        <span className="text-white/90">{gate.label}</span>
        <span className="block text-white/45">{gate.detail}</span>
      </span>
    </li>
  );
}

function ms(value: number | null) {
  return value === null ? '—' : `${Math.round(value)} ms`;
}

export function Scorecard({ score, judge }: { score: RunScore; judge?: JudgeResult | null }) {
  const taskGates = score.gates.filter((g) => g.id.startsWith('state.'));
  const otherGates = score.gates.filter((g) => !g.id.startsWith('state.'));
  const taskStatus: DimensionStatus = taskGates.some((g) => g.passed === false) ? 'fail' : taskGates.every((g) => g.passed === true) ? 'pass' : 'pending';
  const rows: { name: string; status: DimensionStatus; detail: string }[] = [
    { name: 'Task success (backend state)', status: taskStatus, detail: `${taskGates.filter((g) => g.passed === true).length}/${taskGates.length} state checks` },
    { name: 'Tool calls', status: score.tools.status, detail: `${Math.round(score.tools.score * 100)}% · ${score.tools.calledActions.join(' → ') || 'no calls yet'}` },
    { name: 'Latency', status: score.latency.status, detail: `p50 ${ms(score.latency.p50Ms)} · p95 ${ms(score.latency.p95Ms)} · ${score.latency.turnCount} turns` },
    { name: 'Entity accuracy', status: score.entities.status, detail: score.entities.entityWer === null ? 'waiting for caller speech' : `entity WER ${(score.entities.entityWer * 100).toFixed(0)}%` },
    { name: 'Turn-taking', status: score.turnTaking.status, detail: `barge-ins ${score.turnTaking.bargeIns.map((v) => `${v}ms`).join(', ') || '—'} · talk-over ${score.turnTaking.talkOverCount} · silence misses ${score.turnTaking.silenceViolations}` },
    { name: 'Safety & policy', status: score.safety.status, detail: score.safety.disclosureBeforeVerification ? 'disclosed before verification' : 'no early disclosure' }
  ];

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.name} className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">{row.name}</p>
              <p className="truncate text-[11px] text-white/50">{row.detail}</p>
            </div>
            <StatusChip status={row.status} />
          </li>
        ))}
      </ul>

      <div>
        <p className="mb-2 text-[11px] uppercase tracking-[0.3em] text-white/40">Gates</p>
        <ul className="flex flex-col gap-2">{[...taskGates, ...otherGates].map((gate) => <GateRow key={gate.id} gate={gate} />)}</ul>
      </div>

      {score.entities.entities.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-[0.3em] text-white/40">Entities</p>
          <ul className="grid grid-cols-1 gap-1 text-xs text-white/70">
            {score.entities.entities.map((entity) => (
              <li key={entity.fact} className="flex justify-between gap-2">
                <span>{entity.fact} <span className="text-white/40">({entity.expected})</span></span>
                <span>heard {entity.heardCorrectly === null ? '—' : entity.heardCorrectly ? '✓' : '✗'} · arg {entity.argCorrect === null ? '—' : entity.argCorrect ? '✓' : '✗'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {judge && (
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-[0.3em] text-white/40">Judge {judge.model ? `· ${judge.model}` : ''}</p>
          {judge.status !== 'ok' ? (
            <p className="text-xs text-amber-200">Judge {judge.status}: {judge.error}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-xs">
              {judge.items.map((item) => (
                <li key={item.item} className="rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2">
                  <p className="flex justify-between text-white/90"><span>{item.item}</span><span>{item.score}/2</span></p>
                  <p className="text-white/55">{item.verdict}</p>
                  {item.evidence.map((ev) => <p key={`${ev.turn}-${ev.quote}`} className="mt-1 border-l border-white/20 pl-2 text-white/45">[{ev.turn}] “{ev.quote}”</p>)}
                </li>
              ))}
              {judge.droppedDeductions > 0 && <li className="text-white/40">{judge.droppedDeductions} deduction(s) dropped for missing quotes</li>}
              {judge.missingItems && judge.missingItems.length > 0 && <li className="text-white/40">Not graded by judge: {judge.missingItems.join(', ')}</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
