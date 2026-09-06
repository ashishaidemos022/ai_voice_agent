import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnswerSourcesPanel as SourcePanel } from '../../src/components/chat/AnswerSourcesPanel';
import { WorkspaceSidePanels } from '../../src/components/layout/WorkspaceSidePanels';
import '../../src/index.css';

function AnswerSourcesPanel({ sources }: Parameters<typeof SourcePanel>[0]) {
  const [step, setStep] = useState('Idle');
  const turnId = 'preview-turn';
  const record = { id: 'preview-memory', user_id: '', agent_id: '', subject_id: '', kind: 'semantic' as const, memory_key: 'budget', title: 'Shoe budget', content: '$350', source_quote: 'Remember my budget', source_message_id: null, source_session_id: null, source: 'user' as const, happened_at: null, status: 'active' as const, version: 1, created_at: '', updated_at: '' };
  const events = ['Memory search', 'Memory returned', 'Memory updated'].includes(step) ? [{ id: 'search', session_id: '', turn_id: turnId, kind: 'search_requested', created_at: '', payload: {} }] : [];
  if (step === 'Memory returned' || step === 'Memory updated') events.push({ id: 'retrieved', session_id: '', turn_id: turnId, kind: 'retrieved', created_at: '', payload: { records: [record] } });
  if (step === 'Memory updated') events.push({ id: 'updated', session_id: '', turn_id: turnId, kind: 'updated', created_at: '', payload: { id: record.id, records: [{ ...record, version: 2, content: '$600' }] } });
  return <>
    <div className="mb-4 flex flex-wrap gap-2">{['Idle', 'Memory search', 'Memory returned', 'Memory updated', 'Reading guide', 'Checking catalog'].map(label => <button className="rounded-lg border border-white/20 px-3 py-2 text-xs" key={label} onClick={() => setStep(label)}>{label}</button>)}</div>
    <SourcePanel busy={true} sources={{ ...sources!, turnId, memoryEvents: events, ragStatus: step === 'Reading guide' ? 'searching' : 'skipped', rag: null, tools: step === 'Checking catalog' ? [{ ...sources!.carriedTools[0], status: 'running' }] : [] }} />
  </>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><main className="flex min-h-screen bg-slate-950 text-white">
  <div className="min-w-0 flex-1 p-6"><p className="mb-4 text-xs text-amber-200">Simulated data · source panel layout preview</p><AnswerSourcesPanel sources={{ question: 'Compare Forge Derby and Bastion Loafer for eight-hour comfort.', instructions: 'Explain fit risk. Use the product guide for construction and comfort. Direct customers to the storefront for checkout.', ragStatus: 'retrieved', rag: { question: '', answer: '', citations: [{ file_id: 'fixture', title: 'Product guide · sample passage', snippet: 'Example passage for inspecting the layout. This is simulated evidence.' }], vectorStoreIds: [], ragMode: 'assist', createdAt: new Date().toISOString() }, tools: [], carriedTools: [{ id: 'fixture', sessionId: 'fixture', toolName: 'execute_sql', status: 'succeeded', createdAt: new Date().toISOString(), request: { query: 'SELECT title, price_usd FROM shopify_products LIMIT 2' }, response: { rows: [{ title: 'Forge Derby', price_usd: 545 }, { title: 'Bastion Loafer', price_usd: 490 }] } }] }} /></div>
  <WorkspaceSidePanels toolsCount={1} historyCount={2} toolsContent={<p className="p-4">Supabase · execute_sql</p>} historyContent={<p className="p-4">Previous demo conversations</p>} />
</main></React.StrictMode>);
