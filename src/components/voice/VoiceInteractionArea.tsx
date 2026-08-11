import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  ArrowRight,
  AudioWaveform,
  BrainCircuit,
  Clock3,
  MessageSquareText,
  Mic,
  Radio,
  Square,
  Wrench,
  Zap
} from 'lucide-react';
import { AgentState } from '../../lib/realtime-client';
import { OPENAI_MODELS } from '../../../shared/openai-models';
import type { RealtimeConfig } from '../../types/voice-agent';
import { AIAvatar } from './AIAvatar';
import { AgentStatusBar } from './AgentStatusBar';

interface VoiceInteractionAreaProps {
  agentState: AgentState;
  isRecording: boolean;
  isConnected: boolean;
  liveUserTranscript?: string;
  liveAssistantTranscript?: string;
  waveformData: Uint8Array | null;
  volume: number;
  config: RealtimeConfig;
  sessionElapsedSeconds: number;
  turnCount: number;
  messageCount: number;
  toolCallCount: number;
  onToggle: () => void;
}

type RuntimeStage = {
  label: string;
  model: string;
  detail: string;
  icon: typeof Mic;
  accent: string;
};

type RuntimeProfile = {
  provider: string;
  architecture: string;
  summary: string;
  transport: string;
  audio: string;
  turnTaking: string;
  stages: RuntimeStage[];
};

const stateLabel: Record<AgentState, string> = {
  idle: 'Idle',
  listening: 'Listening',
  thinking: 'Reasoning',
  speaking: 'Speaking',
  interrupted: 'Interrupted'
};

const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const normalizeElevenLabsModel = (model?: string | null) => {
  if (model === 'eleven_v3') return 'eleven_v3_conversational';
  return model || 'eleven_flash_v2_5';
};

const formatAudioFormat = (format?: string | null) => {
  const [codec = 'pcm', rawRate = '24000'] = `${format || 'pcm_24000'}`.split('_');
  const rate = Number(rawRate);
  const rateLabel = Number.isFinite(rate) && rate >= 1000 ? `${rate / 1000} kHz` : `${rawRate} Hz`;
  return `${codec === 'ulaw' ? 'μ-law' : codec.toUpperCase()} · ${rateLabel}`;
};

function runtimeProfile(config: RealtimeConfig): RuntimeProfile {
  const provider = config.voice_provider ?? 'openai_realtime';
  const providerConfig = config.voice_provider_config || {};
  const silenceMs = config.turn_detection?.silence_duration_ms ?? 700;

  if (provider === 'elevenlabs_agent') {
    const effectiveModel = providerConfig.app_managed?.effective_tts_model_id
      || normalizeElevenLabsModel(providerConfig.model_id);
    const llm = providerConfig.llm || 'ElevenLabs-managed LLM';
    const transcriptionModel = providerConfig.asr_model_id
      || (effectiveModel === 'eleven_v3_conversational' ? 'scribe_v2_realtime' : 'ElevenLabs managed STT');
    const outputFormat = formatAudioFormat(providerConfig.output_format);
    return {
      provider: 'ElevenLabs',
      architecture: 'Direct agent · full stack',
      summary: 'ElevenLabs owns transcription, turn-taking, reasoning orchestration, and speech synthesis.',
      transport: 'WebSocket · signed session',
      audio: `${outputFormat} output · 25 ms input chunks`,
      turnTaking: `ElevenLabs turn model · ${providerConfig.turn_eagerness || 'normal'}`,
      stages: [
        {
          label: 'Speech recognition',
          model: transcriptionModel,
          detail: effectiveModel === 'eleven_v3_conversational' ? 'Expressive Mode turn signals' : 'Native conversational input',
          icon: Mic,
          accent: 'text-cyan-200'
        },
        {
          label: 'Intelligence',
          model: llm,
          detail: 'ElevenLabs Agent orchestration',
          icon: BrainCircuit,
          accent: 'text-violet-200'
        },
        {
          label: 'Speech synthesis',
          model: effectiveModel,
          detail: `Voice · ${config.voice_id || config.voice || 'provider default'}`,
          icon: AudioWaveform,
          accent: 'text-amber-200'
        }
      ]
    };
  }

  if (provider === 'elevenlabs_tts') {
    const ttsModel = normalizeElevenLabsModel(providerConfig.model_id);
    return {
      provider: 'OpenAI + ElevenLabs',
      architecture: 'Cascaded · split providers',
      summary: 'OpenAI handles listening and reasoning; text is streamed to ElevenLabs for speech.',
      transport: 'Dual WebSocket · secure gateway',
      audio: `${formatAudioFormat(providerConfig.output_format)} output`,
      turnTaking: `OpenAI server VAD · ${silenceMs} ms silence`,
      stages: [
        {
          label: 'Speech recognition',
          model: OPENAI_MODELS.transcription.accurate,
          detail: 'OpenAI streaming transcription',
          icon: Mic,
          accent: 'text-cyan-200'
        },
        {
          label: 'Intelligence',
          model: config.model,
          detail: 'OpenAI text-mode Realtime',
          icon: BrainCircuit,
          accent: 'text-violet-200'
        },
        {
          label: 'Speech synthesis',
          model: ttsModel,
          detail: `ElevenLabs voice · ${config.voice_id || 'provider default'}`,
          icon: AudioWaveform,
          accent: 'text-amber-200'
        }
      ]
    };
  }

  if (provider === 'personaplex') {
    return {
      provider: 'NVIDIA',
      architecture: 'PersonaPlex · full duplex',
      summary: 'One full-duplex speech model listens and responds continuously without a cascaded LLM/TTS path.',
      transport: 'WebSocket · hosted gateway',
      audio: `Opus input · PCM 48 kHz playback`,
      turnTaking: 'Full duplex · continuous interaction',
      stages: [
        {
          label: 'Audio input',
          model: 'PersonaPlex ASR',
          detail: 'Streaming Opus capture',
          icon: Mic,
          accent: 'text-cyan-200'
        },
        {
          label: 'Speech intelligence',
          model: config.model || 'PersonaPlex',
          detail: 'Unified full-duplex model',
          icon: BrainCircuit,
          accent: 'text-violet-200'
        },
        {
          label: 'Audio output',
          model: config.voice_id || config.voice || 'PersonaPlex voice',
          detail: 'Streaming PCM playback',
          icon: AudioWaveform,
          accent: 'text-amber-200'
        }
      ]
    };
  }

  return {
    provider: 'OpenAI',
    architecture: 'Native Realtime · speech to speech',
    summary: 'A single OpenAI Realtime model reasons over live audio and produces speech directly.',
    transport: 'WebRTC · ephemeral session',
    audio: 'WebRTC negotiated audio',
    turnTaking: `OpenAI server VAD · ${silenceMs} ms silence`,
    stages: [
      {
        label: 'Transcription',
        model: OPENAI_MODELS.transcription.accurate,
        detail: 'Input transcript stream',
        icon: Mic,
        accent: 'text-cyan-200'
      },
      {
        label: 'Realtime intelligence',
        model: config.model,
        detail: 'Native multimodal reasoning',
        icon: BrainCircuit,
        accent: 'text-violet-200'
      },
      {
        label: 'Native speech output',
        model: config.model,
        detail: `OpenAI voice · ${config.voice}`,
        icon: AudioWaveform,
        accent: 'text-amber-200'
      }
    ]
  };
}

function buildWaveHeights(waveformData: Uint8Array | null, volume: number) {
  const bars = 22;
  if (!waveformData || waveformData.length === 0) {
    return Array.from({ length: bars }, (_, idx) => Math.max(8, (Math.sin(idx * 1.3) * 10 + 28) * (0.35 + volume)));
  }
  const chunk = Math.floor(waveformData.length / bars) || 1;
  return Array.from({ length: bars }, (_, index) => {
    const slice = waveformData.slice(index * chunk, index * chunk + chunk);
    const avg = slice.reduce((sum, value) => sum + Math.abs(value - 128), 0) / Math.max(1, slice.length);
    return 10 + avg * 0.65 + volume * 26;
  });
}

export function VoiceInteractionArea({
  agentState,
  isRecording,
  isConnected,
  liveUserTranscript,
  liveAssistantTranscript,
  waveformData,
  volume,
  config,
  sessionElapsedSeconds,
  turnCount,
  messageCount,
  toolCallCount,
  onToggle
}: VoiceInteractionAreaProps) {
  const heights = buildWaveHeights(waveformData, volume);
  const isActive = agentState === 'listening' || agentState === 'speaking';
  const profile = runtimeProfile(config);
  const stats = [
    { label: 'Session', value: formatDuration(sessionElapsedSeconds), icon: Clock3 },
    { label: 'Turns', value: `${turnCount}`, icon: Radio },
    { label: 'Messages', value: `${messageCount}`, icon: MessageSquareText },
    { label: 'Tool calls', value: `${toolCallCount}`, icon: Wrench },
    { label: 'Input level', value: `${Math.round(Math.min(1, volume) * 100)}%`, icon: Activity }
  ];

  return (
    <section className="relative w-full rounded-3xl overflow-hidden bg-slate-950 shadow-2xl border border-white/10">
      <div className="absolute inset-0 opacity-80" style={{ backgroundImage: 'radial-gradient(circle at 8% 12%, rgba(34,211,238,0.12), transparent 28%), radial-gradient(circle at 78% 5%, rgba(139,92,246,0.16), transparent 32%), radial-gradient(circle at 90% 85%, rgba(245,158,11,0.08), transparent 28%)' }} />
      <div className="relative p-5 lg:p-6 space-y-5">
        <header className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <AIAvatar state={agentState} isConnected={isConnected} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <span className="text-[10px] uppercase tracking-[0.24em] text-cyan-200/70">Live voice runtime</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-white/65">
                  {profile.provider}
                </span>
                <span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-violet-100">
                  {profile.architecture}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl lg:text-2xl font-semibold text-white">{stateLabel[agentState]}</h2>
                <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
              </div>
              <p className="text-xs lg:text-sm text-white/55 mt-1 max-w-2xl">{profile.summary}</p>
            </div>
          </div>
          <AgentStatusBar state={agentState} isConnected={isConnected} />
        </header>

        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3.5 lg:p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-white/40">Active model pipeline</p>
              <p className="text-xs text-white/55 mt-1">Exact configured model at each stage</p>
            </div>
            <div className="hidden md:flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-white/45">
              <Zap className="w-3.5 h-3.5 text-amber-200" />
              {profile.transport}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] gap-2 items-stretch">
            {profile.stages.map((stage, index) => {
              const StageIcon = stage.icon;
              return (
                <div key={stage.label} className="contents">
                  <div className="min-w-0 rounded-xl border border-white/10 bg-slate-900/80 px-3.5 py-3">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-white/40">
                      <StageIcon className={`w-3.5 h-3.5 ${stage.accent}`} />
                      {stage.label}
                    </div>
                    <p className="mt-1.5 text-sm font-semibold text-white truncate" title={stage.model}>{stage.model}</p>
                    <p className="mt-0.5 text-[11px] text-white/45 truncate" title={stage.detail}>{stage.detail}</p>
                  </div>
                  {index < profile.stages.length - 1 && (
                    <div className="hidden md:flex items-center justify-center px-0.5 text-white/20">
                      <ArrowRight className="w-4 h-4" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {stats.map((stat) => {
            const StatIcon = stat.icon;
            return (
              <div key={stat.label} className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-white/40">
                  <StatIcon className="w-3.5 h-3.5 text-cyan-200/65" />
                  {stat.label}
                </div>
                <p className="text-base font-semibold text-white mt-1 tabular-nums">{stat.value}</p>
              </div>
            );
          })}
        </div>

        <div className="relative rounded-2xl border border-white/10 bg-gradient-to-r from-slate-900/95 via-indigo-950/90 to-slate-900/95 overflow-hidden min-h-[108px]">
          <div className="absolute inset-0 grid items-center gap-[4px] px-5 opacity-70" style={{ gridTemplateColumns: `repeat(${heights.length}, minmax(0, 1fr))` }}>
            {heights.map((height, index) => (
              <motion.div
                key={index}
                className={`rounded-full ${isActive ? 'bg-gradient-to-t from-cyan-400/50 to-violet-300' : 'bg-white/10'}`}
                animate={{ height: Math.max(5, Math.min(54, height)) }}
                transition={{ type: 'spring', stiffness: 130, damping: 22, delay: index * 0.006 }}
              />
            ))}
          </div>

          <AnimatePresence>
            {liveUserTranscript && agentState === 'listening' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute inset-x-4 top-3 z-10 rounded-xl bg-cyan-950/85 backdrop-blur px-3 py-2 border border-cyan-300/20">
                <p className="text-[9px] uppercase tracking-[0.18em] text-cyan-200">You</p>
                <p className="text-sm font-medium text-white line-clamp-2">{liveUserTranscript}</p>
              </motion.div>
            )}
            {liveAssistantTranscript && agentState === 'speaking' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute inset-x-4 top-3 z-10 rounded-xl bg-violet-950/85 backdrop-blur px-3 py-2 border border-violet-300/20">
                <p className="text-[9px] uppercase tracking-[0.18em] text-violet-200">Assistant</p>
                <p className="text-sm font-medium text-white line-clamp-2">{liveAssistantTranscript}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="absolute inset-x-3 bottom-3 z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/80 backdrop-blur px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-white/55">
              <span className="flex items-center gap-1.5"><Radio className="w-3 h-3 text-emerald-300" />{profile.transport}</span>
              <span>{profile.audio}</span>
              <span>{profile.turnTaking}</span>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <span className="text-[10px] text-white/45">{isRecording ? 'Mic live' : 'Mic paused'}</span>
              <button
                onClick={onToggle}
                className={`h-9 w-9 rounded-xl flex items-center justify-center text-white shadow-lg transition hover:scale-[1.03] ${isRecording ? 'bg-rose-500 hover:bg-rose-400' : 'bg-white/10 hover:bg-white/20 border border-white/15'}`}
                aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              >
                {isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
