import { motion } from 'framer-motion';
import { User, Bot } from 'lucide-react';
import { Message } from '../../types/voice-agent';
import { ToolCallIndicator } from './ToolCallIndicator';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  const time = new Date(message.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex gap-3 mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
          <Bot className="w-4 h-4 text-white" />
        </div>
      )}

      <div className={`flex flex-col max-w-[65%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`px-4 py-3 rounded-2xl ${
            isUser
              ? 'bg-blue-500 text-white shadow-sm'
              : isSystem
              ? 'bg-gray-100 text-gray-700 border border-gray-200'
              : 'bg-white text-gray-900 border border-gray-200 shadow-sm'
          }`}
        >
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
        </div>

        {message.tool_calls && message.tool_calls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.tool_calls.map((tool, idx) => (
              <ToolCallIndicator key={idx} tool={tool} />
            ))}
          </div>
        )}

        <span className="text-xs text-gray-400 mt-1.5">{time}</span>
      </div>

      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
          <User className="w-4 h-4 text-gray-600" />
        </div>
      )}
    </motion.div>
  );
}
