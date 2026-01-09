import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  BookOpenCheck,
  Clock,
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
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ChatMessage } from '../../types/chat';
import { cn } from '../../lib/utils';
import { AgentEmbedPanel } from './AgentEmbedPanel';
import { MainLayout } from '../layout/MainLayout';
import { Sidebar } from '../layout/Sidebar';
import { WorkspaceSidePanels } from '../layout/WorkspaceSidePanels';
import { ToolsList } from '../tools/ToolsList';
import { TopBar } from '../layout/TopBar';
import { MCPPanel } from '../panels/MCPPanel';
import { N8NPanel } from '../panels/N8NPanel';
import { SettingsPanel } from '../panels/SettingsPanel';
import { configPresetToRealtimeConfig } from '../../lib/config-service';
import type { RealtimeConfig } from '../../types/voice-agent';

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

type ChatAgentProps = {
  embedded?: boolean;
  onNavigateVoice?: () => void;
  onOpenKnowledgeBase?: () => void;
  onOpenCreateAgent?: () => void;
  onOpenSkills?: () => void;
  onOpenUsage?: () => void;
};

export function ChatAgent({
  embedded = false,
  onNavigateVoice,
  onOpenKnowledgeBase,
  onOpenCreateAgent,
  onOpenSkills,
  onOpenUsage
}: ChatAgentProps) {
  const { vaUser, providerKeys, signOut } = useAuth();
  const {
    presets,
    activePresetId,
    setActivePresetId,
    refreshPresets,
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
    isRagLoading,
    refreshTools
  } = useChatAgent();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMCPPanelOpen, setIsMCPPanelOpen] = useState(false);
  const [isN8NPanelOpen, setIsN8NPanelOpen] = useState(false);
  const [chatConfig, setChatConfig] = useState<RealtimeConfig | null>(null);
  const [composerValue, setComposerValue] = useState('');
  const [viewMode, setViewMode] = useState<'current' | 'history'>('current');
  const activePreset = useMemo(() => presets.find((p) => p.id === activePresetId), [presets, activePresetId]);
  const providerKeyId = activePreset?.provider_key_id || providerKeys[0]?.id || null;

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

  useEffect(() => {
    if (!activePreset) {
      setChatConfig(null);
      return;
    }
    setChatConfig(configPresetToRealtimeConfig(activePreset));
  }, [activePreset]);

  const mainContent = (
    <div className="flex-1 flex flex-col min-h-0 relative z-10">
      <div className="border-b border-white/10 bg-slate-900/60 backdrop-blur flex items-center justify-between px-8 py-5">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40 mb-1">Workspace View</p>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold font-display">Agentic Chat Runtime</h1>
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

      <div className="flex-1 grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6 p-8 min-h-0 overflow-hidden">
        <div className="flex flex-col gap-6 min-h-0 overflow-hidden">
          <Card className="p-5 bg-slate-900/40 border-white/5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Agent preset</p>
                <p className="text-lg font-semibold text-white">Choose a chat preset</p>
              </div>
              {activePreset && (
                <span className="text-[11px] uppercase tracking-[0.2em] border border-cyan-400/40 text-cyan-200 bg-cyan-500/10 px-2 py-1 rounded-full">
                  Active
                </span>
              )}
            </div>
            <div className="mt-4 space-y-2">
              <select
                value={activePresetId || ''}
                onChange={(event) => setActivePresetId(event.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-white/10 text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-300"
              >
                <option value="" disabled>
                  Select a preset
                </option>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-white/50">
                {activePreset?.summary || 'Select a preset to load its instructions and tool set.'}
              </p>
            </div>
          </Card>

          <Card className="flex-1 flex flex-col bg-slate-900/40 border-white/5 overflow-hidden">
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
        </div>

        <div className="flex flex-col gap-6 min-h-0 overflow-y-auto pr-1">
          <Card className="p-5 bg-slate-900/40 border-white/5 flex flex-col">
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

          <Card className="p-5 bg-slate-900/40 border-white/5 flex flex-col">
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

          <AgentEmbedPanel
            agentConfigId={activePresetId}
            agentName={activePreset?.name}
          />
        </div>
      </div>
    </div>
  );

  const historyContent = (
    <div className="space-y-2 p-3">
      {historyError && (
        <p className="text-xs text-rose-300">{historyError}</p>
      )}
      {isHistoryLoading && showHistoryDetail && (
        <div className="flex items-center gap-2 text-xs text-white/60">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading session…
        </div>
      )}
      {historySessions.map((item) => (
        <button
          key={item.id}
          onClick={() => {
            setViewMode('history');
            loadHistoricalSession(item.id);
          }}
          className={cn(
            'w-full text-left p-3 rounded-xl border transition',
            selectedHistorySessionId === item.id && showHistoryDetail
              ? 'border-emerald-300/70 bg-emerald-500/10'
              : 'border-white/5 hover:border-emerald-200/40 hover:bg-white/5'
          )}
        >
          <p className="text-sm font-semibold text-white/90 truncate">
            {presets.find((preset) => preset.id === item.agentPresetId)?.name || 'Preset'}
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
        <p className="text-xs text-white/50">No past chat sessions yet.</p>
      )}
    </div>
  );

  if (embedded) {
    return (
      <div className="h-full w-full bg-slate-950 text-white flex relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.08),_transparent_45%),radial-gradient(circle_at_80%_80%,_rgba(59,130,246,0.12),_transparent_55%)]" />
        {mainContent}
      </div>
    );
  }

  const sidebar = (
    <Sidebar
      isConnected={isConnected}
      activeNav="chat"
      onNavigateVoice={onNavigateVoice}
      onNavigateChat={() => setViewMode('current')}
      onNavigateSkills={onOpenSkills}
      onOpenKnowledgeBase={onOpenKnowledgeBase}
      onOpenUsage={onOpenUsage}
      onOpenSettings={onOpenCreateAgent}
    />
  );

  const topBar = (
    <TopBar
      isInitialized={Boolean(session)}
      activeConfigName={activePreset?.name}
      onSettingsClick={() => setIsSettingsOpen(true)}
      onMCPClick={() => setIsMCPPanelOpen(true)}
      onIntegrationsClick={() => setIsN8NPanelOpen(true)}
      onEndSession={endSession}
      viewMode={viewMode}
      onBackToCurrent={() => {
        setViewMode('current');
        clearHistorySelection();
      }}
      onSignOut={signOut}
      userEmail={vaUser?.email}
    />
  );

  return (
    <MainLayout sidebar={sidebar} topBar={topBar}>
      <div className="flex h-full overflow-hidden">
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {mainContent}
        </div>
        <WorkspaceSidePanels
          toolsCount={availableTools.length}
          historyCount={historySessions.length}
          toolsContent={<ToolsList mcpTools={availableTools} />}
          historyContent={historyContent}
        />
      </div>
      {chatConfig && (
        <SettingsPanel
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          config={chatConfig}
          onConfigChange={setChatConfig}
          activeConfigId={activePresetId}
          onActiveConfigChange={(configId) => {
            if (configId) {
              setActivePresetId(configId);
              setViewMode('current');
              clearHistorySelection();
            }
          }}
          userId={vaUser?.id || ''}
          providerKeyId={providerKeyId}
          onPresetsRefresh={refreshPresets}
          onToolsChanged={refreshTools}
        />
      )}
      <MCPPanel
        isOpen={isMCPPanelOpen}
        onClose={() => setIsMCPPanelOpen(false)}
        onConnectionsChanged={refreshTools}
      />
      <N8NPanel
        isOpen={isN8NPanelOpen}
        onClose={() => setIsN8NPanelOpen(false)}
        configId={activePresetId}
        onIntegrationsChanged={refreshTools}
      />
    </MainLayout>
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
