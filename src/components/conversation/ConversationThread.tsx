import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Captions, Loader2, MessageSquare, Radio } from "lucide-react";
import { AgentState } from "../../lib/realtime-client";
import { Message } from "../../types/voice-agent";
import { MessageBubble } from "./MessageBubble";
import type { A2UIEvent } from "../../lib/a2ui";
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
  a2uiEnabled?: boolean;
  onA2UIEvent?: (event: A2UIEvent) => void;
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
  a2uiEnabled = false,
  onA2UIEvent
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldFollowRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    window.requestAnimationFrame(() => {
      const resolvedBehavior = behavior === "smooth" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : behavior;
      shouldFollowRef.current = true;
      setShowJumpToLatest(false);
      container.scrollTo({
        top: container.scrollHeight,
        behavior: resolvedBehavior
      });
    });
  };

  useLayoutEffect(() => {
    if (shouldFollowRef.current || isHistorical) {
      scrollToBottom(isHistorical ? "auto" : "smooth");
    }
  }, [messages, isHistorical]);

  useEffect(() => {
    if (isHistorical || !shouldFollowRef.current) return;
    scrollToBottom("smooth");
  }, [liveAssistantTranscript, liveUserTranscript, isHistorical]);

  return (
    <Card className="h-full flex flex-col relative overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 border border-white/10">
      <div className="px-5 py-4 border-b border-white/10 bg-white/5 backdrop-blur flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl border border-cyan-300/20 bg-cyan-400/10 flex items-center justify-center">
            {isHistorical ? <MessageSquare className="w-5 h-5 text-cyan-200" /> : <Captions className="w-5 h-5 text-cyan-200" />}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">
              {isHistorical ? "Session History" : "Live conversation"}
            </h2>
            <p className="text-xs text-white/45">
              {isHistorical ? `${messages.length} messages` : "Transcription appears here as each person speaks"}
            </p>
          </div>
        </div>
        {!isHistorical && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-200">
            <Radio className="h-3 w-3" /> Live
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={() => {
          const container = scrollRef.current;
          if (!container) return;
          const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 96;
          shouldFollowRef.current = isNearBottom;
          setShowJumpToLatest(!isNearBottom);
        }}
        role="log"
        aria-label={isHistorical ? "Historical conversation" : "Live conversation"}
        aria-live={isHistorical ? "off" : "polite"}
        aria-relevant="additions text"
        aria-busy={isProcessing}
        className="flex-1 overflow-y-auto px-5 py-5 space-y-4 min-h-0 scroll-smooth"
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

        {!isLoadingHistory && !historyError && messages.length === 0 && !liveUserTranscript && !liveAssistantTranscript && !isProcessing && (
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
                <MessageBubble message={m} a2uiEnabled={a2uiEnabled} onA2UIEvent={onA2UIEvent} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}

        {!isHistorical && (
          <AnimatePresence>
            {liveUserTranscript && (
              <motion.div
                {...streamMotion}
                className="flex justify-end"
              >
                <div className="max-w-[86%] rounded-2xl rounded-br-md bg-cyan-500 px-5 py-4 text-white shadow-lg shadow-cyan-950/25 border border-cyan-200/20">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-950/70 mb-1.5">You · speaking</p>
                  <p className="text-base lg:text-lg font-medium leading-relaxed whitespace-pre-wrap">{liveUserTranscript}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {!isHistorical && (
          <AnimatePresence>
            {(liveAssistantTranscript || isProcessing) && (
              <motion.div
                {...streamMotion}
                className="flex justify-start"
              >
                <div className="max-w-[86%] rounded-2xl rounded-bl-md bg-violet-950/90 border border-violet-300/30 px-5 py-4 text-white shadow-lg shadow-violet-950/25">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-200 mb-1.5">Viaana · {liveAssistantTranscript ? "speaking" : "thinking"}</p>
                  <p className="text-base lg:text-lg font-medium leading-relaxed whitespace-pre-wrap">
                    {liveAssistantTranscript || "Agent is thinking…"}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}

      </div>
      {showJumpToLatest && (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className="absolute bottom-4 right-4 z-20 rounded-full border border-white/15 bg-slate-900/95 px-3 py-2 text-xs text-white shadow-lg backdrop-blur hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
        >
          Jump to latest
        </button>
      )}
    </Card>
  );
}
