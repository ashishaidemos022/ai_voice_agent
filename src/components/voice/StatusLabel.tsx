import { motion, AnimatePresence } from 'framer-motion';

interface StatusLabelProps {
  isConnected: boolean;
  isRecording: boolean;
  isProcessing: boolean;
}

export function StatusLabel({ isConnected, isRecording, isProcessing }: StatusLabelProps) {
  const getStatusText = () => {
    if (!isConnected) return 'Disconnected';
    if (isProcessing) return 'Thinking...';
    if (isRecording) return 'Listening...';
    return 'Click to Start';
  };

  const getStatusColor = () => {
    if (!isConnected) return 'text-gray-400';
    if (isProcessing) return 'text-yellow-400';
    if (isRecording) return 'text-green-400';
    return 'text-blue-400';
  };

  const statusText = getStatusText();
  const statusColor = getStatusColor();

  return (
    <div className="flex flex-col items-center gap-2">
      <AnimatePresence mode="wait">
        <motion.div
          key={statusText}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
          className="text-center"
        >
          <p className={`text-lg font-medium ${statusColor} transition-colors duration-300`}>
            {statusText}
          </p>
        </motion.div>
      </AnimatePresence>

      {isConnected && !isRecording && !isProcessing && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-sm text-gray-400"
        >
          Tap the microphone to begin
        </motion.p>
      )}

      {isRecording && (
        <motion.div
          className="flex items-center gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <motion.div
            className="w-2 h-2 rounded-full bg-green-400"
            animate={{
              scale: [1, 1.3, 1],
              opacity: [1, 0.5, 1]
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeInOut"
            }}
          />
          <span className="text-sm text-gray-300">Voice Agent Ready</span>
        </motion.div>
      )}
    </div>
  );
}
