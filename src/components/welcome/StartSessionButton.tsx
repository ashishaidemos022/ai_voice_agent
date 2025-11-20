import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

interface StartSessionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}

export function StartSessionButton({ onClick, disabled, loading, children }: StartSessionButtonProps) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled || loading}
      className="w-[280px] px-8 py-4 rounded-full bg-gradient-to-r from-blue-600 to-blue-500 text-white text-lg font-semibold shadow-[0_0_20px_rgba(37,99,235,0.35)] hover:shadow-[0_0_30px_rgba(37,99,235,0.5)] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-3"
      whileHover={!disabled && !loading ? { y: -2, scale: 1.02 } : {}}
      whileTap={!disabled && !loading ? { scale: 0.98 } : {}}
      animate={loading ? {
        background: [
          'linear-gradient(to right, rgb(37, 99, 235), rgb(59, 130, 246))',
          'linear-gradient(to right, rgb(59, 130, 246), rgb(37, 99, 235))',
          'linear-gradient(to right, rgb(37, 99, 235), rgb(59, 130, 246))'
        ]
      } : {}}
      transition={{
        duration: 2,
        repeat: loading ? Infinity : 0,
        ease: "easeInOut"
      }}
    >
      {loading && (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <Loader2 className="w-5 h-5" />
        </motion.div>
      )}
      {children}
    </motion.button>
  );
}
