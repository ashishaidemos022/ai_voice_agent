// app/components/conversation/ConversationThread.tsx

import React, { useEffect, useRef } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { Message } from "../../types/voice-agent";
import { MessageBubble } from "./MessageBubble";
import { Card } from "../ui/Card";

interface Props {
  messages: Message[];
  isProcessing: boolean;
  isHistorical?: boolean;
  isLoadingHistory?: boolean;
  historyError?: string | null;
}

export function ConversationThread({
  messages,
  isProcessing,
  isHistorical = false,
  isLoadingHistory = false,
  historyError = null,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  /** -----------------------------
   * AUTO-SCROLL BEHAVIOR
   * ------------------------------*/

  useEffect(() => {
    if (!scrollRef.current) return;

    // Always scroll to bottom to show most recent messages
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: isHistorical ? "auto" : "smooth",
    });
  }, [messages, isHistorical]);

  /** -----------------------------
   * UI RENDERING
   * ------------------------------*/

  return (
    <Card className="h-full flex flex-col relative overflow-hidden">
      {/* HEADER */}
      <div className="px-5 py-4 border-b border-gray-200 bg-white/70 backdrop-blur-sm flex items-center gap-2 flex-shrink-0">
        <MessageSquare className="w-5 h-5 text-gray-600" />
        <h2 className="text-lg font-semibold text-gray-900">
          {isHistorical ? "Session History" : "Conversation"}
        </h2>

        {messages.length > 0 && (
          <span className="text-sm text-gray-500">
            {messages.length} messages
          </span>
        )}
      </div>

      {/* SCROLLABLE CONTENT */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0"
      >
        {/* LOADING STATE */}
        {isLoadingHistory && (
          <div className="flex flex-col items-center justify-center h-full py-10">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-3" />
            <p className="text-gray-600 font-medium">
              Loading session history…
            </p>
            <p className="text-gray-500 text-sm mt-1">
              Fetching messages from database
            </p>
          </div>
        )}

        {/* ERROR STATE */}
        {!isLoadingHistory && historyError && (
          <div className="flex flex-col items-center justify-center h-full py-10">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-3">
              <MessageSquare className="w-6 h-6 text-red-600" />
            </div>
            <p className="text-gray-900 font-medium mb-1">
              Unable to load messages
            </p>
            <p className="text-red-600 text-sm">{historyError}</p>
          </div>
        )}

        {/* EMPTY STATE */}
        {!isLoadingHistory && !historyError && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full py-10">
            <MessageSquare className="w-12 h-12 text-gray-300 mb-3" />
            <p className="text-gray-500 mb-1">
              {isHistorical
                ? "This session contains no messages."
                : "Start speaking to begin the conversation."}
            </p>
            {isHistorical && (
              <p className="text-xs text-gray-400">
                Select another session from the left panel.
              </p>
            )}
          </div>
        )}

        {/* MESSAGE LIST */}
        {!isLoadingHistory &&
          !historyError &&
          messages.length > 0 &&
          messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

        {/* LIVE PROCESSING INDICATOR */}
        {isProcessing && !isHistorical && (
          <div className="flex items-center gap-2 text-gray-500 pt-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Agent is thinking…</span>
          </div>
        )}
      </div>
    </Card>
  );
}