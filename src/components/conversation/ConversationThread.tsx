import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, MessageSquare } from "lucide-react";
import { AgentState } from "../../lib/realtime-client";
import { Message } from "../../types/voice-agent";
import { MessageBubble } from "./MessageBubble";
import { Card } from "../ui/Card";

interface Props {
  messages: Message[];
  isProcessing: boolean;
  isHistorical?: boolean;
  isLoadingHistory?: boolean;
  historyError?: string | null;
  liveAssistantTranscript?: string;
  liveUserTranscript?: string;
  agentState?: AgentState;
}

const streamMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.18 }
};

export function ConversationThread({
  messages,
  isProcessing,
  isHistorical = false,
  isLoadingHistory = false,
  historyError = null,
  liveAssistantTranscript,
  liveUserTranscript,
  agentState = "idle"
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: isHistorical ? "auto" : "smooth"
    });
  }, [messages, isHistorical, liveAssistantTranscript, liveUserTranscript]);

  return (
    <Card className="h-full flex flex-col relative overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 border border-white/10">
      <div className="px-5 py-4 border-b border-white/5 bg-white/5 backdrop-blur flex items-center gap-2 flex-shrink-0">
        <MessageSquare className="w-5 h-5 text-indigo-200" />
        <h2 className="text-lg font-semibold text-white">
          {isHistorical ? "Session History" : "Conversation"}
        </h2>
        {messages.length > 0 && (
          <span className="text-sm text-white/60">{messages.length} messages</span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0"
      >
        {isLoadingHistory && (
          <div className="flex flex-col items-center justify-center h-full py-10 text-white/80">
            <Loader2 className="w-10 h-10 text-indigo-300 animate-spin mb-3" />
            <p className="font-medium">Loading session history…</p>
            <p className="text-sm text-white/60 mt-1">Fetching messages from database</p>
          </div>
        )}

        {!isLoadingHistory && historyError && (
          <div className="flex flex-col items-center justify-center h-full py-10 text-white">
            <div className="w-12 h-12 rounded-full bg-rose-500/20 flex items-center justify-center mb-3">
              <MessageSquare className="w-6 h-6 text-rose-300" />
            </div>
            <p className="font-medium mb-1">Unable to load messages</p>
            <p className="text-sm text-rose-200">{historyError}</p>
          </div>
        )}

        {!isLoadingHistory && !historyError && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full py-10 text-white/70">
            <MessageSquare className="w-12 h-12 text-white/20 mb-3" />
            <p>{isHistorical ? "This session contains no messages." : "Start speaking to begin the conversation."}</p>
            {isHistorical && (
              <p className="text-xs text-white/40">Select another session from the left panel.</p>
            )}
          </div>
        )}

        {!isLoadingHistory && !historyError && messages.length > 0 && (
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
              >
                <MessageBubble message={m} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}

        {!isHistorical && (
          <AnimatePresence>
            {agentState === "listening" && liveUserTranscript && (
              <motion.div
                {...streamMotion}
                className="inline-flex"
              >
                <div className="rounded-2xl bg-white/10 backdrop-blur px-4 py-3 text-white shadow-lg border border-white/10">
                  <p className="text-xs uppercase tracking-[0.15em] text-indigo-200 mb-1">You</p>
                  <p className="leading-snug">{liveUserTranscript}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {!isHistorical && (
          <AnimatePresence>
            {(agentState === "speaking" || isProcessing) && (liveAssistantTranscript || isProcessing) && (
              <motion.div
                {...streamMotion}
                className="inline-flex"
              >
                <div className="rounded-2xl bg-indigo-900/80 border border-indigo-300/30 px-4 py-3 text-white shadow-lg">
                  <p className="text-xs uppercase tracking-[0.15em] text-indigo-200 mb-1">Assistant</p>
                  <p className="leading-snug">
                    {liveAssistantTranscript || "Agent is thinking…"}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {isProcessing && !isHistorical && !liveAssistantTranscript && (
          <div className="flex items-center gap-2 text-white/60 pt-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Agent is thinking…</span>
          </div>
        )}
      </div>
    </Card>
  );
}
