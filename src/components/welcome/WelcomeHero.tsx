import { motion } from 'framer-motion';
import { BackgroundBlobs } from './BackgroundBlobs';
import { AIGlowOrb } from './AIGlowOrb';
import { StartSessionButton } from './StartSessionButton';

interface WelcomeHeroProps {
  onStart: () => void;
  isInitializing: boolean;
  activeConfigName?: string;
  error?: string | null;
  presets?: { id: string; name: string }[];
  selectedPresetId?: string | null;
  onPresetSelect?: (id: string) => void;
  onGoToWorkspace?: () => void;
}

export function WelcomeHero({
  onStart,
  isInitializing,
  activeConfigName,
  error,
  presets = [],
  selectedPresetId,
  onPresetSelect,
  onGoToWorkspace
}: WelcomeHeroProps) {
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

        <motion.div
          className="mt-6 w-full max-w-md"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35, ease: "easeOut" }}
        >
          <label className="block text-sm font-medium text-slate-200 mb-2 text-center">
            Choose a configuration preset
          </label>
          <select
            value={selectedPresetId || ''}
            onChange={(e) => onPresetSelect?.(e.target.value)}
            className="w-full rounded-xl bg-white/10 border border-white/20 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-300"
          >
            <option value="">Select a preset</option>
            {presets.map(preset => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </select>
          <p className="mt-2 text-xs text-slate-400 text-center">
            Current: <span className="font-semibold text-cyan-200">{activeConfigName || 'None selected'}</span>
          </p>
        </motion.div>

        <motion.div
          className="mt-10"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5, ease: "easeOut" }}
        >
          <StartSessionButton
            onClick={onStart}
            disabled={isInitializing || !selectedPresetId}
            loading={isInitializing}
          >
            {isInitializing ? 'Requesting Permissions...' : selectedPresetId ? 'Start Voice Agent' : 'Select a Preset to Continue'}
          </StartSessionButton>
        </motion.div>

        {onGoToWorkspace && (
          <motion.div
            className="mt-4 text-center flex flex-col items-center gap-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.55, ease: "easeOut" }}
          >
            <p className="text-sm text-slate-300">
              Want to land in the workspace first?
            </p>
            <button
              type="button"
              onClick={onGoToWorkspace}
              className="text-sm font-medium text-cyan-300 underline underline-offset-4"
            >
              Go to workspace directly
            </button>
          </motion.div>
        )}

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
