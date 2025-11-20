import { motion } from 'framer-motion';
import { BackgroundBlobs } from './BackgroundBlobs';
import { AIGlowOrb } from './AIGlowOrb';
import { StartSessionButton } from './StartSessionButton';

interface WelcomeHeroProps {
  onStart: () => void;
  isInitializing: boolean;
  activeConfigName?: string;
  error?: string | null;
}

export function WelcomeHero({ onStart, isInitializing, activeConfigName, error }: WelcomeHeroProps) {
  return (
    <div className="fixed inset-0 bg-gradient-radial from-[#0D1117] via-[#111827] to-[#1e1b4b] flex items-center justify-center overflow-hidden">
      <BackgroundBlobs />

      <motion.div
        className="relative z-10 flex flex-col items-center justify-center max-w-2xl px-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <AIGlowOrb />
        </motion.div>

        <motion.h1
          className="mt-12 text-5xl font-semibold bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-500 bg-clip-text text-transparent text-center tracking-tight"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
        >
          Meet Your Voice AI Agent
        </motion.h1>

        <motion.p
          className="mt-6 text-lg text-slate-300 text-center leading-relaxed max-w-xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
        >
          A real-time conversational agent powered by OpenAI Realtime + MCP tools
        </motion.p>

        {activeConfigName && (
          <motion.p
            className="mt-4 text-sm text-slate-400 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
          >
            Active Configuration: <span className="font-medium text-blue-300">{activeConfigName}</span>
          </motion.p>
        )}

        {!activeConfigName && (
          <motion.p
            className="mt-4 text-sm text-slate-500 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
          >
            No configuration selected
          </motion.p>
        )}

        <motion.div
          className="mt-10"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5, ease: "easeOut" }}
        >
          <StartSessionButton
            onClick={onStart}
            disabled={isInitializing}
            loading={isInitializing}
          >
            {isInitializing ? 'Requesting Permissions...' : 'Start Voice Agent'}
          </StartSessionButton>
        </motion.div>

        {error && (
          <motion.div
            className="mt-6 px-6 py-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-sm max-w-md text-center backdrop-blur-sm"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            {error}
          </motion.div>
        )}

        <motion.p
          className="mt-12 text-xs text-slate-500 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.6, ease: "easeOut" }}
        >
          Powered by OpenAI Realtime + Supabase + MCP
        </motion.p>
      </motion.div>
    </div>
  );
}
