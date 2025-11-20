import { motion } from 'framer-motion';
import { Wrench, CheckCircle, XCircle } from 'lucide-react';

interface ToolCall {
  name: string;
  status?: 'success' | 'error' | 'pending';
}

interface ToolCallIndicatorProps {
  tool: ToolCall;
}

export function ToolCallIndicator({ tool }: ToolCallIndicatorProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-xs"
    >
      <Wrench className="w-3 h-3 text-amber-600" />
      <span className="font-medium text-amber-800">{tool.name}</span>
      {tool.status === 'success' && (
        <CheckCircle className="w-3 h-3 text-green-600" />
      )}
      {tool.status === 'error' && (
        <XCircle className="w-3 h-3 text-red-600" />
      )}
    </motion.div>
  );
}
