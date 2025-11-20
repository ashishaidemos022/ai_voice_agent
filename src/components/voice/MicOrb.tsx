import { motion } from 'framer-motion';
import { Mic } from 'lucide-react';
import { useEffect, useState } from 'react';

interface MicOrbProps {
  isRecording: boolean;
  isConnected: boolean;
  isProcessing: boolean;
  onToggle: () => void;
  waveformData: Uint8Array | null;
}

interface Ripple {
  id: number;
  scale: number;
  opacity: number;
}

export function MicOrb({
  isRecording,
  isConnected,
  isProcessing,
  onToggle,
  waveformData
}: MicOrbProps) {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [volume, setVolume] = useState(0);

  useEffect(() => {
    if (waveformData && isRecording) {
      const sum = waveformData.reduce((acc, val) => acc + val, 0);
      const average = sum / waveformData.length;
      const normalized = Math.abs((average - 128) / 128);
      setVolume(normalized);

      if (normalized > 0.3) {
        const newRipple: Ripple = {
          id: Date.now(),
          scale: 1,
          opacity: 0.6
        };
        setRipples(prev => [...prev, newRipple]);

        setTimeout(() => {
          setRipples(prev => prev.filter(r => r.id !== newRipple.id));
        }, 1500);
      }
    } else {
      setVolume(0);
    }
  }, [waveformData, isRecording]);

  const getOrbColor = () => {
    if (!isConnected) return {
      bg: 'from-gray-400 to-gray-500',
      shadow: 'shadow-gray-400/30',
      glow: 'drop-shadow-[0_0_8px_rgba(156,163,175,0.4)]'
    };
    if (isProcessing) return {
      bg: 'from-yellow-400 to-amber-500',
      shadow: 'shadow-yellow-400/50',
      glow: 'drop-shadow-[0_0_16px_rgba(251,191,36,0.7)] drop-shadow-[0_0_32px_rgba(251,191,36,0.5)]'
    };
    if (isRecording) return {
      bg: 'from-green-400 to-emerald-500',
      shadow: 'shadow-green-400/60',
      glow: 'drop-shadow-[0_0_20px_rgba(52,211,153,0.8)] drop-shadow-[0_0_40px_rgba(52,211,153,0.6)]'
    };
    return {
      bg: 'from-blue-400 to-blue-600',
      shadow: 'shadow-blue-400/40',
      glow: 'drop-shadow-[0_0_12px_rgba(59,182,255,0.6)] drop-shadow-[0_0_24px_rgba(59,182,255,0.4)]'
    };
  };

  const colors = getOrbColor();
  const disabled = !isConnected;

  const volumeScale = 1 + (volume * 0.15);

  return (
    <div className="relative flex items-center justify-center">
      {ripples.map(ripple => (
        <motion.div
          key={ripple.id}
          className="absolute w-32 h-32 rounded-full border-2 border-green-400"
          initial={{ scale: 1, opacity: 0.6 }}
          animate={{ scale: 2.5, opacity: 0 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        />
      ))}

      <motion.button
        onClick={onToggle}
        disabled={disabled}
        className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 bg-gradient-to-br ${colors.bg} shadow-2xl ${colors.shadow} ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 active:scale-95 cursor-pointer'
        }`}
        style={{
          filter: colors.glow
        }}
        animate={{
          scale: isRecording ? [volumeScale, volumeScale * 1.05, volumeScale] : disabled ? 1 : [1, 1.02, 1],
        }}
        transition={{
          duration: isRecording ? 0.8 : 3,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        whileHover={!disabled ? { scale: 1.08 } : {}}
        whileTap={!disabled ? { scale: 0.92 } : {}}
      >
        {isRecording && (
          <>
            <motion.span
              className="absolute inset-0 rounded-full bg-green-300 opacity-20"
              animate={{ scale: [1, 1.4, 1] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.span
              className="absolute inset-0 rounded-full bg-green-300 opacity-15"
              animate={{ scale: [1, 1.6, 1] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: 0.4, ease: "easeInOut" }}
            />
          </>
        )}

        {!isRecording && !disabled && (
          <motion.span
            className="absolute inset-0 rounded-full bg-blue-300 opacity-10"
            animate={{ opacity: [0.1, 0.2, 0.1] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
          />
        )}

        {isProcessing && (
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{
              background: 'conic-gradient(from 0deg, transparent, rgba(251, 191, 36, 0.3), transparent)'
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          />
        )}

        <motion.div
          animate={{
            rotate: isProcessing ? [0, 5, -5, 0] : 0
          }}
          transition={{
            duration: 0.5,
            repeat: isProcessing ? Infinity : 0,
            ease: "easeInOut"
          }}
        >
          <Mic className="w-14 h-14 text-white relative z-10" strokeWidth={2.5} />
        </motion.div>

        <motion.div
          className="absolute inset-0 rounded-full border-4 border-white/20"
          animate={{
            scale: isRecording ? [1, 1.1, 1] : 1,
            opacity: isRecording ? [0.2, 0.4, 0.2] : 0.2
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
      </motion.button>
    </div>
  );
}
