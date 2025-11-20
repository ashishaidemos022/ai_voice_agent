import { motion, AnimatePresence } from 'framer-motion';
import { AgentState } from '../../lib/realtime-client';
import { Brain, MessageCircle, Mic, Moon, Zap } from 'lucide-react';

interface AIAvatarProps {
  state: AgentState;
  isConnected: boolean;
}

const stateIcon: Record<AgentState, JSX.Element> = {
  idle: <Moon className="w-6 h-6" />,
  listening: <Mic className="w-6 h-6" />,
  thinking: <Brain className="w-6 h-6" />,
  speaking: <MessageCircle className="w-6 h-6" />,
  interrupted: <Zap className="w-6 h-6" />
};

const ringColors: Record<AgentState, string> = {
  idle: 'from-slate-500 to-indigo-500',
  listening: 'from-emerald-400 to-cyan-400',
  thinking: 'from-amber-400 to-orange-400',
  speaking: 'from-indigo-400 to-fuchsia-500',
  interrupted: 'from-rose-500 to-amber-400'
};

export function AIAvatar({ state, isConnected }: AIAvatarProps) {
  return (
    <div className="relative w-28 h-28">
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/10 to-white/0 blur-3xl" />
      <motion.div
        className={`relative w-full h-full rounded-full p-[3px] bg-gradient-to-r ${ringColors[state]} shadow-lg`}
        animate={{ scale: isConnected ? [1, 1.04, 1] : 1 }}
        transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
      >
        <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={state}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              className={`w-full h-full rounded-full flex items-center justify-center text-white bg-gradient-to-br ${ringColors[state]} bg-clip-padding`}
            >
              {stateIcon[state]}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
      <motion.div
        className="absolute inset-[-8px] rounded-full border border-white/10"
        animate={{ opacity: isConnected ? [0.35, 0.8, 0.35] : 0.25, scale: isConnected ? [1, 1.12, 1] : 1 }}
        transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
      />
    </div>
  );
}
