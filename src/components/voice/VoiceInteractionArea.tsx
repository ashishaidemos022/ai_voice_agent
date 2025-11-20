import { AnimatePresence, motion } from 'framer-motion';
import { Mic, Square, Waves, Zap } from 'lucide-react';
import { AgentState } from '../../lib/realtime-client';
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
  onToggle: () => void;
}

const stateLabel: Record<AgentState, string> = {
  idle: 'Idle',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  interrupted: 'Interrupted'
};

function buildWaveHeights(waveformData: Uint8Array | null, volume: number) {
  const bars = 28;
  if (!waveformData || waveformData.length === 0) {
    return Array.from({ length: bars }, (_, idx) => {
      const wobble = Math.sin(idx * 1.3) * 12 + 32;
      return Math.max(8, wobble * (0.4 + volume));
    });
  }

  const chunk = Math.floor(waveformData.length / bars) || 1;
  const heights: number[] = [];
  for (let i = 0; i < bars; i++) {
    const start = i * chunk;
    const slice = waveformData.slice(start, start + chunk);
    const avg = slice.reduce((acc, v) => acc + Math.abs(v - 128), 0) / slice.length;
    heights.push(12 + avg * 0.7 + volume * 30);
  }
  return heights;
}

export function VoiceInteractionArea({
  agentState,
  isRecording,
  isConnected,
  liveUserTranscript,
  liveAssistantTranscript,
  waveformData,
  volume,
  onToggle
}: VoiceInteractionAreaProps) {
  const heights = buildWaveHeights(waveformData, volume);
  const isActive = agentState === 'listening' || agentState === 'speaking';

  return (
    <div className="relative w-full rounded-3xl overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-900 to-slate-900 shadow-2xl border border-white/5">
      <div className="absolute inset-0 opacity-70" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(99,102,241,0.18), transparent 45%), radial-gradient(circle at 80% 0%, rgba(14,165,233,0.20), transparent 35%)' }} />
      <div className="relative flex flex-col lg:flex-row gap-8 p-6 lg:p-8">
        <div className="flex-1 flex items-center gap-5">
          <AIAvatar state={agentState} isConnected={isConnected} />
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-white/60">Realtime Voice Agent</p>
            <div className="text-2xl font-semibold text-white flex items-center gap-2">
              <Waves className="w-6 h-6 text-indigo-300" />
              {stateLabel[agentState]}
            </div>
            <p className="text-sm text-white/70 max-w-xl">
              Interruptible, turn-aware streaming with Whisper guidance. Speak anytime to barge in and steer the assistant.
            </p>
            <AgentStatusBar state={agentState} isConnected={isConnected} />
          </div>
        </div>

        <div className="flex-1 relative bg-white/5 border border-white/10 rounded-2xl px-6 py-5 shadow-inner overflow-hidden">
          <div className="absolute inset-0 opacity-70" style={{ backgroundImage: 'radial-gradient(circle at 10% 50%, rgba(251,191,36,0.08), transparent 30%), radial-gradient(circle at 90% 70%, rgba(94,92,250,0.12), transparent 40%)' }} />
          <div className="relative flex flex-col h-full gap-6">
            <div className="flex items-center justify-between text-sm text-white/70">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${isActive ? 'bg-emerald-400 animate-pulse' : 'bg-white/40'}`} />
                {isRecording ? 'Mic live · Server VAD' : 'Mic paused'}
              </div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/60">
                <Zap className="w-4 h-4" />
                PCM16 · Whisper-1
              </div>
            </div>

            <div className="relative flex-1 rounded-xl bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900 border border-white/10 overflow-hidden">
              <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'linear-gradient(120deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 40%)' }} />
              <div
                className="absolute inset-0 grid items-end gap-[4px] px-4 pb-6 pt-10"
                style={{ gridTemplateColumns: `repeat(${heights.length}, minmax(0, 1fr))` }}
              >
                {heights.map((h, idx) => (
                  <motion.div
                    key={idx}
                    className={`rounded-full ${isActive ? 'bg-indigo-300' : 'bg-white/25'}`}
                    initial={{ scaleY: 0.2 }}
                    animate={{ scaleY: Math.max(0.2, h / 70) }}
                    transition={{ type: 'spring', stiffness: 120, damping: 20, delay: idx * 0.01 }}
                    style={{ height: 70 }}
                  />
                ))}
              </div>

              <AnimatePresence>
                {liveUserTranscript && agentState === 'listening' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="absolute top-4 left-4 max-w-[75%] rounded-2xl bg-white/10 backdrop-blur px-4 py-3 text-white shadow-lg border border-white/20"
                  >
                    <p className="text-xs uppercase tracking-[0.15em] text-indigo-200 mb-1">You</p>
                    <p className="text-base font-medium leading-snug">{liveUserTranscript}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {liveAssistantTranscript && agentState === 'speaking' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="absolute bottom-4 right-4 max-w-[70%] rounded-2xl bg-indigo-900/70 backdrop-blur px-4 py-3 text-white shadow-xl border border-indigo-400/30"
                  >
                    <p className="text-xs uppercase tracking-[0.15em] text-indigo-200 mb-1">Assistant</p>
                    <p className="text-base font-medium leading-snug">{liveAssistantTranscript}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-white/70 text-sm">
                  <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                  {isConnected ? 'Realtime connected' : 'Connecting…'}
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-xs text-white/60 pr-2">
                    {isRecording ? 'Listening – tap to pause' : 'Mic paused – tap to start'}
                  </div>
                  <button
                    onClick={onToggle}
                    className={`h-12 w-12 rounded-2xl flex items-center justify-center text-white shadow-lg transition transform hover:scale-[1.02] ${
                      isRecording
                        ? 'bg-gradient-to-br from-rose-500 to-amber-400 hover:from-rose-400 hover:to-amber-300'
                        : 'bg-white/10 hover:bg-white/20 border border-white/15'
                    }`}
                    aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                  >
                    {isRecording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>
                </div>
              </div>
          </div>
        </div>
      </div>
    </div>
  );
}
