import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RoutedVoiceControls } from '../../src/components/voice/RoutedVoiceControls';
import { AnswerSourcesPanel } from '../../src/components/chat/AnswerSourcesPanel';
import '../../src/index.css';

function Preview() {
  const [draft, setDraft] = useState('');
  const [capturing, setCapturing] = useState(false);
  return <main className="min-h-screen bg-slate-950 p-6 text-white">
    <p className="text-xs text-amber-200">Layout preview · no active session or microphone capture</p>
    <h1 className="my-5 text-2xl font-semibold">Routed Voice · Memory & sources</h1>
    <div className="grid gap-6 lg:grid-cols-2"><section className="rounded-2xl border border-white/10 p-5">
      <p className="mb-8 text-sm text-white/60">Choose your agent and customer, then start a voice session.</p>
      <RoutedVoiceControls agentId={null} busy={false} messages={[]} onSubmit={setDraft} onTranscript={setDraft} onCaptureState={setCapturing} />
      <textarea aria-label="Review transcript" value={draft} onChange={event => setDraft(event.target.value)} disabled={capturing} placeholder="Your transcript appears here for review" className="min-h-24 w-full rounded-xl bg-white/5 p-3 text-sm" />
    </section><AnswerSourcesPanel /></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Preview /></React.StrictMode>);
