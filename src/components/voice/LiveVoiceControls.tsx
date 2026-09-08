import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { createRoutedVoiceAdapter, type RoutedVoiceAdapter } from '../../lib/voice-adapters/routed-adapter';
import { LiveVoiceCoordinator } from '../../lib/live-voice-coordinator';
import { speechSegments } from '../../../shared/voice-speech';
import type { ChatMessage } from '../../types/chat';

type Props = { agentId: string | null; sessionId?: string; busy: boolean; messages: ChatMessage[]; onSubmit: (text: string) => void; onTranscript?: (text: string) => void };

type TranscriptionLogprob = { logprob?: number };

export function voiceTranscriptConfidence(logprobs?: TranscriptionLogprob[]): number | null {
  const values = (logprobs || [])
    .map(item => item.logprob)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return null;
  return Math.exp(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function shouldAcceptVoiceTranscript(text: string, logprobs?: TranscriptionLogprob[]): boolean {
  const words = text.trim().match(/[\p{L}\p{N}']+/gu) || [];
  if (!words.length) return false;
  const confidence = voiceTranscriptConfidence(logprobs);
  return !(words.length <= 2 && confidence !== null && confidence < 0.45);
}

export function LiveVoiceControls({ agentId, sessionId, busy, messages, onSubmit, onTranscript }: Props) {
  const [providerLabel, setProviderLabel] = useState('Saved voice provider');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [, setTranscript] = useState('');
  const [queued, setQueued] = useState('');
  const [muted, setMuted] = useState(false);
  const [transcriptionNotice, setTranscriptionNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const client = useRef<RoutedVoiceAdapter | null>(null);
  const coordinator = useRef<LiveVoiceCoordinator | null>(null);
  const generation = useRef(0);
  const segments = useRef<string[]>([]);
  const submit = useRef(onSubmit); submit.current = onSubmit;
  const publishTranscript = useRef(onTranscript); publishTranscript.current = onTranscript;
  const latest = [...messages].reverse().find(message => message.sender === 'assistant');
  const snapshot = useRef({ busy, latest }); snapshot.current = { busy, latest };

  const stop = useCallback(() => {
    generation.current++;
    segments.current = [];
    coordinator.current?.close(); coordinator.current = null;
    client.current?.disconnect(); client.current = null;
    setStatus('idle'); setTranscript(''); setQueued(''); setMuted(false); setTranscriptionNotice(''); publishTranscript.current?.('');
  }, []);

  useEffect(() => {
    if (!sessionId || !agentId) { stop(); return; }
    const token = ++generation.current;
    setStatus('connecting'); setError('');
    let timeout: ReturnType<typeof setTimeout>;
    const current = () => generation.current === token;
    void (async () => {
      try {
        const { adapter: transport, label, pcmOutput } = await createRoutedVoiceAdapter(agentId, sessionId);
        if (!current()) { transport.disconnect(); return; }
        setProviderLabel(label);
        client.current = transport;
        const nextSegment = () => { const next = segments.current.shift(); if (next && current()) transport.speakAnswer(next); };
        const flow = new LiveVoiceCoordinator({
          submit: text => { if (current()) { setTranscript(''); publishTranscript.current?.(''); setStatus('thinking'); submit.current(text); } },
          speak: text => { if (current()) { segments.current = speechSegments(text); setStatus('thinking'); nextSegment(); } },
          interrupt: () => { segments.current = []; transport.interruptSpeech(); },
          queued: text => { if (current()) setQueued(text); }
        }, snapshot.current.latest?.id);
        coordinator.current = flow;
        flow.sync(snapshot.current.busy);
        transport.on('speech.started', () => { if (current()) { flow.speechStarted(); setTranscript(''); setTranscriptionNotice(''); publishTranscript.current?.(''); setStatus('listening'); } });
        transport.on('speech.stopped', () => { if (current()) setStatus('thinking'); });
        transport.on('transcript.reset', event => {
          if (current() && event.role === 'user') {
            setTranscript('');
            publishTranscript.current?.('');
          }
        });
        transport.on('transcript.delta', event => {
          if (current() && event.role === 'user') setTranscript(value => {
            const next = value + event.delta;
            publishTranscript.current?.(next);
            return next;
          });
        });
        transport.on('transcript.done', event => {
          if (!current() || event.role !== 'user') return;
          const finalTranscript = event.transcript?.trim() || '';
          if (!shouldAcceptVoiceTranscript(finalTranscript, event.logprobs)) {
            setTranscript('');
            publishTranscript.current?.('');
            setTranscriptionNotice("I couldn't hear that clearly. Please repeat it.");
            setStatus('listening');
            return;
          }
          setTranscriptionNotice('');
          flow.transcript(finalTranscript, event.itemId || crypto.randomUUID());
        });
        transport.on('audio.delta', () => { if (current()) setStatus('speaking'); });
        transport.on('audio.done', () => { if (current() && pcmOutput && segments.current.length) nextSegment(); });
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
        if (current()) { setMuted(false); setStatus('listening'); }
      } catch (err) { if (current()) { stop(); setError(err instanceof Error ? err.message : 'Unable to connect live voice.'); } }
    })();
    return () => { clearTimeout(timeout); stop(); };
  }, [agentId, sessionId, attempt, stop]);

  useEffect(() => { coordinator.current?.sync(busy, latest); }, [busy, latest?.id]);

  const toggleMute = useCallback(async () => {
    const transport = client.current;
    if (!transport || status === 'idle' || status === 'connecting') return;
    if (muted) {
      await transport.startCapture();
      setMuted(false);
      setStatus('listening');
      return;
    }
    transport.stopCapture();
    setMuted(true);
    setStatus('muted');
    setTranscript('');
    publishTranscript.current?.('');
  }, [muted, status]);

  return <div className="mb-3 space-y-2 rounded-xl border border-cyan-300/30 bg-cyan-400/5 p-4">
    <div className="flex flex-wrap items-center gap-3">
      <span className={`h-3 w-3 rounded-full ${status === 'idle' ? 'bg-slate-500' : muted ? 'bg-rose-400' : 'bg-cyan-300 animate-pulse'}`} />
      <div className="min-w-0 flex-1">
        <p role="status" className="text-sm font-medium text-cyan-50">{!sessionId ? 'Start a voice session, then speak naturally.' : status === 'connecting' ? 'Connecting microphone…' : status === 'idle' ? 'Microphone disconnected' : muted ? 'Microphone muted · conversation remains connected' : status === 'speaking' ? 'Viaana is speaking · you can interrupt' : busy || status === 'thinking' ? 'Viaana is working · microphone is live' : 'Listening · speak naturally'}</p>
        <p className="mt-0.5 text-xs text-cyan-200/70">{providerLabel}</p>
      </div>
      {sessionId && status !== 'idle' && (
        <button type="button" aria-pressed={muted} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${muted ? 'border-rose-300/50 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30' : 'border-white/20 bg-white/5 text-white hover:bg-white/10'}`} onClick={() => void toggleMute()}>
          {muted ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          {muted ? 'Unmute' : 'Mute'}
        </button>
      )}
      {sessionId && status === 'idle' && <button type="button" className="rounded-lg border border-white/20 px-3 py-2 text-xs" onClick={() => setAttempt(value => value + 1)}>Reconnect microphone</button>}
    </div>
    {queued && <p className="text-xs text-cyan-100">Next question: {queued}</p>}
    {transcriptionNotice && <p role="status" className="rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">{transcriptionNotice}</p>}
    <p className="text-[11px] text-white/45">Live AI-generated voice. Speak to interrupt. Memory, routing, and tools use the selected agent and customer. Audio usage is additional to the routing receipt.</p>
    {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}
  </div>;
}
