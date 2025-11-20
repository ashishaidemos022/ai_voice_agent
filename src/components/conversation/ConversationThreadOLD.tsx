import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, MessageSquare, ArrowDown } from 'lucide-react';
import { Message } from '../../types/voice-agent';
import { MessageBubble } from './MessageBubble';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

interface ConversationThreadProps {
  messages: Message[];
  isProcessing: boolean;
  isHistorical?: boolean;
  isLoadingHistory?: boolean;
  historyError?: string | null;
}

export function ConversationThread({ messages, isProcessing, isHistorical = false, isLoadingHistory = false, historyError = null }: ConversationThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [renderKey, setRenderKey] = useState(0);
  const prevMessagesLengthRef = useRef(messages.length);
  const prevIsHistoricalRef = useRef(isHistorical);

  useEffect(() => {
    if (
      messages.length !== prevMessagesLengthRef.current ||
      isHistorical !== prevIsHistoricalRef.current
    ) {
      console.log('📝 ConversationThread: messages changed, forcing re-render:', {
        prevLength: prevMessagesLengthRef.current,
        newLength: messages.length,
        prevIsHistorical: prevIsHistoricalRef.current,
        newIsHistorical: isHistorical,
        messageCount: messages.length,
        isLoadingHistory,
        historyError,
        isProcessing,
        firstMessageId: messages[0]?.id,
        lastMessageId: messages[messages.length - 1]?.id,
        timestamp: new Date().toISOString()
      });

      prevMessagesLengthRef.current = messages.length;
      prevIsHistoricalRef.current = isHistorical;
      setRenderKey(prev => prev + 1);
    }
  }, [messages, isHistorical, isLoadingHistory, historyError, isProcessing]);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior
      });
      setShowScrollButton(false);
      setIsUserScrolling(false);
    }
  };

  const handleScroll = () => {
    if (!scrollRef.current || isHistorical) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;

    if (!isNearBottom) {
      setIsUserScrolling(true);
      setShowScrollButton(true);
    } else {
      setIsUserScrolling(false);
      setShowScrollButton(false);
    }
  };

  useEffect(() => {
    if (!isUserScrolling && !isHistorical) {
      scrollToBottom('smooth');
    }
  }, [messages, isUserScrolling, isHistorical]);

  useEffect(() => {
    if (isHistorical) {
      scrollToBottom('auto');
    }
  }, [isHistorical]);

  return (
    <Card className="h-full flex flex-col relative">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900">
            {isHistorical ? 'Session History' : 'Conversation'}
          </h2>
          {messages.length > 0 && (
            <span className="text-sm text-gray-500">({messages.length})</span>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-4"
      >
        {isLoadingHistory ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader2 className="w-12 h-12 text-blue-500 mx-auto mb-3 animate-spin" />
              <p className="text-gray-600 font-medium">Loading session history...</p>
              <p className="text-sm text-gray-500 mt-1">Retrieving messages</p>
            </div>
          </div>
        ) : historyError ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
                <MessageSquare className="w-6 h-6 text-red-600" />
              </div>
              <p className="text-gray-900 font-medium mb-1">Unable to load messages</p>
              <p className="text-sm text-red-600">{historyError}</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">
                {isHistorical
                  ? 'This session has no messages'
                  : 'Start speaking to begin the conversation'}
              </p>
              {isHistorical && (
                <p className="text-xs text-gray-400 mt-1">Select another session from history</p>
              )}
            </div>
          </div>
        ) : (
          <div key={renderKey} className="space-y-1">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}

        {isProcessing && !isHistorical && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 text-gray-500 mt-2"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Agent is thinking...</span>
          </motion.div>
        )}
      </div>

      {showScrollButton && !isHistorical && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="absolute bottom-6 right-6"
        >
          <Button
            size="sm"
            onClick={() => scrollToBottom('smooth')}
            className="rounded-full shadow-lg"
          >
            <ArrowDown className="w-4 h-4 mr-1" />
            New messages
          </Button>
        </motion.div>
      )}
    </Card>
  );
}
