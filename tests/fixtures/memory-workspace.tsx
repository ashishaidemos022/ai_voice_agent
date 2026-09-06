import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryPanel } from '../../src/components/chat/MemoryPanel';
import type { MemoryReceipt } from '../../shared/agent-memory';
import '../../src/index.css';

declare global { interface Window { memoryFixture: { agentId: string; subjectId: string; sessionId: string; receipt: MemoryReceipt } } }
function Preview() {
  const fixture = window.memoryFixture;
  const [subject, setSubject] = useState<string | null>(fixture.subjectId);
  const [receipt, setReceipt] = useState<MemoryReceipt | undefined>(fixture.receipt);
  return <main className="min-h-screen bg-slate-950 p-4 md:p-8 text-white">
    <div className="mx-auto max-w-6xl"><p className="text-xs uppercase tracking-widest text-amber-200 mb-3">UI test preview · simulated customer data</p>
      <h1 className="text-2xl font-semibold mb-6">Viaana AI · Agent memory</h1>
      <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
        <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-6">
          <div><p className="text-cyan-200 text-sm">New conversation · Alex</p><p className="mt-2 text-xs text-white/50">No earlier conversation messages included.</p></div>
          <div className="rounded-2xl bg-indigo-500 p-4 text-sm">What would you recommend for a full day on my feet?</div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3"><p className="text-xs text-white/45">ASSISTANT</p><p className="text-sm leading-relaxed">I’d look for US 10 wide options under $250, with a roomy toe box given your previous fit experience. I can check the current catalog for suitable options.</p><p className="text-xs text-cyan-200">Memory references: size · budget · previous experience</p></div>
          <p className="text-xs text-white/45">This fixture exercises the real Memory panel against an intercepted test API.</p>
        </section>
        <MemoryPanel agentId={fixture.agentId} subjectId={subject} onSubjectChange={id => { setSubject(id); setReceipt(undefined); }} sessionId={subject === fixture.subjectId ? fixture.sessionId : undefined} sessionActive={false} busy={false} receipt={receipt} />
      </div>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Preview /></React.StrictMode>);
