import React from 'react';
import { createRoot } from 'react-dom/client';
import { AnswerSourcesPanel } from '../../src/components/chat/AnswerSourcesPanel';
import { WorkspaceSidePanels } from '../../src/components/layout/WorkspaceSidePanels';
import '../../src/index.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><main className="flex min-h-screen bg-slate-950 text-white">
  <div className="min-w-0 flex-1 p-6"><p className="mb-4 text-xs text-amber-200">Simulated data · source panel layout preview</p><AnswerSourcesPanel sources={{ question: 'Compare Forge Derby and Bastion Loafer for eight-hour comfort.', instructions: 'Explain fit risk. Use the product guide for construction and comfort. Direct customers to the storefront for checkout.', ragStatus: 'retrieved', rag: { question: '', answer: '', citations: [{ file_id: 'fixture', title: 'Product guide · sample passage', snippet: 'Example passage for inspecting the layout. This is simulated evidence.' }], vectorStoreIds: [], ragMode: 'assist', createdAt: new Date().toISOString() }, tools: [], carriedTools: [{ id: 'fixture', sessionId: 'fixture', toolName: 'execute_sql', status: 'succeeded', createdAt: new Date().toISOString(), request: { query: 'SELECT title, price_usd FROM shopify_products LIMIT 2' }, response: { rows: [{ title: 'Forge Derby', price_usd: 545 }, { title: 'Bastion Loafer', price_usd: 490 }] } }] }} /></div>
  <WorkspaceSidePanels toolsCount={1} historyCount={2} toolsContent={<p className="p-4">Supabase · execute_sql</p>} historyContent={<p className="p-4">Previous demo conversations</p>} />
</main></React.StrictMode>);
