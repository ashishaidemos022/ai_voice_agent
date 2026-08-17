import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  BookOpenCheck,
  Clock,
  Cpu,
  DollarSign,
  Loader2,
  MessageSquare,
  Play,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  UserRound,
  Zap
} from 'lucide-react';
import { useChatAgent } from '../../hooks/useChatAgent';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui/Button';
import { containsRichContent } from '../ui/markdown-utils';
import { MessageContent } from '../ui/MessageContent';
import { Card } from '../ui/Card';
import { ChatMessage } from '../../types/chat';
import { cn } from '../../lib/utils';
import { AgentEmbedPanel } from './AgentEmbedPanel';
import { MainLayout } from '../layout/MainLayout';
import { Sidebar } from '../layout/Sidebar';
import { WorkspaceSidePanels } from '../layout/WorkspaceSidePanels';
import { ToolsList } from '../tools/ToolsList';
import { ToolExecutionFeed } from '../tools/ToolExecutionFeed';
import { TopBar } from '../layout/TopBar';
import { MCPPanel } from '../panels/MCPPanel';
import { N8NPanel } from '../panels/N8NPanel';
import { SettingsPanel } from '../panels/SettingsPanel';
import { configPresetToRealtimeConfig } from '../../lib/config-service';
import type { RealtimeConfig } from '../../types/voice-agent';
import { formatA2UIEventMessage, type A2UIEvent } from '../../lib/a2ui';
import { Badge } from '../ui/Badge';
import { CHAT_ROUTING_MODELS, type ChatRouteDecision, type ChatRoutingStrategy } from '../../../shared/model-routing';
import { OPENAI_MODELS, OPENAI_PRICING_EFFECTIVE_DATE } from '../../../shared/openai-models';

const MODEL_LABELS: Record<string, string> = {
  [OPENAI_MODELS.chat.nano]: 'GPT-5.4 Nano',
  [OPENAI_MODELS.chat.economy]: 'GPT-5.6 Luna',
  [OPENAI_MODELS.chat.mini]: 'GPT-5.4 Mini',
  [OPENAI_MODELS.chat.default]: 'GPT-5.6 Terra',
  [OPENAI_MODELS.chat.frontier]: 'GPT-5.6 Sol'
};

type SavedRoutingRun = {
  workflowKey: string;
  strategy: ChatRoutingStrategy;
  fixedModel?: string;
  costUsd: number;
  turns: number;
  models: Record<string, number>;
  savedAt: string;
};

const formatRouteCost = (value = 0) => value < 0.01 ? `$${value.toFixed(5)}` : `$${value.toFixed(3)}`;

function workflowFingerprint(turns: string[]): string {
  const value = turns.join('\u241e');
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${turns.length}:${(hash >>> 0).toString(16)}`;
}

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
  onNavigateVoiceLab?: () => void;
  onOpenKnowledgeBase?: () => void;
  onOpenCreateAgent?: () => void;
  onOpenSkills?: () => void;
  onOpenUsage?: () => void;
  onOpenEmbedUsage?: () => void;
};

export function ChatAgent({
  embedded = false,
  onNavigateVoice,
  onNavigateVoiceLab,
  onOpenKnowledgeBase,
  onOpenCreateAgent,
  onOpenSkills,
  onOpenUsage,
  onOpenEmbedUsage
}: ChatAgentProps) {
  const { vaUser, providerKeys, refreshProfile, signOut } = useAuth();
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
    refreshTools,
    routingStrategy,
    setRoutingStrategy,
    fixedModel,
    setFixedModel,
    currentRoute
  } = useChatAgent();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMCPPanelOpen, setIsMCPPanelOpen] = useState(false);
  const [isN8NPanelOpen, setIsN8NPanelOpen] = useState(false);
  const [chatConfig, setChatConfig] = useState<RealtimeConfig | null>(null);
  const [composerValue, setComposerValue] = useState('');
  const [viewMode, setViewMode] = useState<'current' | 'history'>('current');
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [savedRuns, setSavedRuns] = useState<SavedRoutingRun[]>(() => {
    try {
      return JSON.parse(window.localStorage.getItem('chat-routing-comparison-runs') || '[]');
    } catch {
      return [];
    }
  });
  const activePreset = useMemo(() => presets.find((p) => p.id === activePresetId), [presets, activePresetId]);
  const providerKeyId = activePreset?.provider_key_id || providerKeys[0]?.id || null;

  const visibleMessages = useMemo<ChatMessage[]>(() => {
    return viewMode === 'current' ? messages : historicalMessages;
  }, [messages, historicalMessages, viewMode]);
  const a2uiEnabled = Boolean(activePreset?.a2ui_enabled);
  const routingReceipt = useMemo(() => {
    const routes = visibleMessages
      .map((message) => message.raw?.routing)
      .filter((route): route is ChatRouteDecision => Boolean(route));
    const models = routes.reduce<Record<string, number>>((counts, route) => {
      counts[route.model] = (counts[route.model] || 0) + 1;
      return counts;
    }, {});
    const userTurns = visibleMessages
      .filter((message) => message.sender === 'user')
      .map((message) => message.content.trim());
    return {
      costUsd: routes.reduce((sum, route) => sum + (route.routerCostUsd || 0) + (route.answerCostUsd || 0) + (route.ragCostUsd || 0), 0),
      routerCostUsd: routes.reduce((sum, route) => sum + (route.routerCostUsd || 0), 0),
      answerCostUsd: routes.reduce((sum, route) => sum + (route.answerCostUsd || 0), 0),
      ragCostUsd: routes.reduce((sum, route) => sum + (route.ragCostUsd || 0), 0),
      turns: routes.length,
      models,
      routes,
      workflowKey: userTurns.length ? workflowFingerprint(userTurns) : ''
    };
  }, [visibleMessages]);
  const comparisonRun = useMemo(() => savedRuns
    .filter((run) => run.workflowKey && run.workflowKey === routingReceipt.workflowKey && run.strategy !== routingStrategy)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0], [routingReceipt.workflowKey, routingStrategy, savedRuns]);

  const handleEndSession = useCallback(() => {
    if (routingReceipt.turns > 0 && routingReceipt.workflowKey) {
      const nextRun: SavedRoutingRun = {
        workflowKey: routingReceipt.workflowKey,
        strategy: routingStrategy,
        fixedModel: routingStrategy === 'fixed' ? fixedModel : undefined,
        costUsd: routingReceipt.costUsd,
        turns: routingReceipt.turns,
        models: routingReceipt.models,
        savedAt: new Date().toISOString()
      };
      const next = [nextRun, ...savedRuns].slice(0, 12);
      setSavedRuns(next);
      window.localStorage.setItem('chat-routing-comparison-runs', JSON.stringify(next));
    }
    void endSession();
  }, [endSession, fixedModel, routingReceipt, routingStrategy, savedRuns]);

  const handleA2UIEvent = useCallback((event: A2UIEvent) => {
    void sendMessage(formatA2UIEventMessage(event));
  }, [sendMessage]);

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
  const shouldFollowConversationRef = useRef(true);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = conversationRef.current;
    if (!container) return;
    const resolvedBehavior = behavior === 'smooth' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : behavior;
    shouldFollowConversationRef.current = true;
    setShowJumpToLatest(false);
    container.scrollTo({ top: container.scrollHeight, behavior: resolvedBehavior });
  }, []);

  const handleConversationScroll = useCallback(() => {
    const container = conversationRef.current;
    if (!container) return;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 96;
    shouldFollowConversationRef.current = isNearBottom;
    setShowJumpToLatest(!isNearBottom);
  }, []);

  useEffect(() => {
    if (!shouldFollowConversationRef.current) return;
    const frame = window.requestAnimationFrame(() => scrollToLatest('auto'));
    return () => window.cancelAnimationFrame(frame);
  }, [visibleMessages, liveAssistantText, showHistoryDetail, scrollToLatest]);

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
              onClick={handleEndSession}
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

      <div className="flex-1 grid grid-cols-1 2xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] gap-6 p-4 lg:p-8 min-h-0 overflow-y-auto 2xl:overflow-hidden">
        <div className="flex flex-col gap-6 min-h-[720px] 2xl:min-h-0 2xl:overflow-hidden">
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
              <div className="pt-4 mt-4 border-t border-white/10">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-white/40">Model strategy</p>
                    <p className="text-sm text-white/70 mt-1">Lock one model or route every turn by task.</p>
                  </div>
                  <Badge variant={routingStrategy === 'auto' ? 'success' : 'warning'}>
                    {routingStrategy === 'auto' ? <Zap className="w-3 h-3" /> : <Cpu className="w-3 h-3" />}
                    {routingStrategy === 'auto' ? 'Auto' : 'Fixed'}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {(['auto', 'fixed'] as const).map((strategy) => (
                    <button
                      key={strategy}
                      type="button"
                      disabled={Boolean(session)}
                      onClick={() => setRoutingStrategy(strategy)}
                      className={cn(
                        'rounded-xl border px-3 py-2 text-sm transition disabled:opacity-50',
                        routingStrategy === strategy
                          ? 'border-cyan-300 bg-cyan-500/15 text-cyan-100'
                          : 'border-white/10 bg-black/20 text-white/60 hover:border-white/30'
                      )}
                    >
                      {strategy === 'auto' ? 'Auto route' : 'Fixed model'}
                    </button>
                  ))}
                </div>
                {routingStrategy === 'fixed' ? (
                  <select
                    value={fixedModel}
                    disabled={Boolean(session)}
                    onChange={(event) => setFixedModel(event.target.value as typeof fixedModel)}
                    className="w-full mt-3 rounded-xl bg-slate-950 border border-white/10 text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/60 disabled:opacity-50"
                  >
                    {CHAT_ROUTING_MODELS.map((model) => (
                      <option key={model} value={model}>{MODEL_LABELS[model]}</option>
                    ))}
                  </select>
                ) : (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {CHAT_ROUTING_MODELS.map((model) => (
                      <span key={model} className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white/55">
                        {MODEL_LABELS[model].replace('GPT-', '')}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card className="relative flex-1 flex flex-col bg-slate-900/40 border-white/5 overflow-hidden">
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
                  {currentRoute && isStreaming && (
                    <Badge variant="secondary">Routing to {MODEL_LABELS[currentRoute.model] || currentRoute.model}</Badge>
                  )}
                </div>
              )}
            </div>

            <div
              ref={conversationRef}
              onScroll={handleConversationScroll}
              role="log"
              aria-label={showHistoryDetail ? 'Historical conversation' : 'Live conversation'}
              aria-live={showHistoryDetail ? 'off' : 'polite'}
              aria-relevant="additions text"
              aria-busy={isStreaming}
              className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
            >
              {visibleMessages.length === 0 && !showHistoryDetail && (
                <div className="text-center text-white/50 py-16">
                  <p className="text-lg font-medium">Ask anything.</p>
                  <p className="text-sm text-white/40 mt-1">Your agent will orchestrate tools + reasoning to help.</p>
                </div>
              )}
              {visibleMessages.map((message) => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  a2uiEnabled={a2uiEnabled}
                  onA2UIEvent={handleA2UIEvent}
                />
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
                  a2uiEnabled={a2uiEnabled}
                  onA2UIEvent={handleA2UIEvent}
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

            {showJumpToLatest && (
              <button
                type="button"
                onClick={() => scrollToLatest()}
                className="absolute bottom-28 right-8 z-20 rounded-full border border-white/15 bg-slate-900/95 px-3 py-2 text-xs text-white shadow-lg backdrop-blur hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                Jump to latest
              </button>
            )}

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
                      Responses API · {routingStrategy === 'auto' ? 'dynamic routing' : MODEL_LABELS[fixedModel]}
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
          <Card className="p-5 bg-slate-900/40 border-white/5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-white/40">Conversation receipt</p>
                <p className="text-lg font-semibold text-white mt-1">Routing decisions & cost</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={routingStrategy === 'auto' ? 'success' : 'warning'}>
                  {routingStrategy === 'auto' ? <Zap className="w-3 h-3" /> : <Cpu className="w-3 h-3" />}
                  {routingStrategy === 'auto' ? 'Auto active' : `Fixed · ${MODEL_LABELS[fixedModel]?.replace('GPT-', '')}`}
                </Badge>
                <DollarSign className="w-5 h-5 text-emerald-300" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <div className="col-span-3 rounded-xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">Current run</p>
                <p className="text-2xl font-semibold text-white mt-1">{formatRouteCost(routingReceipt.costUsd)}</p>
                <p className="text-xs text-white/45 mt-1">{routingReceipt.turns} completed turns</p>
                <p className="text-[10px] text-white/35 mt-1">Estimated OpenAI API cost · standard processing · rates checked {OPENAI_PRICING_EFFECTIVE_DATE}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">Answer</p>
                <p className="text-sm font-semibold text-white mt-1">{formatRouteCost(routingReceipt.answerCostUsd)}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">Router overhead</p>
                <div className="flex items-end justify-between gap-2 mt-1">
                  <p className="text-sm font-semibold text-white">{formatRouteCost(routingReceipt.routerCostUsd)}</p>
                  <p className="text-[10px] text-white/40">included in total</p>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">Knowledge retrieval</p>
                <p className="text-sm font-semibold text-white mt-1">{formatRouteCost(routingReceipt.ragCostUsd)}</p>
                <p className="text-[10px] text-white/40 mt-1">model + file search</p>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">Model mix</p>
                <span className="text-[10px] text-white/35">chat-router-v1</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
              {Object.entries(routingReceipt.models).map(([model, count]) => (
                <span key={model} className="rounded-full border border-cyan-400/20 bg-cyan-500/5 px-2 py-1 text-[10px] text-cyan-100/80">
                  {MODEL_LABELS[model] || model} × {count}
                </span>
              ))}
              </div>
              {!routingReceipt.turns && <p className="text-xs text-white/45">Complete a turn to see model mix and cost.</p>}
            </div>
            {routingReceipt.routes.length > 0 && (
              <div className="mt-4 border-t border-white/10 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">Decision ledger</p>
                  <span className="text-[10px] text-white/35">one model per turn</span>
                </div>
                <div className="space-y-2">
                  {routingReceipt.routes.map((route, index) => (
                    <details key={route.turnId || index} className="group rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                      <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={cn(
                            'w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[10px] font-semibold border',
                            route.model === OPENAI_MODELS.chat.frontier
                              ? 'border-fuchsia-300/40 bg-fuchsia-500/10 text-fuchsia-200'
                              : route.model === OPENAI_MODELS.chat.default
                                ? 'border-indigo-300/40 bg-indigo-500/10 text-indigo-200'
                                : 'border-emerald-300/30 bg-emerald-500/10 text-emerald-200'
                          )}>{index + 1}</span>
                          <div className="min-w-0">
                            <p className="text-xs text-white/85 truncate">{MODEL_LABELS[route.model] || route.model}</p>
                            <p className="text-[10px] text-white/40 capitalize truncate">{route.taskType.replace(/_/g, ' ')} · {route.reasoningEffort} reasoning</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-emerald-200">{formatRouteCost((route.routerCostUsd || 0) + (route.answerCostUsd || 0) + (route.ragCostUsd || 0))}</p>
                          <p className="text-[10px] text-white/35">{route.answerLatencyMs || 0}ms</p>
                        </div>
                      </summary>
                      <div className="mt-2 pt-2 border-t border-white/10 text-[11px] text-white/55">
                        <p>{route.reason}</p>
                        <div className="flex justify-between mt-2 text-white/40">
                          <span>Confidence {Math.round(route.confidence * 100)}%</span>
                          <span>Router {formatRouteCost(route.routerCostUsd)}</span>
                          {(route.ragCostUsd || 0) > 0 && <span>Retrieval {formatRouteCost(route.ragCostUsd)}</span>}
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            )}
            {comparisonRun && routingReceipt.turns === comparisonRun.turns && (
              <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-200/70">Actual matched conversation</p>
                <div className="flex items-end justify-between mt-2">
                  <div>
                    <p className="text-xs text-white/50">
                      Previous {comparisonRun.strategy === 'fixed'
                        ? `fixed ${MODEL_LABELS[comparisonRun.fixedModel || OPENAI_MODELS.chat.frontier]?.replace('GPT-', '')}`
                        : 'auto'} run
                    </p>
                    <p className="text-lg font-semibold text-white">{formatRouteCost(comparisonRun.costUsd)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-white/50">Current {routingStrategy} run</p>
                    <p className="text-lg font-semibold text-emerald-200">{formatRouteCost(routingReceipt.costUsd)}</p>
                  </div>
                </div>
                <p className="text-xs text-emerald-100/80 mt-2">
                  {comparisonRun.costUsd > routingReceipt.costUsd
                    ? `${Math.round((1 - routingReceipt.costUsd / comparisonRun.costUsd) * 100)}% lower cost across the same user turns.`
                    : 'The current run did not reduce cost for this workflow.'}
                </p>
                <p className="text-[10px] text-white/40 mt-1">Compare the two transcripts to confirm outcome parity.</p>
              </div>
            )}
          </Card>

          <ToolExecutionFeed
            events={toolEvents}
            toolSummary={toolSummary}
            className="bg-slate-900/40"
            headerCopy="Every MCP + workflow call in this session"
          />

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
      onNavigateVoiceLab={onNavigateVoiceLab}
      onNavigateSkills={onOpenSkills}
      onOpenKnowledgeBase={onOpenKnowledgeBase}
      onOpenUsage={onOpenUsage}
      onOpenEmbedUsage={onOpenEmbedUsage}
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
      onEndSession={handleEndSession}
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
          onProfileRefresh={refreshProfile}
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

function ChatBubble({ message, a2uiEnabled, onA2UIEvent }: {
  message: ChatMessage;
  a2uiEnabled: boolean;
  onA2UIEvent: (event: A2UIEvent) => void;
}) {
  const isUser = message.sender === 'user';
  const isRich = !isUser && containsRichContent(message.content);
  const route = message.raw?.routing;
  return (
    <div className={cn('flex min-w-0', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'min-w-0 rounded-2xl px-4 py-3 shadow',
          isRich ? 'w-full max-w-[56rem]' : 'max-w-[80%]',
          isUser
            ? 'bg-indigo-500 text-white rounded-br-sm'
            : 'bg-white/5 text-white rounded-bl-sm border border-white/10'
        )}
      >
        <div className="flex items-center gap-2 mb-1 text-xs text-white/60 uppercase tracking-[0.2em]">
          {isUser ? <UserRound className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
          <span>{isUser ? 'You' : 'Assistant'}</span>
          {message.isStreaming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {route && (
            <Badge variant={route.strategy === 'auto' ? 'success' : 'warning'} className="normal-case tracking-normal">
              {route.strategy === 'auto' ? 'Auto' : 'Fixed'} · {MODEL_LABELS[route.model] || route.model}
            </Badge>
          )}
        </div>
        <MessageContent
          content={message.content}
          role={message.sender}
          a2uiEnabled={a2uiEnabled}
          onA2UIEvent={onA2UIEvent}
          richContent={message.raw?.content}
        />
        {message.toolName && (
          <p className="text-[11px] text-white/50 mt-2 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Tool: {message.toolName}
          </p>
        )}
        {route && (
          <details className="mt-3 border-t border-white/10 pt-2 text-xs text-white/55">
            <summary className="cursor-pointer text-cyan-200/80 hover:text-cyan-100">
              Model decision receipt · {formatRouteCost((route.routerCostUsd || 0) + (route.answerCostUsd || 0) + (route.ragCostUsd || 0))}
            </summary>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
              <span>Selected model</span><span className="text-white/80">{MODEL_LABELS[route.model] || route.model}</span>
              <span>Task</span><span className="text-white/80">{route.taskType.replace(/_/g, ' ')}</span>
              <span>Reasoning</span><span className="text-white/80">{route.reasoningEffort}</span>
              <span>Confidence</span><span className="text-white/80">{Math.round(route.confidence * 100)}%</span>
              <span>Response time</span><span className="text-white/80">{route.answerLatencyMs || 0}ms</span>
              <span>Answer cost</span><span className="text-white/80">{formatRouteCost(route.answerCostUsd)}</span>
              <span>Router overhead</span><span className="text-white/80">{formatRouteCost(route.routerCostUsd)}</span>
              {(route.ragCostUsd || 0) > 0 && <><span>Knowledge retrieval</span><span className="text-white/80">{formatRouteCost(route.ragCostUsd)}</span></>}
            </div>
            <p className="mt-2 text-white/65">{route.reason}</p>
          </details>
        )}
      </div>
    </div>
  );
}
