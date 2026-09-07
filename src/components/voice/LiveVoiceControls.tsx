import { useCallback, useEffect, useRef, useState } from 'react';
import { RealtimeAPIClient } from '../../lib/realtime-client';
import { LiveVoiceCoordinator } from '../../lib/live-voice-coordinator';
import { supabase } from '../../lib/supabase';
import { liveVoiceSession } from '../../../shared/live-voice';
import { speechSegments } from '../../../shared/voice-speech';
import type { ChatMessage } from '../../types/chat';

type Props = { agentId: string | null; sessionId?: string; busy: boolean; messages: ChatMessage[]; onSubmit: (text: string) => void };

export function LiveVoiceControls({ agentId, sessionId, busy, messages, onSubmit }: Props) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [queued, setQueued] = useState('');
  const [attempt, setAttempt] = useState(0);
  const client = useRef<RealtimeAPIClient | null>(null);
  const coordinator = useRef<LiveVoiceCoordinator | null>(null);
  const generation = useRef(0);
  const segments = useRef<string[]>([]);
  const submit = useRef(onSubmit); submit.current = onSubmit;
  const latest = [...messages].reverse().find(message => message.sender === 'assistant');
  const snapshot = useRef({ busy, latest }); snapshot.current = { busy, latest };

  const stop = useCallback(() => {
    generation.current++;
    segments.current = [];
    coordinator.current?.close(); coordinator.current = null;
    client.current?.disconnect(); client.current = null;
    setStatus('idle'); setTranscript(''); setQueued('');
  }, []);

  useEffect(() => {
    if (!sessionId || !agentId) { stop(); return; }
    const token = ++generation.current;
    setStatus('connecting'); setError('');
    let timeout: ReturnType<typeof setTimeout>;
    const current = () => generation.current === token;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!current()) return;
        if (!data.session) throw new Error('Sign in to start live voice.');
        const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/realtime-session`);
        url.searchParams.set('agent_id', agentId); url.searchParams.set('routed_session_id', sessionId);
        const session = liveVoiceSession();
        const transport = new RealtimeAPIClient({ model: session.model, voice: 'coral', instructions: session.instructions, temperature: 0.7, max_response_output_tokens: 4096 }, {
          routedVoice: true, tools: [], allowInterruptions: true,
          webrtc: { sessionUrl: url.toString(), headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } }
        });
        client.current = transport;
        const nextSegment = () => { const next = segments.current.shift(); if (next && current()) transport.speakAnswer(next); };
        const flow = new LiveVoiceCoordinator({
          submit: text => { if (current()) { setTranscript(''); setStatus('thinking'); submit.current(text); } },
          speak: text => { if (current()) { segments.current = speechSegments(text); setStatus('thinking'); nextSegment(); } },
          interrupt: () => { segments.current = []; transport.interruptSpeech(); },
          queued: text => { if (current()) setQueued(text); }
        }, snapshot.current.latest?.id);
        coordinator.current = flow;
        flow.sync(snapshot.current.busy);
        transport.on('speech.started', () => { if (current()) { flow.speechStarted(); setTranscript(''); setStatus('listening'); } });
        transport.on('speech.stopped', () => { if (current()) setStatus('thinking'); });
        transport.on('transcript.delta', event => { if (current() && event.role === 'user') setTranscript(value => value + event.delta); });
        transport.on('transcript.done', event => {
          if (current() && event.role === 'user') flow.transcript(event.transcript, event.itemId || crypto.randomUUID());
        });
        transport.on('provider.metrics', event => {
          if (!current()) return;
          if ('outputAudioBufferStarted' in event.metrics) setStatus('speaking');
          if ('outputAudioBufferDurationMs' in event.metrics) {
            if (segments.current.length) nextSegment(); else setStatus('listening');
          }
        });
        transport.on('error', event => { if (current()) { stop(); setError(event.error || 'Live voice failed. Reconnect to continue.'); } });
        transport.on('disconnected', () => { if (current()) { stop(); setError('Voice disconnected. Reconnect to continue.'); } });
        timeout = setTimeout(() => { if (current()) { stop(); setError('Live voice connection timed out. Please reconnect.'); } }, 20000);
        await transport.connect();
        clearTimeout(timeout);
        if (!current()) { transport.disconnect(); return; }
        await transport.startCapture();
        if (current()) setStatus('listening');
      } catch (err) { if (current()) { stop(); setError(err instanceof Error ? err.message : 'Unable to connect live voice.'); } }
    })();
    return () => { clearTimeout(timeout); stop(); };
  }, [agentId, sessionId, attempt, stop]);

  useEffect(() => { coordinator.current?.sync(busy, latest); }, [busy, latest?.id]);
  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [stop]);

  return <div className="mb-3 space-y-2 rounded-xl border border-cyan-300/30 bg-cyan-400/5 p-4">
    <div className="flex items-center gap-3">
      <span className={`h-3 w-3 rounded-full ${status === 'idle' ? 'bg-slate-500' : 'bg-cyan-300 animate-pulse'}`} />
      <p role="status" className="text-sm text-cyan-100">{!sessionId ? 'Start a voice session, then speak naturally.' : status === 'connecting' ? 'Connecting microphone…' : status === 'idle' ? 'Microphone off' : status === 'speaking' ? 'Speaking · you can interrupt' : busy || status === 'thinking' ? 'Agent is working · microphone is live' : 'Listening · speak naturally'}</p>
      {sessionId && <button type="button" className="ml-auto rounded-lg border border-white/20 px-3 py-2 text-xs" onClick={() => status === 'idle' ? setAttempt(value => value + 1) : stop()}>{status === 'idle' ? 'Reconnect microphone' : 'Stop microphone'}</button>}
    </div>
    {transcript && <p className="text-sm text-white/70">{transcript}</p>}
    {queued && <p className="text-xs text-cyan-100">Next question: {queued}</p>}
    <p className="text-[11px] text-white/45">Live AI-generated voice. Speak to interrupt. Memory, routing, and tools use the selected agent and customer. Audio usage is additional to the routing receipt.</p>
    {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}
  </div>;
}
