import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, ArrowRight, Headphones, Languages, Loader2, Mic, MicOff, PhoneOff, Play, ShieldCheck, Volume2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { listElevenLabsVoices, type ElevenLabsVoiceSummary } from '../../lib/elevenlabs-agent';
import {
  PcmPlayer,
  requestTranslationToken,
  TranslationMic,
  TranslationStream,
  type TranslationStreamState
} from '../../lib/realtime-translation-client';
import {
  isTranslationError,
  languageLabel,
  TRANSLATION_EAGERNESS,
  TRANSLATION_LANGUAGES,
  TRANSLATION_TTS_MODELS,
  type TranslationEagerness,
  type TranslationServerMessage,
  type TranslationTtsModel
} from '../../../shared/realtime-translation';
import { cn } from '../../lib/utils';
import { MainLayout } from '../layout/MainLayout';
import { Sidebar } from '../layout/Sidebar';
import { Button } from '../ui/Button';

type Side = 'a' | 'b';
const OTHER: Record<Side, Side> = { a: 'b', b: 'a' };

type Participant = { name: string; language: string; voiceId: string };

type Turn = {
  id: string;
  speaker: Side;
  finals: string[];
  partial: string;
  translation: string[];
  onsetAt: number | null;
  firstAudioMs: number | null;
  firstTextMs: number | null;
};

type StreamStatus = { state: TranslationStreamState; detail?: string };

type LiveTranslationProps = {
  onNavigateVoice: () => void;
  onNavigateChat?: () => void;
  onNavigateVoiceLab?: () => void;
  onNavigateOpenWeightLab?: () => void;
  onOpenCreateAgent?: () => void;
  onOpenSkills?: () => void;
  onOpenKnowledgeBase?: () => void;
  onOpenUsage?: () => void;
  onOpenEmbedUsage?: () => void;
};

const SPEECH_ONSET_LEVEL = 0.06;
const SETTINGS_KEY = 'viaana.liveTranslation.v1';

function loadSaved(): Partial<{ a: Participant; b: Participant; model: TranslationTtsModel; eagerness: TranslationEagerness; zrm: boolean; echoGuard: boolean }> {
  try {
    return JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}

function newSessionId() {
  return `tr_${crypto.randomUUID().replace(/-/g, '')}`;
}

function StatusDot({ status }: { status: StreamStatus }) {
  const tone = status.state === 'live' ? 'bg-emerald-400' : status.state === 'connecting' ? 'bg-amber-300 animate-pulse'
    : status.state === 'error' ? 'bg-rose-400' : 'bg-slate-500';
  const label = status.state === 'live' ? 'Live' : status.state === 'connecting' ? 'Connecting' : status.state === 'error' ? 'Error' : status.state === 'closed' ? 'Closed' : 'Idle';
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-white/50" title={status.detail}>
      <span className={cn('w-2 h-2 rounded-full', tone)} /> {label}
    </span>
  );
}

export function LiveTranslation(props: LiveTranslationProps) {
  const { vaUser, providerKeys, signOut } = useAuth();
  const elevenLabsKeys = useMemo(() => providerKeys.filter((key) => key.provider === 'elevenlabs'), [providerKeys]);
  const saved = useMemo(loadSaved, []);

  const [keyId, setKeyId] = useState<string | null>(null);
  const [voices, setVoices] = useState<ElevenLabsVoiceSummary[]>([]);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Record<Side, Participant>>({
    a: saved.a ?? { name: 'Person A', language: 'en', voiceId: '' },
    b: saved.b ?? { name: 'Person B', language: 'es', voiceId: '' }
  });
  const [model, setModel] = useState<TranslationTtsModel>(saved.model ?? 'eleven_v4_turbo');
  const [eagerness, setEagerness] = useState<TranslationEagerness>(saved.eagerness ?? 'medium');
  const [zrm, setZrm] = useState(saved.zrm ?? false);
  const [echoGuard, setEchoGuard] = useState(saved.echoGuard ?? false);

  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Side | null>(null);
  const [status, setStatus] = useState<Record<Side, StreamStatus>>({ a: { state: 'idle' }, b: { state: 'idle' } });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [muting, setMuting] = useState(false);

  const streamsRef = useRef<Partial<Record<Side, TranslationStream>>>({});
  const micRef = useRef<TranslationMic | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const activeRef = useRef<Side | null>(null);
  const echoGuardRef = useRef(echoGuard);
  const onsetMarkedRef = useRef<string | null>(null);
  const lastLevelRef = useRef(0);
  const currentTurnRef = useRef<Partial<Record<Side, string>>>({});
  const turnsEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { echoGuardRef.current = echoGuard; }, [echoGuard]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ a: participants.a, b: participants.b, model, eagerness, zrm, echoGuard }));
    } catch {
      // storage unavailable; settings just won't persist
    }
  }, [participants, model, eagerness, zrm, echoGuard]);

  useEffect(() => {
    if (!keyId && elevenLabsKeys.length) setKeyId(elevenLabsKeys[0].id);
  }, [elevenLabsKeys, keyId]);

  useEffect(() => {
    if (!keyId) return;
    let cancelled = false;
    setVoicesError(null);
    listElevenLabsVoices(keyId)
      .then((list) => {
        if (cancelled) return;
        setVoices(list);
        setParticipants((current) => {
          const ids = new Set(list.map((voice) => voice.voice_id));
          const pick = (preferred: string, fallbackIndex: number) =>
            preferred && ids.has(preferred) ? preferred : list[Math.min(fallbackIndex, list.length - 1)]?.voice_id ?? '';
          return { a: { ...current.a, voiceId: pick(current.a.voiceId, 0) }, b: { ...current.b, voiceId: pick(current.b.voiceId, 1) } };
        });
      })
      .catch((err) => !cancelled && setVoicesError(err instanceof Error ? err.message : 'Unable to load voices'));
    return () => { cancelled = true; };
  }, [keyId]);

  useEffect(() => {
    turnsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  const updateTurn = useCallback((side: Side, update: (turn: Turn) => Turn) => {
    const id = currentTurnRef.current[side];
    if (!id) return;
    setTurns((list) => list.map((turn) => (turn.id === id ? update(turn) : turn)));
  }, []);

  const startTurn = useCallback((side: Side) => {
    const id = crypto.randomUUID();
    currentTurnRef.current[side] = id;
    setTurns((list) => [...list, { id, speaker: side, finals: [], partial: '', translation: [], onsetAt: null, firstAudioMs: null, firstTextMs: null }]);
  }, []);

  const handleMessage = useCallback((side: Side, message: TranslationServerMessage) => {
    const now = performance.now();
    switch (message.message_type) {
      case 'partial_transcript':
        updateTurn(side, (turn) => ({ ...turn, partial: message.text }));
        break;
      case 'final_transcript':
        if (message.text.trim()) updateTurn(side, (turn) => ({ ...turn, finals: [...turn.finals, message.text.trim()], partial: '' }));
        break;
      case 'translation':
        if (message.text.trim()) {
          updateTurn(side, (turn) => ({
            ...turn,
            translation: [...turn.translation, message.text.trim()],
            firstTextMs: turn.firstTextMs ?? (turn.onsetAt ? Math.round(now - turn.onsetAt) : null)
          }));
        }
        break;
      case 'audio':
        playerRef.current?.enqueue(message.data, message.sample_rate);
        updateTurn(side, (turn) => turn.firstAudioMs !== null || !turn.onsetAt ? turn : { ...turn, firstAudioMs: Math.round(now - turn.onsetAt) });
        break;
      default:
        if (isTranslationError(message)) {
          setStatus((current) => ({ ...current, [side]: { ...current[side], detail: message.error } }));
          setError(`${side === 'a' ? participants.a.name : participants.b.name} → ${message.message_type}: ${message.error}`);
        }
    }
  }, [participants.a.name, participants.b.name, updateTurn]);

  const handleMessageRef = useRef(handleMessage);
  useEffect(() => { handleMessageRef.current = handleMessage; }, [handleMessage]);

  const stopAll = useCallback(async () => {
    activeRef.current = null;
    setActive(null);
    setRunning(false);
    (['a', 'b'] as Side[]).forEach((side) => streamsRef.current[side]?.close());
    streamsRef.current = {};
    await micRef.current?.stop();
    micRef.current = null;
    await playerRef.current?.close();
    playerRef.current = null;
    setMicLevel(0);
  }, []);

  useEffect(() => () => { void stopAll(); }, [stopAll]);

  // Mic level meter + speech-onset detection for latency measurement.
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const tick = () => {
      const level = micRef.current?.level() ?? 0;
      if (Math.abs(level - lastLevelRef.current) > 0.03) {
        lastLevelRef.current = level;
        setMicLevel(level);
      }
      const side = activeRef.current;
      const turnId = side ? currentTurnRef.current[side] : undefined;
      if (side && turnId && onsetMarkedRef.current !== turnId && level > SPEECH_ONSET_LEVEL) {
        onsetMarkedRef.current = turnId;
        const onset = performance.now();
        updateTurn(side, (turn) => (turn.onsetAt ? turn : { ...turn, onsetAt: onset }));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, updateTurn]);

  const createStream = useCallback((side: Side, sessionId: string) => {
    const speaker = participants[side];
    const listener = participants[OTHER[side]];
    return new TranslationStream(
      () => requestTranslationToken({
        providerKeyId: keyId,
        sessionId: `${sessionId}_${side}`,
        config: {
          target_language: listener.language,
          source_language: speaker.language,
          voice_id: speaker.voiceId,
          tts_model_id: model,
          eagerness,
          enable_zrm: zrm
        }
      }),
      {
        onState: (state, detail) => setStatus((current) => ({ ...current, [side]: { state, detail } })),
        onMessage: (message) => handleMessageRef.current(side, message)
      }
    );
  }, [eagerness, keyId, model, participants, zrm]);

  const start = async () => {
    setError(null);
    if (participants.a.language === participants.b.language) {
      setError('Pick two different languages.');
      return;
    }
    if (!participants.a.voiceId || !participants.b.voiceId) {
      setError('Pick a voice for each person.');
      return;
    }
    setStarting(true);
    try {
      const player = new PcmPlayer();
      await player.resume();
      playerRef.current = player;
      const mic = new TranslationMic();
      await mic.start((frame) => {
        const side = activeRef.current;
        if (!side) return;
        const stream = streamsRef.current[side];
        if (!stream) return;
        // Echo guard: never feed translated playback back into the mic (half-duplex).
        const silenced = echoGuardRef.current && playerRef.current?.isPlaying();
        stream.pushPcm(silenced ? new Int16Array(frame.length) : frame);
      });
      micRef.current = mic;
      const sessionId = newSessionId();
      streamsRef.current = { a: createStream('a', sessionId), b: createStream('b', sessionId) };
      await Promise.all([streamsRef.current.a!.connect(), streamsRef.current.b!.connect()]);
      setTurns([]);
      setRunning(true);
    } catch (err) {
      await stopAll();
      const message = err instanceof Error ? err.message : 'Unable to start';
      setError(/Permission|NotAllowed/i.test(message) ? 'Microphone permission denied.' : message);
    } finally {
      setStarting(false);
    }
  };

  const setSpeaker = useCallback((next: Side | null) => {
    const previous = activeRef.current;
    if (previous === next) next = null;
    if (previous) streamsRef.current[previous]?.flushWithSilence();
    activeRef.current = next;
    setActive(next);
    if (!next) return;
    const stream = streamsRef.current[next];
    if (stream && (stream.state === 'closed' || stream.state === 'error') && !stream.fatal) void stream.connect();
    startTurn(next);
  }, [startTurn]);

  useEffect(() => {
    if (!running) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === '1') setSpeaker('a');
      else if (event.key === '2') setSpeaker('b');
      else if (event.key === 'Escape') setSpeaker(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, setSpeaker]);

  const swapLanguages = () => setParticipants((current) => ({
    a: { ...current.a, language: current.b.language },
    b: { ...current.b, language: current.a.language }
  }));

  const stopPlayback = () => {
    setMuting(true);
    playerRef.current?.stop();
    window.setTimeout(() => setMuting(false), 300);
  };

  const sidebar = (
    <Sidebar
      activeNav="translation"
      onNavigateVoice={props.onNavigateVoice}
      onNavigateChat={props.onNavigateChat}
      onNavigateVoiceLab={props.onNavigateVoiceLab}
      onNavigateOpenWeightLab={props.onNavigateOpenWeightLab}
      onNavigateTranslation={() => undefined}
      onNavigateSkills={props.onOpenSkills}
      onOpenKnowledgeBase={props.onOpenKnowledgeBase}
      onOpenUsage={props.onOpenUsage}
      onOpenEmbedUsage={props.onOpenEmbedUsage}
      onOpenSettings={props.onOpenCreateAgent}
    />
  );

  const topBar = (
    <header className="h-16 border-b border-white/10 bg-slate-950/60 px-6 flex items-center justify-between">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-white/40">
        <span>Agent Workspace</span>
        <ArrowRight className="w-3 h-3" />
        <span className="text-teal-200">Live Translation</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden md:block text-sm text-white/60">{vaUser?.email}</span>
        <Button variant="outline" size="sm" onClick={signOut} className="border-white/20 text-white/80">Sign out</Button>
      </div>
    </header>
  );

  const selectClass = 'w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-300/60 disabled:opacity-60';

  const participantCard = (side: Side) => {
    const person = participants[side];
    const listener = participants[OTHER[side]];
    const isActive = active === side;
    return (
      <div className={cn('rounded-2xl border p-5 space-y-4 transition-colors', isActive ? 'border-teal-300/60 bg-teal-400/10' : 'border-white/10 bg-slate-950/50')}>
        <div className="flex items-center justify-between gap-3">
          <input
            value={person.name}
            disabled={running}
            onChange={(event) => setParticipants((current) => ({ ...current, [side]: { ...current[side], name: event.target.value } }))}
            className="bg-transparent text-lg font-semibold text-white focus:outline-none border-b border-transparent focus:border-white/20 min-w-0"
            aria-label={`Name for ${side === 'a' ? 'first' : 'second'} person`}
          />
          {running && <StatusDot status={status[side]} />}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-white/50">Speaks</span>
            <select
              className={selectClass}
              disabled={running}
              value={person.language}
              onChange={(event) => setParticipants((current) => ({ ...current, [side]: { ...current[side], language: event.target.value } }))}
            >
              {TRANSLATION_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-white/50">Heard by {listener.name} in voice</span>
            <select
              className={selectClass}
              disabled={running || voices.length === 0}
              value={person.voiceId}
              onChange={(event) => setParticipants((current) => ({ ...current, [side]: { ...current[side], voiceId: event.target.value } }))}
            >
              {voices.length === 0 && <option value="">{voicesError ? 'Voices unavailable' : 'Loading voices…'}</option>}
              {voices.map((voice) => <option key={voice.voice_id} value={voice.voice_id}>{voice.name}{voice.category ? ` · ${voice.category}` : ''}</option>)}
            </select>
          </label>
        </div>
        {running && (
          <button
            type="button"
            onClick={() => setSpeaker(side)}
            className={cn(
              'w-full rounded-xl py-4 flex items-center justify-center gap-3 font-semibold transition-all',
              isActive ? 'bg-teal-300 text-slate-950 shadow-[0_0_30px_rgba(94,234,212,0.35)]' : 'bg-white/5 text-white/80 hover:bg-white/10'
            )}
          >
            {isActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            {isActive ? `${person.name} is speaking — tap to stop` : `Tap for ${person.name} to speak`}
            <kbd className="ml-1 rounded border border-current/30 px-1.5 text-xs opacity-60">{side === 'a' ? '1' : '2'}</kbd>
          </button>
        )}
        {isActive && (
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden" aria-hidden>
            <div className="h-full bg-teal-300 transition-[width] duration-75" style={{ width: `${Math.round(micLevel * 100)}%` }} />
          </div>
        )}
        <p className="text-xs text-white/40">
          {languageLabel(person.language)} → {languageLabel(listener.language)}
        </p>
      </div>
    );
  };

  return (
    <MainLayout sidebar={sidebar} topBar={topBar}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6 lg:p-8 space-y-6">
          <section className="rounded-3xl border border-teal-300/20 bg-gradient-to-br from-teal-500/15 via-slate-950/80 to-cyan-500/10 p-6">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[.3em] text-teal-200">
              <Languages className="w-4 h-4" /> Eleven Realtime Translation · alpha
            </div>
            <h2 className="mt-3 text-3xl font-semibold font-display text-white">Live conversation translation</h2>
            <p className="text-white/55 mt-2 max-w-3xl">
              Each person speaks their own language and hears the other in theirs, in a natural voice. Take turns on one device:
              tap your side (or press 1 / 2) and talk. Translation starts while you are still speaking.
            </p>
          </section>

          {elevenLabsKeys.length === 0 && (
            <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm text-amber-100 flex gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              Add an ElevenLabs API key under Create Agent → provider keys. Realtime Translation is currently limited to ElevenLabs enterprise workspaces.
            </div>
          )}

          <section className="grid lg:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
            {participantCard('a')}
            <div className="flex lg:flex-col items-center justify-center">
              <button
                type="button"
                onClick={swapLanguages}
                disabled={running}
                className="rounded-full border border-white/10 bg-slate-900/80 p-3 text-white/60 hover:text-white disabled:opacity-40"
                title="Swap languages"
              >
                <ArrowLeftRight className="w-4 h-4" />
              </button>
            </div>
            {participantCard('b')}
          </section>

          <section className="rounded-2xl border border-white/10 bg-slate-950/50 p-5 grid md:grid-cols-2 xl:grid-cols-4 gap-4">
            {elevenLabsKeys.length > 1 && (
              <label className="space-y-1">
                <span className="text-xs text-white/50">ElevenLabs key</span>
                <select className={selectClass} disabled={running} value={keyId ?? ''} onChange={(event) => setKeyId(event.target.value)}>
                  {elevenLabsKeys.map((key) => <option key={key.id} value={key.id}>{key.key_alias}{key.last_four ? ` ••${key.last_four}` : ''}</option>)}
                </select>
              </label>
            )}
            <label className="space-y-1">
              <span className="text-xs text-white/50">Voice model</span>
              <select className={selectClass} disabled={running} value={model} onChange={(event) => setModel(event.target.value as TranslationTtsModel)}>
                {TRANSLATION_TTS_MODELS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-white/50">Eagerness</span>
              <select className={selectClass} disabled={running} value={eagerness} onChange={(event) => setEagerness(event.target.value as TranslationEagerness)}>
                {TRANSLATION_EAGERNESS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </label>
            <div className="space-y-2 text-sm text-white/70">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={zrm} disabled={running} onChange={(event) => setZrm(event.target.checked)} />
                <ShieldCheck className="w-4 h-4 text-white/40" /> Zero Retention Mode
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={echoGuard} onChange={(event) => setEchoGuard(event.target.checked)} />
                <Headphones className="w-4 h-4 text-white/40" /> Echo guard (mute mic during playback)
              </label>
            </div>
          </section>

          {error && (
            <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100 flex gap-3" role="alert">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {running ? (
              <>
                <Button onClick={() => void stopAll()} className="bg-rose-300">
                  <PhoneOff className="w-4 h-4" /> End conversation
                </Button>
                <Button variant="outline" onClick={stopPlayback} disabled={muting}>
                  <Volume2 className="w-4 h-4" /> Skip playback
                </Button>
                <span className="text-xs text-white/40">
                  {echoGuard ? 'Echo guard on: the mic is muted while a translation is playing.' : 'Tip: headphones give the most natural full-duplex experience. Turn on echo guard if you hear translations repeating.'}
                </span>
              </>
            ) : (
              <Button onClick={() => void start()} loading={starting} disabled={elevenLabsKeys.length === 0 || voices.length === 0}>
                {!starting && <Play className="w-4 h-4" />} Start conversation
              </Button>
            )}
          </div>

          <section className="rounded-2xl border border-white/10 bg-slate-950/50 p-5 min-h-[240px]">
            <h3 className="text-sm uppercase tracking-[0.2em] text-white/40 mb-4">Live captions</h3>
            {turns.length === 0 ? (
              <p className="text-white/40 text-sm">
                {running ? 'Tap a speaker to begin.' : starting ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Connecting…</span> : 'Captions will appear here.'}
              </p>
            ) : (
              <ol className="space-y-4">
                {turns.filter((turn) => turn.finals.length || turn.partial || turn.translation.length).map((turn) => {
                  const speaker = participants[turn.speaker];
                  const listener = participants[OTHER[turn.speaker]];
                  return (
                    <li key={turn.id} className={cn('rounded-xl border p-4', turn.speaker === 'a' ? 'border-cyan-300/20 bg-cyan-400/5 mr-12' : 'border-violet-300/20 bg-violet-400/5 ml-12')}>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/40">
                        <span>{speaker.name} · {languageLabel(speaker.language)}</span>
                        <span className="tabular-nums">
                          {turn.firstTextMs !== null && <>text {turn.firstTextMs} ms</>}
                          {turn.firstAudioMs !== null && <> · voice {turn.firstAudioMs} ms</>}
                        </span>
                      </div>
                      <p className="mt-1 text-white/80">
                        {turn.finals.join(' ')}
                        {turn.partial && <span className="text-white/40 italic"> {turn.partial}</span>}
                      </p>
                      {turn.translation.length > 0 && (
                        <p className="mt-2 text-teal-100">
                          <span className="text-xs text-white/40 mr-2">{listener.name} hears · {languageLabel(listener.language)}</span>
                          {turn.translation.join(' ')}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            <div ref={turnsEndRef} />
          </section>
          <p className="text-xs text-white/30">
            Latency is measured from when the speaker starts talking to the first translated text / voice. Transcripts stay in this browser and are not saved.
          </p>
        </div>
      </div>
    </MainLayout>
  );
}
