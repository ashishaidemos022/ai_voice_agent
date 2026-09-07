import { useCallback, useEffect, useRef, useState } from 'react';
import { VoiceAudioUsage } from './VoiceAudioUsage';
import { Mic, Square, VolumeX } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { ChatMessage } from '../../types/chat';
import { ROUTED_VOICES, VOICE_AUDIO_LIMIT, speechSegments, SpeechGate } from '../../../shared/voice-speech';

type Props = { agentId: string | null; sessionId?: string; busy: boolean; messages: ChatMessage[]; onTranscript: (text: string) => void; onSubmit?: (text: string) => void; onCaptureState: (active: boolean) => void };

export function RoutedVoiceControls({ agentId, sessionId, busy, messages, onTranscript, onSubmit, onCaptureState }: Props) {
  const [state, setRenderState] = useState<'idle' | 'permission' | 'recording' | 'transcribing' | 'speaking' | 'preparing'>('idle');
  const stateRef = useRef(state);
  const setState = useCallback((value: typeof state) => { stateRef.current = value; setRenderState(value); }, []);
  const [error, setError] = useState('');
  const [voice, setVoice] = useState('coral');
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [continuous, setContinuous] = useState(false);
  const [queued, setQueued] = useState('');
  const continuousRef = useRef(false);
  const busyRef = useRef(busy); busyRef.current = busy;
  const pending = useRef('');
  const analyserTimer = useRef<ReturnType<typeof setInterval>>();
  const context = useRef<AudioContext | null>(null);
  const settlePlayback = useRef<(() => void) | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const lastSpoken = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const releaseAudio = useCallback(() => {
    audio.current?.pause(); audio.current = null;
    settlePlayback.current?.(); settlePlayback.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  }, []);
  const cancel = useCallback(() => {
    generation.current++;
    request.current?.abort(); request.current = null;
    clearTimeout(timer.current);
    clearInterval(analyserTimer.current);
    void context.current?.close(); context.current = null;
    if (recorder.current) { recorder.current.onstop = null; if (recorder.current.state !== 'inactive') recorder.current.stop(); }
    recorder.current = null;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    releaseAudio();
    onCaptureState(false); setState('idle');
  }, [onCaptureState, releaseAudio, setState]);
  const stop = useCallback(() => {
    continuousRef.current = false; setContinuous(false); pending.current = ''; setQueued(''); cancel();
  }, [cancel]);
  useEffect(() => { stop(); lastSpoken.current = null; setError(''); return stop; }, [sessionId, agentId, stop]);
  useEffect(() => { if (busy && ['speaking', 'preparing'].includes(stateRef.current)) cancel(); }, [busy, cancel]);

  async function invoke(action: string, extra: Record<string, string | Blob>, signal: AbortSignal) {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error('Sign in to use voice.');
    const form = new FormData();
    form.set('action', action); form.set('agent_id', agentId || ''); form.set('session_id', sessionId || '');
    for (const [key, value] of Object.entries(extra)) form.set(key, value);
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-audio`, { method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY }, body: form, signal });
    return response;
  }

  async function speak(message: ChatMessage) {
    cancel(); setError(''); setState('preparing');
    const token = generation.current;
    const controller = new AbortController(); request.current = controller;
    try {
      const segments = speechSegments(message.content);
      for (let segment = 0; segment < segments.length; segment++) {
        if (token !== generation.current) return;
        let response = await invoke('speak', { turn_id: message.raw?.sources?.turnId || '', voice, segment: String(segment) }, controller.signal);
        // The text appears immediately; its database insert may still be finishing.
        for (let attempt = 0; response.status === 404 && attempt < 3; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          if (controller.signal.aborted) return;
          response = await invoke('speak', { turn_id: message.raw?.sources?.turnId || '', voice, segment: String(segment) }, controller.signal);
        }
        if (!response.ok) throw new Error((await response.json()).error || 'Speech unavailable.');
        const blob = await response.blob();
        if (token !== generation.current) return;
        url.current = URL.createObjectURL(blob); audio.current = new Audio(url.current);
        const finished = new Promise<void>((resolve, reject) => {
          settlePlayback.current = resolve;
          audio.current!.onended = () => resolve();
          audio.current!.onerror = () => reject(new Error('Audio playback failed. Use Read latest answer to retry.'));
        });
        setState('speaking');
        // Attach the rejection handler before starting playback.
        await Promise.all([audio.current.play(), finished]);
        if (token !== generation.current) return;
        releaseAudio();
      }
      setState('idle');
    } catch (err) {
      if (token !== generation.current) return;
      stop(); setError(err instanceof Error ? err.message : 'Speech failed.');
    }
  }
  const latest = [...messages].reverse().find(message => message.sender === 'assistant');
  const speakRef = useRef(speak); speakRef.current = speak;
  useEffect(() => {
    if (!latest || !sessionId || busy || ['recording', 'permission', 'transcribing'].includes(stateRef.current)) return;
    if (lastSpoken.current === latest.id) return;
    lastSpoken.current = latest.id;
    if (autoSpeak && !pending.current) void speakRef.current(latest);
  }, [latest?.id, busy, sessionId, autoSpeak, state]);

  const submitRef = useRef(onSubmit); submitRef.current = onSubmit;
  useEffect(() => {
    if (!busy && pending.current) {
      const text = pending.current; pending.current = ''; setQueued('');
      submitRef.current?.(text);
    }
  }, [busy]);

  async function record() {
    if (!sessionId || pending.current || ['recording', 'permission', 'transcribing'].includes(stateRef.current)) return;
    cancel(); setError(''); setState('permission'); onCaptureState(true);
    const token = generation.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone recording requires a supported browser on HTTPS or localhost.');
      const capture = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (token !== generation.current) { capture.getTracks().forEach(track => track.stop()); return; }
      stream.current = capture;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('This browser does not support a compatible recording format.');
      const media = new MediaRecorder(capture, { mimeType }); recorder.current = media;
      const recordedAt = performance.now();
      const chunks: Blob[] = []; let bytes = 0;
      media.ondataavailable = event => { chunks.push(event.data); bytes += event.data.size; if (bytes > VOICE_AUDIO_LIMIT && media.state !== 'inactive') media.stop(); };
      media.onerror = () => { if (token === generation.current) { stop(); setError('Microphone recording failed.'); } };
      media.onstop = async () => {
        capture.getTracks().forEach(track => track.stop());
        if (token !== generation.current) return;
        clearTimeout(timer.current); stream.current = null; recorder.current = null;
        clearInterval(analyserTimer.current); void context.current?.close(); context.current = null;
        setState('transcribing'); const controller = new AbortController(); request.current = controller;
        try {
          if (!bytes || bytes > VOICE_AUDIO_LIMIT) throw new Error('Please record a shorter message (up to 10 MB).');
          const response = await invoke('transcribe', { audio: new Blob(chunks, { type: mimeType }), duration_seconds: String(Math.min(65, (performance.now() - recordedAt) / 1000)) }, controller.signal);
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Transcription failed.');
          if (token !== generation.current) return;
          if (!result.text?.trim()) throw new Error('No speech detected. Please try again.');
          const text = result.text.trim();
          if (continuousRef.current && submitRef.current) {
            if (busyRef.current) { pending.current = text; setQueued(text); }
            else submitRef.current(text);
          } else onTranscript(text);
        } catch (err) { if (token === generation.current) { stop(); setError(err instanceof Error ? err.message : 'Transcription failed.'); } }
        finally { if (token === generation.current) { setState('idle'); onCaptureState(false); } }
      };
      media.start(250); setState('recording');
      if (continuousRef.current) {
        const ctx = new AudioContext(); context.current = ctx;
        await ctx.resume();
        if (token !== generation.current) { void ctx.close(); return; }
        const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
        ctx.createMediaStreamSource(capture).connect(analyser);
        const samples = new Float32Array(analyser.fftSize); const gate = new SpeechGate();
        analyserTimer.current = setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
          const outcome = gate.sample(rms, performance.now());
          if (outcome === 'submit' && media.state === 'recording') media.stop();
          if (outcome === 'timeout') { stop(); setError('Listening paused after a minute without speech.'); }
        }, 50);
      }
      timer.current = setTimeout(() => {
        if (continuousRef.current) { stop(); setError('Recording reached one minute. Please ask a shorter question.'); }
        else if (media.state === 'recording') media.stop();
      }, 60000);
    } catch (err) { if (token === generation.current) { stop(); setError(err instanceof Error ? err.message : 'Microphone unavailable.'); } }
  }
  const recordRef = useRef(record); recordRef.current = record;
  useEffect(() => {
    if (!continuous || !sessionId || busy || state !== 'idle' || queued) return;
    const next = setTimeout(() => {
      if (continuousRef.current && !busyRef.current && stateRef.current === 'idle') void recordRef.current();
    }, 400);
    return () => clearTimeout(next);
  }, [continuous, sessionId, busy, state, queued]);
  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [stop]);
  return <div className="mb-3 space-y-2 rounded-xl border border-cyan-300/25 bg-cyan-400/5 p-3">
    <div className="flex flex-wrap items-center gap-2">
      {onSubmit && <button type="button" disabled={!sessionId} onClick={() => { if (continuous) stop(); else { continuousRef.current = true; setContinuous(true); void record(); } }} className="rounded-lg border border-cyan-200/40 px-3 py-2 text-xs disabled:opacity-40">{continuous ? 'Pause conversation' : 'Start conversation'}</button>}
      <button type="button" disabled={!sessionId || !!queued || state === 'permission' || state === 'transcribing'} onClick={() => state === 'recording' ? recorder.current?.stop() : void record()} className="rounded-lg bg-cyan-300 px-3 py-2 text-xs font-medium text-slate-950 disabled:opacity-40">
        {state === 'recording' ? <><Square className="mr-1 inline h-3 w-3" />Finish question</> : <><Mic className="mr-1 inline h-3 w-3" />{state === 'speaking' || state === 'preparing' ? 'Interrupt & speak' : 'Record question'}</>}
      </button>
      {state !== 'idle' && <button type="button" onClick={stop} className="rounded-lg border border-white/20 px-3 py-2 text-xs"><VolumeX className="mr-1 inline h-3 w-3" />{state === 'speaking' || state === 'preparing' ? 'Stop audio' : 'Cancel recording'}</button>}
      <select aria-label="Spoken voice" value={voice} onChange={event => setVoice(event.target.value)} disabled={state !== 'idle'} className="rounded-lg bg-slate-900 p-2 text-xs">{ROUTED_VOICES.map(name => <option key={name}>{name}</option>)}</select>
      <label className="text-xs"><input type="checkbox" checked={autoSpeak} onChange={event => { setAutoSpeak(event.target.checked); if (!event.target.checked && ['speaking', 'preparing'].includes(state)) cancel(); }} /> Speak answers</label>
      {latest && <button type="button" disabled={busy || state !== 'idle'} onClick={() => void speak(latest)} className="text-xs text-cyan-200 underline disabled:opacity-40">Read latest answer</button>}
    </div>
    <p role="status" className="text-xs text-cyan-100">{state === 'idle' ? busy ? 'Agent is working… You can record the next question.' : continuous ? 'Conversation active. Listening resumes after each answer.' : 'Record and review, or Start conversation to send speech automatically after a pause.' : state === 'recording' ? 'Listening…' : state === 'transcribing' ? 'Transcribing…' : state === 'preparing' ? 'Preparing speech…' : state === 'speaking' ? 'Speaking…' : 'Waiting for microphone permission…'}</p>
    <p className="text-[11px] text-white/45">AI-generated voice. Routing costs below exclude transcription and speech generation.</p>
    <VoiceAudioUsage sessionId={sessionId} refresh={state} />
    {queued && <p className="text-xs text-amber-200">Next question: {queued} — waiting for the current tool/answer to finish. <button onClick={() => { pending.current = ''; setQueued(''); }} className="underline">Discard</button></p>}
    {continuous && <p className="text-[11px] text-white/45">Speech sends automatically after one second of silence. Interrupt & speak stops playback; running tools finish before your next question. The microphone pauses during answers.</p>}
    {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}
  </div>;
}
