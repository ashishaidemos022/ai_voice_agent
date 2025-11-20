import { motion } from 'framer-motion';
import { AgentState } from '../../lib/realtime-client';
import { Loader2, MessageCircle, Music2, Sparkles, Volume2 } from 'lucide-react';

interface AgentStatusBarProps {
  state: AgentState;
  isConnected: boolean;
}

const descriptors: Record<AgentState, { label: string; color: string; icon: JSX.Element }> = {
  idle: { label: 'Idle · Ready for the next turn', color: 'text-white/80', icon: <Sparkles className="w-4 h-4" /> },
  listening: { label: 'Listening · Server VAD active', color: 'text-emerald-200', icon: <Volume2 className="w-4 h-4" /> },
  thinking: { label: 'Thinking · Planning a response', color: 'text-amber-200', icon: <Loader2 className="w-4 h-4 animate-spin" /> },
  speaking: { label: 'Speaking · Streaming audio', color: 'text-indigo-200', icon: <Music2 className="w-4 h-4" /> },
  interrupted: { label: 'Interrupted · Awaiting new input', color: 'text-rose-200', icon: <MessageCircle className="w-4 h-4" /> }
};

export function AgentStatusBar({ state, isConnected }: AgentStatusBarProps) {
  const descriptor = descriptors[state];
  return (
    <div className="flex items-center gap-3 text-sm text-white/70">
      <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
      <motion.div
        key={state}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className={`flex items-center gap-2 px-3 py-2 rounded-full bg-white/5 border border-white/10 ${descriptor.color}`}
      >
        {descriptor.icon}
        <span className="font-medium">{descriptor.label}</span>
      </motion.div>
    </div>
  );
}
