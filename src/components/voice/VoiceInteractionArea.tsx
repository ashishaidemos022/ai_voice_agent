import { motion } from 'framer-motion';
import { VoiceSilhouette } from './VoiceSilhouette';
import { AnimatedWave } from './AnimatedWave';
import { MicOrb } from './MicOrb';
import { StatusLabel } from './StatusLabel';

interface VoiceInteractionAreaProps {
  isRecording: boolean;
  isConnected: boolean;
  isProcessing: boolean;
  onToggle: () => void;
  waveformData: Uint8Array | null;
}

export function VoiceInteractionArea({
  isRecording,
  isConnected,
  isProcessing,
  onToggle,
  waveformData
}: VoiceInteractionAreaProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="relative w-full h-72 rounded-2xl overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 shadow-2xl"
    >
      <div className="absolute inset-0 bg-gradient-radial from-blue-900/20 via-transparent to-transparent" />

      <div className="relative h-full flex items-center">
        <div className="w-2/5 h-full flex items-center justify-center px-8">
          <VoiceSilhouette />
        </div>

        <div className="flex-1 h-full relative flex flex-col items-center justify-center">
          <div className="absolute inset-0">
            <AnimatedWave
              waveformData={waveformData}
              isActive={isRecording}
              isProcessing={isProcessing}
              isConnected={isConnected}
            />
          </div>

          <div className="relative z-10 flex flex-col items-center gap-8">
            <MicOrb
              isRecording={isRecording}
              isConnected={isConnected}
              isProcessing={isProcessing}
              onToggle={onToggle}
              waveformData={waveformData}
            />

            <StatusLabel
              isConnected={isConnected}
              isRecording={isRecording}
              isProcessing={isProcessing}
            />
          </div>
        </div>
      </div>

      <div className="absolute inset-0 border border-blue-500/20 rounded-2xl pointer-events-none" />

      <motion.div
        className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-400/50 to-transparent"
        animate={{
          opacity: [0.3, 0.6, 0.3]
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
    </motion.div>
  );
}
