import { motion } from 'framer-motion';
import { Mic, Square } from 'lucide-react';
import { Card } from '../ui/Card';

interface MicrophoneCardProps {
  isRecording: boolean;
  isConnected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  liveTranscript?: string;
}

export function MicrophoneCard({
  isRecording,
  isConnected,
  onToggle,
  disabled = false,
  liveTranscript,
}: MicrophoneCardProps) {
  return (
    <Card className="p-8">
      <div className="flex flex-col items-center">
        <motion.button
          onClick={onToggle}
          disabled={disabled || !isConnected}
          className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 ${
            isRecording
              ? 'bg-gradient-to-br from-red-500 to-red-600 shadow-lg shadow-red-500/30'
              : 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/30'
          } ${
            disabled || !isConnected
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:scale-105 active:scale-95'
          }`}
          whileHover={!disabled && isConnected ? { scale: 1.05 } : {}}
          whileTap={!disabled && isConnected ? { scale: 0.95 } : {}}
        >
          {isRecording ? (
            <Square className="w-10 h-10 text-white fill-white" />
          ) : (
            <Mic className="w-10 h-10 text-white" />
          )}

          {isRecording && (
            <>
              <motion.span
                className="absolute inset-0 rounded-full bg-red-400 opacity-30"
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              <motion.span
                className="absolute inset-0 rounded-full bg-red-400 opacity-20"
                animate={{ scale: [1, 1.5, 1] }}
                transition={{ duration: 1.5, repeat: Infinity, delay: 0.3 }}
              />
            </>
          )}
        </motion.button>

        <div className="mt-6 text-center">
          <div className="flex items-center justify-center gap-2">
            <div
              className={`w-2 h-2 rounded-full transition-colors ${
                isConnected ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-sm font-medium text-gray-600">
              {isConnected
                ? isRecording
                  ? 'Recording...'
                  : 'Ready to speak'
                : 'Disconnected'}
            </span>
          </div>

          {liveTranscript && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg max-w-md"
            >
              <p className="text-sm text-blue-800 italic">{liveTranscript}</p>
            </motion.div>
          )}
        </div>
      </div>
    </Card>
  );
}
