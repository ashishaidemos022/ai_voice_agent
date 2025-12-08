import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  BookOpenCheck,
  Clock,
  History,
  Loader2,
  MessageSquare,
  Play,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  UserRound
} from 'lucide-react';
import { useChatAgent } from '../../hooks/useChatAgent';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ChatMessage } from '../../types/chat';
import { cn } from '../../lib/utils';

const formatRelative = (dateString?: string | null) => {
  if (!dateString) return 'moments ago';
  const date = new Date(dateString);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
};

export function ChatAgent() {
  const {
    presets,
    activePresetId,
    setActivePresetId,
    availableTools,
    session,
    messages,
    historySessions,
    historicalMessages,
    selectedHistorySessionId,
    loadHistoricalSession,
    clearHistorySelection,
    toolEvents,
    liveAssistantText,
    isConnecting,
    isStreaming,
    isConnected,
    error,
    historyError,
    isHistoryLoading,
    startSession,
    sendMessage,
    endSession,
    ragResult,
    ragInvoked,
    ragError,
    isRagLoading
  } = useChatAgent();
  const [composerValue, setComposerValue] = useState('');
  const [viewMode, setViewMode] = useState<'current' | 'history'>('current');

  const visibleMessages = useMemo<ChatMessage[]>(() => {
    return viewMode === 'current' ? messages : historicalMessages;
  }, [messages, historicalMessages, viewMode]);

  const toolSummary = useMemo(() => {
    const mcpCount = availableTools.filter((tool) => tool.source !== 'n8n').length;
    const n8nCount = availableTools.filter((tool) => tool.source === 'n8n').length;
    return {
      total: availableTools.length,
      mcpCount,
      n8nCount,
      preview: availableTools.slice(0, 6)
    };
  }, [availableTools]);

  const handleSend = () => {
    const trimmed = composerValue.trim();
    if (!trimmed) return;
    sendMessage(trimmed);
    setComposerValue('');
  };

  const showHistoryDetail = viewMode === 'history';
  const conversationRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!conversationRef.current) return;
    conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
  }, [visibleMessages, liveAssistantText, showHistoryDetail]);

  return (
    <div className="h-full w-full bg-slate-950 text-white flex">
      <aside className="w-80 border-r border-white/10 bg-slate-900/40 backdrop-blur">
        <div className="px-5 py-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm text-white/70 uppercase tracking-[0.2em]">Agentic Chat</p>
              <p className="text-lg font-semibold">Workspace</p>
            </div>
          </div>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto h-[calc(100%-5rem)]">
          <div>
            <p className="text-xs uppercase text-white/40 mb-2">Agent Presets</p>
            <div className="space-y-3">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setActivePresetId(preset.id)}
                  className={cn(
                    'w-full text-left p-3 rounded-2xl border transition-all',
                    activePresetId === preset.id
                      ? 'border-indigo-400/70 bg-indigo-500/10 shadow-lg'
                      : 'border-white/5 hover:border-indigo-300/40 hover:bg-white/5'
                  )}
                >
                  <div className="flex items-center gap-3">
                    {preset.agent_avatar_url ? (
                      <img
                        src={preset.agent_avatar_url}
                        alt={preset.name}
                        className="w-10 h-10 rounded-xl border border-white/10 object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                        <Bot className="w-5 h-5 text-white/70" />
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold">{preset.name}</p>
                      <p className="text-xs text-white/60 line-clamp-2">
                        {preset.summary || 'Custom instructions loaded'}
                      </p>
                    </div>
                  </div>
                  {preset.tags && preset.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {preset.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="px-2 py-0.5 rounded-full bg-white/5 text-[11px] text-white/60 border border-white/10">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
              {presets.length === 0 && (
                <Card className="bg-slate-900/40 border-slate-800">
                  <p className="text-sm text-white/70">No presets available yet.</p>
                </Card>
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-white/5">
            <p className="text-xs uppercase text-white/40 mb-2 flex items-center gap-2">
              <History className="w-4 h-4" />
              Sessions
            </p>
            <div className="space-y-2">
              {historySessions.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setViewMode('history');
                    loadHistoricalSession(item.id);
                  }}
                  className={cn(
                    'w-full text-left p-3 rounded-2xl border transition',
                    selectedHistorySessionId === item.id && showHistoryDetail
                      ? 'border-emerald-300/70 bg-emerald-500/10'
                      : 'border-white/5 hover:border-emerald-200/40 hover:bg-white/5'
                  )}
                >
                  <p className="text-sm font-semibold text-white/90 truncate">
                    {presets.find((p) => p.id === item.agentPresetId)?.name || 'Preset'}
                  </p>
                  <p className="text-xs text-white/50 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatRelative(item.createdAt)}
                  </p>
                  <p className="text-[11px] text-white/40 mt-1">
                    {item.messageCount} messages · {item.toolCallCount} tool calls
                  </p>
                </button>
              ))}
              {historySessions.length === 0 && (
                <p className="text-sm text-white/50">No past chat sessions yet.</p>
              )}
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col">
        <div className="border-b border-white/10 bg-slate-900/60 backdrop-blur flex items-center justify-between px-8 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/40 mb-1">Realtime Agent</p>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">Agentic Chat Orchestrator</h1>
              <span className={cn('text-xs px-2 py-0.5 rounded-full border', isConnected ? 'border-emerald-300 text-emerald-200 bg-emerald-500/10' : 'border-white/20 text-white/60')}>
                {isConnected ? 'Live' : 'Idle'}
              </span>
            </div>
            {error && (
              <p className="text-sm text-rose-300 mt-1">{error}</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 rounded-full border border-white/10 px-3 py-2">
              <ShieldCheck className="w-4 h-4 text-emerald-300" />
              <span className="text-xs text-white/70">JWT protected widget-ready</span>
            </div>
            {session ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={endSession}
                disabled={isConnecting}
              >
                <Square className="w-4 h-4" />
                End Chat
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  setViewMode('current');
                  clearHistorySelection();
                  startSession();
                }}
                disabled={!activePresetId || isConnecting}
                loading={isConnecting}
              >
                <Play className="w-4 h-4" />
                Start Chat
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 grid grid-cols-3 gap-6 p-8 overflow-hidden">
          <Card className="col-span-2 flex flex-col bg-slate-900/40 border-white/5 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <div className="flex items-center gap-3">
                <MessageSquare className="w-5 h-5 text-indigo-200" />
                <div>
                  <p className="text-lg font-semibold">{showHistoryDetail ? 'Historical Session' : 'Live Conversation'}</p>
                  <p className="text-xs text-white/50">
                    {showHistoryDetail
                      ? 'Read-only transcript'
                      : session
                        ? `Session started ${formatRelative(session.createdAt)}`
                        : 'Start a session to chat with your agent'}
                  </p>
                </div>
              </div>
              {showHistoryDetail ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setViewMode('current');
                    clearHistorySelection();
                  }}
                >
                  Back to Live
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: isStreaming ? '#22d3ee' : '#475569' }} />
                  <span className="text-xs text-white/60">{isStreaming ? 'Streaming response…' : 'Standing by'}</span>
                </div>
              )}
            </div>

            <div ref={conversationRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {visibleMessages.length === 0 && !showHistoryDetail && (
                <div className="text-center text-white/50 py-16">
                  <p className="text-lg font-medium">Ask anything.</p>
                  <p className="text-sm text-white/40 mt-1">Your agent will orchestrate tools + reasoning to help.</p>
                </div>
              )}
              {visibleMessages.map((message) => (
                <ChatBubble key={message.id} message={message} />
              ))}
              {viewMode === 'current' && liveAssistantText && (
                <ChatBubble
                  message={{
                    id: 'live',
                    content: liveAssistantText,
                    sender: 'assistant',
                    sessionId: session?.id || '',
                    createdAt: new Date().toISOString(),
                    isStreaming: true
                  }}
                />
              )}
              {showHistoryDetail && isHistoryLoading && (
                <div className="flex items-center gap-2 text-white/70">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading transcript…
                </div>
              )}
              {showHistoryDetail && historyError && (
                <p className="text-sm text-rose-300">{historyError}</p>
              )}
            </div>

            {!showHistoryDetail && (
              <div className="border-t border-white/5 p-5">
                <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                  <textarea
                    rows={2}
                    value={composerValue}
                    onChange={(e) => setComposerValue(e.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        handleSend();
                      }
                    }}
                    disabled={!session || isConnecting}
                    placeholder={session ? 'Type your prompt…' : 'Start a chat session to begin'}
                    className="w-full bg-transparent text-sm text-white outline-none resize-none placeholder:text-white/40"
                  />
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2 text-xs text-white/50">
                      <Terminal className="w-3.5 h-3.5" />
                      Streaming via OpenAI Realtime
                    </div>
                    <Button
                      size="sm"
                      onClick={handleSend}
                      disabled={!session || !composerValue.trim()}
                    >
                      Send
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Card>

          <div className="flex flex-col gap-6 h-full overflow-hidden">
            <Card className="p-5 bg-slate-900/40 border-white/5 flex flex-col h-1/2">
              <div className="flex items-center gap-3 mb-4">
                <PlugZapIcon />
                <div>
                  <p className="font-semibold">Tool executions</p>
                  <p className="text-xs text-white/50">Every MCP + workflow call in this session</p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto space-y-3">
                {toolEvents.length === 0 ? (
                  <p className="text-sm text-white/50">No tools called yet.</p>
                ) : toolEvents.map((event) => (
                  <div
                    key={event.id}
                    className={cn(
                      'rounded-2xl border px-3 py-2',
                      event.status === 'failed'
                        ? 'border-rose-400/40 bg-rose-500/10'
                        : event.status === 'succeeded'
                        ? 'border-emerald-400/40 bg-emerald-500/10'
                        : 'border-white/5 bg-white/5'
                    )}
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-white/90">{event.toolName}</span>
                      <span className="text-xs text-white/50">{event.status}</span>
                    </div>
                    {event.error && (
                      <p className="text-xs text-rose-200 mt-1">{event.error}</p>
                    )}
                    {event.response && (
                      <p className="text-xs text-white/60 mt-1 truncate">
                        {JSON.stringify(event.response).slice(0, 80)}…
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 border-t border-white/5 pt-4">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.3em] text-white/40">
                  <span>Connected automations</span>
                  <span>{toolSummary.total}</span>
                </div>
                {toolSummary.total === 0 ? (
                  <p className="text-xs text-white/50 mt-2">No MCP or n8n tools configured for this preset.</p>
                ) : (
                  <>
                    <div className="flex gap-4 text-[11px] text-white/60 mt-3">
                      <span>MCP: {toolSummary.mcpCount}</span>
                      <span>n8n: {toolSummary.n8nCount}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {toolSummary.preview.map((tool) => (
                        <span
                          key={tool.name}
                          className={cn(
                            'px-2 py-1 rounded-full border text-[11px]',
                            tool.source === 'n8n'
                              ? 'border-amber-400/50 text-amber-200/90 bg-amber-500/10'
                              : 'border-white/10 text-white/70 bg-white/5'
                          )}
                        >
                          {tool.name}
                        </span>
                      ))}
                      {toolSummary.total > toolSummary.preview.length && (
                        <span className="text-[11px] text-white/60">
                          +{toolSummary.total - toolSummary.preview.length} more
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </Card>

            <Card className="p-5 bg-slate-900/40 border-white/5 h-1/2 flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
                  <BookOpenCheck className="w-5 h-5 text-slate-950" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">Knowledge grounding</p>
                  <p className="text-xs text-white/50">Latest retrieval context + citations</p>
                </div>
                {isRagLoading && <Loader2 className="w-4 h-4 text-white/70 animate-spin" />}
              </div>
              <div className="flex items-center justify-between text-xs text-white/60 mb-3">
                <span className={cn(
                  'px-2 py-0.5 rounded-full border text-[11px] uppercase tracking-[0.2em]',
                  ragInvoked
                    ? 'border-emerald-400/70 text-emerald-200'
                    : 'border-white/20 text-white/40'
                )}>
                  {ragInvoked ? 'RAG invoked' : 'RAG idle'}
                </span>
                {ragResult && (
                  <span className="text-[11px] text-white/40">
                    Updated {formatRelative(ragResult.createdAt)}
                  </span>
                )}
              </div>
              {ragError && (
                <p className="text-xs text-rose-300 mb-2">{ragError}</p>
              )}
              {ragResult ? (
                <div className="space-y-3 flex-1 overflow-y-auto">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-white/40 mb-1">Synthesized answer</p>
                    <p className="text-sm text-white/80 whitespace-pre-wrap">{ragResult.answer || 'No summary returned.'}</p>
                    {ragResult.guardrailTriggered && (
                      <p className="text-[11px] text-amber-300 mt-2">Guardrail enforced — insufficient citations.</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs uppercase text-white/40 mb-2">Citations</p>
                    <div className="space-y-2">
                      {ragResult.citations.length === 0 && (
                        <p className="text-xs text-white/50">No citations returned for the last turn.</p>
                      )}
                      {ragResult.citations.map((citation, index) => (
                        <div key={`${citation.file_id}-${index}`} className="rounded-xl border border-white/10 bg-black/20 p-3">
                          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-white/40 mb-1">
                            <span>Ref {index + 1}</span>
                            {citation.title && <span className="text-[10px] text-white/60 normal-case">{citation.title}</span>}
                          </div>
                          <p className="text-sm text-white/80">{citation.snippet}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-white/50">
                  Connect knowledge spaces to this agent to see retrieved snippets every time a user asks a question.
                </p>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.sender === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'rounded-2xl px-4 py-3 max-w-[80%] shadow',
          isUser
            ? 'bg-indigo-500 text-white rounded-br-sm'
            : 'bg-white/5 text-white rounded-bl-sm border border-white/10'
        )}
      >
        <div className="flex items-center gap-2 mb-1 text-xs text-white/60 uppercase tracking-[0.2em]">
          {isUser ? <UserRound className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
          <span>{isUser ? 'You' : 'Assistant'}</span>
          {message.isStreaming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        {message.toolName && (
          <p className="text-[11px] text-white/50 mt-2 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Tool: {message.toolName}
          </p>
        )}
      </div>
    </div>
  );
}

function PlugZapIcon() {
  return (
    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-pink-500 flex items-center justify-center">
      <Sparkles className="w-5 h-5 text-slate-950" />
    </div>
  );
}
