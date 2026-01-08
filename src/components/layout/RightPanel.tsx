import { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';

interface RightPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: string;
}

export function RightPanel({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  width = '480px',
}: RightPanelProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 bg-slate-950 shadow-xl z-50 flex flex-col border-l border-white/10"
            style={{ width }}
          >
            <div className="px-6 py-5 border-b border-white/10 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white font-display">{title}</h2>
                {subtitle && (
                  <p className="text-sm text-white/60 mt-1">{subtitle}</p>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={onClose} className="text-white/70 hover:text-white hover:bg-white/5">
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="workspace-panel flex-1 overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
