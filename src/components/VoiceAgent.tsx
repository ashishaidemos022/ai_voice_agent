import { useState, useEffect, useCallback, useRef } from 'react';
import { useVoiceAgent } from '../hooks/useVoiceAgent';
import { RealtimeConfig, Message } from '../types/voice-agent';
import { loadMCPTools, mcpTools } from '../lib/tools-registry';
import { configPresetToRealtimeConfig, getAllConfigPresets, AgentConfigPreset } from '../lib/config-service';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useAgentState } from '../state/agentState';
import { BookOpenCheck, Loader2, Sparkles } from 'lucide-react';

import { MainLayout } from './layout/MainLayout';
import { Sidebar } from './layout/Sidebar';
import { TopBar } from './layout/TopBar';
import { VoiceInteractionArea } from './voice/VoiceInteractionArea';
import { ConversationThread } from './conversation/ConversationThread';
import { ToolsList } from './tools/ToolsList';
import { SettingsPanel } from './panels/SettingsPanel';
import { MCPPanel } from './panels/MCPPanel';
import { N8NPanel } from './panels/N8NPanel';
import { Card } from './ui/Card';
import { WelcomeHero } from './welcome/WelcomeHero';
import { StartSessionButton } from './welcome/StartSessionButton';
import { cn } from '../lib/utils';

const defaultConfig: RealtimeConfig = {
  model: 'gpt-realtime',
  voice: 'alloy',
  instructions: 'You are a helpful AI voice assistant. You can help users with various tasks, answer questions, and execute tools when needed. Be conversational and friendly.',
  temperature: 0.8,
  max_response_output_tokens: 4096,
  turn_detection: {
    type: 'server_vad',
    threshold: 0.75,
    prefix_padding_ms: 150,
    silence_duration_ms: 700
  }
};

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

function mergeRealtimeConfig(prev: RealtimeConfig | null, next: RealtimeConfig): RealtimeConfig {
  const fallback = prev ?? next;
  return {
    ...fallback,
    ...next,
    rag_enabled: next.rag_enabled ?? fallback?.rag_enabled ?? false,
    rag_mode: next.rag_mode ?? fallback?.rag_mode,
    rag_default_model: next.rag_default_model ?? fallback?.rag_default_model ?? null,
    knowledge_vector_store_ids: next.knowledge_vector_store_ids ?? fallback?.knowledge_vector_store_ids,
    knowledge_space_ids: next.knowledge_space_ids ?? fallback?.knowledge_space_ids
  };
}

export function VoiceAgent() {
  const { vaUser, providerKeys, signOut } = useAuth();
  const {
    activeConfigId: persistedConfigId,
    setActiveConfigId: persistActiveConfigId,
    preferredModel,
    preferredVoice,
    setPreferredModel,
    setPreferredVoice,
    activePanel,
    setActivePanel
  } = useAgentState((state) => ({
    activeConfigId: state.activeConfigId,
    setActiveConfigId: state.setActiveConfigId,
    preferredModel: state.preferredModel,
    preferredVoice: state.preferredVoice,
    setPreferredModel: state.setPreferredModel,
    setPreferredVoice: state.setPreferredVoice,
    activePanel: state.activePanel,
    setActivePanel: state.setActivePanel
  }));
  const [isSettingsOpen, setIsSettingsOpen] = useState(activePanel === 'settings');
  const [isMCPPanelOpen, setIsMCPPanelOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('va-mcp-panel-open') === 'true';
  });
  const [isN8NPanelOpen, setIsN8NPanelOpen] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isSwitchingPreset, setIsSwitchingPreset] = useState(false);
  const [toolsCount, setToolsCount] = useState(0);
  const [currentConfig, setCurrentConfig] = useState<RealtimeConfig>(() => ({
    ...defaultConfig,
    model: preferredModel || defaultConfig.model,
    voice: preferredVoice || defaultConfig.voice
  }));
  const [activeConfigName, setActiveConfigName] = useState<string | undefined>();
  const [viewMode, setViewMode] = useState<'current' | 'history'>(activePanel === 'logs' ? 'history' : 'current');
  const [selectedHistoricalSessionId, setSelectedHistoricalSessionId] = useState<string | undefined>();
  const [historicalMessages, setHistoricalMessages] = useState<Message[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [pendingConfigId, setPendingConfigId] = useState<string | null>(persistedConfigId);
  const [presets, setPresets] = useState<AgentConfigPreset[]>([]);
  const [isWorkspaceView, setIsWorkspaceView] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('va-workspace-view') === 'true';
  });
  const resumeSessionRef = useRef<{ config: RealtimeConfig; presetId: string | null } | null>(null);
  const applyPreferencesToConfig = useCallback((baseConfig: RealtimeConfig) => {
    const nextConfig = { ...baseConfig };
    if (preferredModel) {
      nextConfig.model = preferredModel;
    }
    if (preferredVoice) {
      nextConfig.voice = preferredVoice;
    }
    return nextConfig;
  }, [preferredModel, preferredVoice]);
  const rememberSessionConfig = useCallback((sessionConfig: RealtimeConfig, presetId: string | null) => {
    resumeSessionRef.current = { config: sessionConfig, presetId };
  }, []);
  const clearRememberedSession = useCallback(() => {
    resumeSessionRef.current = null;
  }, []);
  const availableTools = mcpTools;
  const toolSummary = {
    total: availableTools.length,
    mcpCount: availableTools.filter(tool => tool.source !== 'n8n').length,
    n8nCount: availableTools.filter(tool => tool.source === 'n8n').length,
    preview: availableTools.slice(0, 6)
  };

  const {
    isConnected,
    isRecording,
    messages,
    waveformData,
    volume,
    sessionId,
    isProcessing,
    config,
    error,
    agentState,
    liveUserTranscript,
    liveAssistantTranscript,
    activeConfigId,
    toolEvents,
    ragResult,
    ragInvoked,
    ragError,
    isRagLoading,
    setConfig,
    setActiveConfig,
    initialize,
    toggleRecording,
    cleanup
  } = useVoiceAgent();

  const handleStart = useCallback(async (override?: { config: RealtimeConfig; presetId: string | null }) => {
    if (isInitializing) return;
    const configToUse = override?.config ?? currentConfig;
    const presetIdToUse = override?.presetId ?? pendingConfigId;
    if (!presetIdToUse) {
      console.warn('Attempted to start voice agent without a preset');
      return;
    }

    console.log('[VoiceAgent] handleStart', {
      presetId: presetIdToUse,
      overrideProvided: !!override,
      viewMode
    });
    setIsInitializing(true);
    try {
      await initialize(configToUse, presetIdToUse);
      rememberSessionConfig(configToUse, presetIdToUse);
      setIsInitialized(true);
      setIsWorkspaceView(true);
    } catch (error) {
      console.error('Initialization error:', error);
    } finally {
      setIsInitializing(false);
    }
  }, [currentConfig, pendingConfigId, initialize, rememberSessionConfig, isInitializing]);

  const handleEnd = useCallback(async () => {
    console.log('[VoiceAgent] handleEnd invoked, cleaning up session');
    clearRememberedSession();
    await cleanup();
    setIsInitialized(false);
    setViewMode('current');
    setSelectedHistoricalSessionId(undefined);
    setHistoricalMessages([]);
  }, [cleanup, clearRememberedSession]);

  const verifySessionHasMessages = async (sessionId: string): Promise<number> => {
    try {
      const { count, error } = await supabase
        .from('va_messages')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', sessionId);

      if (error) {
        console.error('❌ Error checking message count:', error);
        return 0;
      }

      console.log(`📊 Session ${sessionId} has ${count} messages in database`);
      return count || 0;
    } catch (error) {
      console.error('❌ Exception checking message count:', error);
      return 0;
    }
  };

  const handleSessionSelect = useCallback(async (sessionId: string, retryCount = 0) => {
    console.log('🔍 Session selected:', sessionId, 'Retry attempt:', retryCount);
    console.log('📊 Current state before load:', {
      viewMode,
      selectedHistoricalSessionId,
      historicalMessagesCount: historicalMessages.length
    });

    setIsLoadingHistory(true);
    setHistoryError(null);
    setHistoricalMessages([]);
    setSelectedHistoricalSessionId(sessionId);
    setViewMode('history');

    try {
      const messageCount = await verifySessionHasMessages(sessionId);
      console.log(`📋 Verification: Session should have ${messageCount} messages`);

      if (messageCount === 0) {
        console.warn('⚠️ Session has no messages in database');
        setHistoricalMessages([]);
        setIsLoadingHistory(false);
        return;
      }

      console.log('📥 Fetching messages for session:', sessionId);
      console.log('🔍 Query details: table=va_messages, filter=session_id=', sessionId);

      const { data, error } = await supabase
        .from('va_messages')
        .select('id, session_id, role, content, audio_metadata, timestamp, tool_calls')
        .eq('session_id', sessionId)
        .order('timestamp', { ascending: true });

      console.log('📦 Raw Supabase response:', {
        dataLength: data?.length || 0,
        hasError: !!error,
        errorMessage: error?.message
      });

      if (error) {
        console.error('❌ Supabase query error:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        });

        if (retryCount < 2) {
          console.log(`🔄 Retrying query (attempt ${retryCount + 1})...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return handleSessionSelect(sessionId, retryCount + 1);
        }

        setHistoryError(`Failed to load messages after ${retryCount + 1} attempts: ${error.message}`);
        setHistoricalMessages([]);
        return;
      }

      if (!data) {
        console.warn('⚠️ Query returned null data');
        setHistoricalMessages([]);
        return;
      }

      console.log(`✅ Retrieved ${data.length} messages from database (expected ${messageCount})`);

      if (data.length !== messageCount) {
        console.warn(`⚠️ Message count mismatch! Expected ${messageCount}, got ${data.length}`);
      }

      if (data.length > 0) {
        console.log('📋 First message sample:', JSON.stringify(data[0], null, 2));
        console.log('📋 Last message sample:', JSON.stringify(data[data.length - 1], null, 2));
      }

      const messages = data.map((msg, index) => {
        try {
          const transformed = {
            id: msg.id,
            session_id: msg.session_id,
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content || '',
            audio_metadata: msg.audio_metadata || {},
            timestamp: msg.timestamp,
            tool_calls: Array.isArray(msg.tool_calls) ? msg.tool_calls : []
          };
          console.log(`✅ Transformed message ${index + 1}/${data.length}:`, {
            id: transformed.id,
            role: transformed.role,
            contentLength: transformed.content.length,
            hasToolCalls: transformed.tool_calls.length > 0
          });
          return transformed;
        } catch (err) {
          console.error(`❌ Error transforming message ${index}:`, err, msg);
          throw err;
        }
      });

      console.log('✅ Successfully transformed all messages:', messages.length);
      console.log('📊 Message roles breakdown:', {
        user: messages.filter(m => m.role === 'user').length,
        assistant: messages.filter(m => m.role === 'assistant').length,
        system: messages.filter(m => m.role === 'system').length
      });

      setIsLoadingHistory(false);
      setHistoricalMessages(messages);
      console.log('✅ State updated with historical messages');
      console.log('📊 Final state check:', {
        historicalMessagesLength: messages.length,
        isLoadingHistory: false,
        viewMode: 'history'
      });
    } catch (error: any) {
      console.error('❌ Exception during message loading:', {
        error,
        message: error.message,
        stack: error.stack
      });
      setIsLoadingHistory(false);
      setHistoryError(`Error: ${error.message || 'Unknown error'}`);
      setHistoricalMessages([]);
      console.log('❌ Loading failed, state reset');
    }
  }, [viewMode, selectedHistoricalSessionId, historicalMessages.length]);

  const handleBackToCurrent = () => {
    console.log('⬅️ Returning to current session');
    setViewMode('current');
    setSelectedHistoricalSessionId(undefined);
    setHistoricalMessages([]);
    setHistoryError(null);
    setIsLoadingHistory(false);
  };

  const updateToolsCount = () => {
    setToolsCount(mcpTools.length);
  };

  const refreshTools = useCallback(async () => {
    const targetConfigId = isInitialized
      ? activeConfigId
      : (pendingConfigId || persistedConfigId);
    await loadMCPTools(targetConfigId || undefined);
    updateToolsCount();
  }, [isInitialized, activeConfigId, pendingConfigId, persistedConfigId]);

  useEffect(() => {
    refreshTools();
  }, [refreshTools]);

  useEffect(() => {
    console.log('[VoiceAgent] hydrated persisted reactivity', {
      persistedConfigId,
      preferredModel,
      preferredVoice,
      activePanel
    });
  }, [persistedConfigId, preferredModel, preferredVoice, activePanel]);

  useEffect(() => {
    if (isSettingsOpen) {
      setActivePanel('settings');
    } else {
      setActivePanel(viewMode === 'history' ? 'logs' : 'session');
    }
  }, [isSettingsOpen, viewMode, setActivePanel]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isMCPPanelOpen) {
      window.localStorage.setItem('va-mcp-panel-open', 'true');
    } else {
      window.localStorage.removeItem('va-mcp-panel-open');
    }
  }, [isMCPPanelOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isWorkspaceView) {
      window.localStorage.setItem('va-workspace-view', 'true');
    } else {
      window.localStorage.removeItem('va-workspace-view');
    }
  }, [isWorkspaceView]);

  useEffect(() => {
    if (!isInitialized || !config) return;
    const presetId = activeConfigId || pendingConfigId || null;
    if (!presetId) return;
    rememberSessionConfig(config, presetId);
  }, [isInitialized, config, activeConfigId, pendingConfigId, rememberSessionConfig]);

  useEffect(() => {
    if (!isInitialized || isConnected || isInitializing) return;
    const snapshot = resumeSessionRef.current;
    if (!snapshot) return;
    console.log('[VoiceAgent] scheduling auto-resume attempt', {
      snapshotPreset: snapshot.presetId,
      activeConfigId: activeConfigId || pendingConfigId
    });
    const timer = setTimeout(() => {
      if (isConnected || isInitializing) return;
       console.log('[VoiceAgent] auto-resume firing', {
         snapshotPreset: snapshot.presetId
       });
      handleStart({ config: snapshot.config, presetId: snapshot.presetId });
    }, 1500);
    return () => clearTimeout(timer);
  }, [isInitialized, isConnected, isInitializing, handleStart]);

  const applyPresetToState = useCallback(async (
    preset: AgentConfigPreset,
    options: { restartSession?: boolean } = {}
  ) => {
    console.log('[VoiceAgent] applyPresetToState', {
      presetId: preset.id,
      restartSession: options.restartSession
    });
    const appliedConfig = applyPreferencesToConfig(configPresetToRealtimeConfig(preset));
    setPendingConfigId(preset.id);
    persistActiveConfigId(preset.id);
    setActiveConfig(preset.id);
    setActiveConfigName(preset.name);
    setCurrentConfig(appliedConfig);

    if (options.restartSession && isInitialized) {
      setIsSwitchingPreset(true);
      try {
        await cleanup();
        setIsInitialized(false);
        await initialize(appliedConfig, preset.id);
        rememberSessionConfig(appliedConfig, preset.id);
        setIsInitialized(true);
        setViewMode('current');
        setSelectedHistoricalSessionId(undefined);
        setHistoricalMessages([]);
      } catch (error) {
        console.error('Failed to switch preset:', error);
      } finally {
        setIsSwitchingPreset(false);
      }
    }
  }, [applyPreferencesToConfig, cleanup, initialize, isInitialized, persistActiveConfigId, setActiveConfig, rememberSessionConfig]);

  const refreshPresets = useCallback(async () => {
    try {
      const data = await getAllConfigPresets();
      setPresets(data);
      return data;
    } catch (error) {
      console.error('Failed to load presets:', error);
      return [];
    }
  }, []);

  useEffect(() => {
    if (!vaUser) return;

    (async () => {
      const data = await refreshPresets();
      if (!data.length) return;
      const storedPreset = persistedConfigId
        ? data.find(p => p.id === persistedConfigId)
        : null;
      const preferred = storedPreset
        || data.find(p => p.id === vaUser.default_agent_id)
        || data.find(p => p.is_default)
        || data[0];
      if (preferred) {
        await applyPresetToState(preferred, { restartSession: false });
      }
    })();
  }, [vaUser?.id, vaUser?.default_agent_id, refreshPresets, applyPresetToState, persistedConfigId]);

  const handleMCPConnectionsChanged = () => {
    refreshTools();
  };

  const handleN8NIntegrationsChanged = () => {
    refreshTools();
  };

  const handlePresetChange = async (presetId: string | null) => {
    console.log('[VoiceAgent] handlePresetChange', { presetId });
    if (!presetId) {
      setPendingConfigId(null);
      setActiveConfigName(undefined);
      persistActiveConfigId(null);
      return;
    }
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    await applyPresetToState(preset, { restartSession: true });
  };

  const handlePanelConfigChange = useCallback((newConfig: RealtimeConfig) => {
    console.log('[VoiceAgent] config change from settings panel', {
      model: newConfig.model,
      voice: newConfig.voice
    });
    if (newConfig.model && newConfig.model !== preferredModel) {
      setPreferredModel(newConfig.model);
    }
    if (newConfig.voice && newConfig.voice !== preferredVoice) {
      setPreferredVoice(newConfig.voice);
    }
    const merged = mergeRealtimeConfig(isInitialized ? config : currentConfig, newConfig);
    if (isInitialized) {
      setConfig(merged);
    } else {
      setCurrentConfig(merged);
    }
  }, [isInitialized, preferredModel, preferredVoice, setPreferredModel, setPreferredVoice, setConfig, config, currentConfig, setCurrentConfig]);

  const handleGoToWorkspace = () => {
    console.log('[VoiceAgent] switching to workspace view');
    setIsWorkspaceView(true);
    setActivePanel('session');
  };

  const handleReturnToWelcome = () => {
    console.log('[VoiceAgent] returning to welcome hero');
    setIsWorkspaceView(false);
    if (!isInitialized) {
      setViewMode('current');
      setSelectedHistoricalSessionId(undefined);
      setHistoricalMessages([]);
    }
    setActivePanel('session');
  };

  const sidebar = (
    <Sidebar
      toolsCount={toolsCount}
      isConnected={isConnected}
      onSessionSelect={handleSessionSelect}
      selectedSessionId={selectedHistoricalSessionId}
      currentSessionId={sessionId}
    >
      <ToolsList mcpTools={mcpTools} />
    </Sidebar>
  );

  const topBar = (
    <TopBar
      isInitialized={isInitialized}
      activeConfigName={activeConfigName}
      onSettingsClick={() => setIsSettingsOpen(true)}
      onMCPClick={() => setIsMCPPanelOpen(true)}
      onIntegrationsClick={() => setIsN8NPanelOpen(true)}
      onEndSession={handleEnd}
      viewMode={viewMode}
      onBackToCurrent={handleBackToCurrent}
      onSignOut={signOut}
      userEmail={vaUser?.email}
    />
  );
  const derivedPresetId = isInitialized ? activeConfigId : (pendingConfigId || persistedConfigId);
  const derivedProviderKeyId =
    presets.find(p => p.id === derivedPresetId)?.provider_key_id ||
    providerKeys[0]?.id ||
    null;
  const selectedPresetId = pendingConfigId || activeConfigId || persistedConfigId || null;
  const showWorkspacePreview = isWorkspaceView && !isInitialized;

  return (
    <>
      {!isInitialized && !isWorkspaceView ? (
          <WelcomeHero
            onStart={handleStart}
            isInitializing={isInitializing}
            activeConfigName={activeConfigName}
            error={error}
            presets={presets.map(p => ({ id: p.id, name: p.name }))}
            selectedPresetId={pendingConfigId || activeConfigId || null}
            onPresetSelect={(id) => handlePresetChange(id)}
            onGoToWorkspace={handleGoToWorkspace}
          />
        ) : (
          <>
            <MainLayout sidebar={sidebar} topBar={topBar}>
              <div className="flex flex-col p-6 gap-6 h-full overflow-hidden">
                <div className="flex-1 grid grid-cols-2 gap-6 min-h-0 overflow-hidden">
                  <div className="flex flex-col gap-4 min-h-0 overflow-hidden">
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs text-gray-500">
                          Active preset: <span className="font-medium text-gray-800">{activeConfigName || 'Custom'}</span>
                          {isSwitchingPreset && <span className="ml-2 text-amber-600">Switching…</span>}
                        </div>
                        {sessionId && (
                          <span className="text-[11px] text-gray-400">Session: {sessionId}</span>
                        )}
                      </div>
                      {showWorkspacePreview ? (
                        <Card className="p-6 space-y-5">
                          <div>
                            <p className="text-lg font-semibold text-slate-700">Workspace view</p>
                            <p className="text-sm text-slate-500">
                              You’re logged in and ready to start the agent whenever you pick a preset.
                            </p>
                          </div>
                          <div>
                            <label className="text-xs text-slate-500 block mb-1">Choose a preset</label>
                            <select
                              value={selectedPresetId || ''}
                              onChange={(e) => handlePresetChange(e.target.value)}
                              className="w-full rounded-xl bg-slate-900 border border-slate-700 text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-300"
                            >
                              <option value="">Select a preset</option>
                              {presets.map(preset => (
                                <option key={preset.id} value={preset.id}>{preset.name}</option>
                              ))}
                            </select>
                            <p className="mt-2 text-xs text-slate-400">
                              Current: <span className="font-semibold text-cyan-200">{activeConfigName || 'None selected'}</span>
                            </p>
                          </div>
                          <StartSessionButton
                            onClick={handleStart}
                            disabled={isInitializing || !selectedPresetId}
                            loading={isInitializing}
                          >
                            {isInitializing ? 'Requesting Permissions...' : selectedPresetId ? 'Start Voice Agent' : 'Select a Preset to Continue'}
                          </StartSessionButton>
                          <button
                            type="button"
                            onClick={handleReturnToWelcome}
                            className="text-xs text-cyan-300 underline underline-offset-2"
                          >
                            Return to welcome screen
                          </button>
                        </Card>
                      ) : (
                        <ConversationThread
                          key={viewMode === 'history' ? `history-${selectedHistoricalSessionId}` : 'current'}
                          messages={viewMode === 'current' ? messages : historicalMessages}
                          isProcessing={isProcessing}
                          isHistorical={viewMode === 'history'}
                          isLoadingHistory={isLoadingHistory}
                          historyError={historyError}
                          liveAssistantTranscript={liveAssistantTranscript}
                          liveUserTranscript={liveUserTranscript}
                          agentState={agentState}
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-4">
                    {viewMode === 'current' ? (
                    <>
                      <VoiceInteractionArea
                        agentState={agentState}
                        isRecording={isRecording}
                        isConnected={isConnected}
                          liveUserTranscript={liveUserTranscript}
                          liveAssistantTranscript={liveAssistantTranscript}
                          onToggle={toggleRecording}
                          waveformData={waveformData}
                          volume={volume}
                        />

                      {config && config.turn_detection && (
                        <p className="text-center text-sm text-gray-400">
                          Speak naturally - the AI will respond automatically
                        </p>
                      )}

                      <Card className="p-5 bg-slate-900/60 border-white/5 flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-pink-500 flex items-center justify-center">
                            <Sparkles className="w-5 h-5 text-slate-950" />
                          </div>
                          <div>
                            <p className="font-semibold text-white">Tool executions</p>
                            <p className="text-xs text-white/50">Every MCP + workflow call this session</p>
                          </div>
                        </div>
                        <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
                          {toolEvents.length === 0 ? (
                            <p className="text-sm text-white/50">No tools called yet.</p>
                          ) : toolEvents.map(event => {
                            const responsePreview = event.response ? JSON.stringify(event.response) : null;
                            return (
                              <div
                                key={event.id}
                                className={cn(
                                  'rounded-2xl border px-3 py-2',
                                  event.status === 'failed'
                                    ? 'border-rose-400/40 bg-rose-500/10'
                                    : event.status === 'succeeded'
                                    ? 'border-emerald-400/40 bg-emerald-500/10'
                                    : 'border-white/10 bg-white/5'
                                )}
                              >
                                <div className="flex items-center justify-between text-sm text-white/80">
                                  <span className="font-semibold">{event.toolName}</span>
                                  <span className="text-xs text-white/50 uppercase tracking-[0.2em]">{event.status}</span>
                                </div>
                                {event.error && (
                                  <p className="text-xs text-rose-200 mt-1">{event.error}</p>
                                )}
                                {responsePreview && (
                                  <p className="text-xs text-white/60 mt-1 truncate">
                                    {responsePreview.slice(0, 80)}
                                    {responsePreview.length > 80 ? '…' : ''}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="border-t border-white/10 pt-3">
                          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.3em] text-white/40">
                            <span>Connected automations</span>
                            <span>{toolSummary.total}</span>
                          </div>
                          {toolSummary.total === 0 ? (
                            <p className="text-xs text-white/50 mt-2">
                              No MCP or n8n tools configured for this preset.
                            </p>
                          ) : (
                            <>
                              <div className="flex gap-4 text-[11px] text-white/60 mt-3">
                                <span>MCP: {toolSummary.mcpCount}</span>
                                <span>n8n: {toolSummary.n8nCount}</span>
                              </div>
                              <div className="flex flex-wrap gap-2 mt-3">
                                {toolSummary.preview.map(tool => (
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

                      <Card className="p-5 bg-slate-900/60 border-white/5 flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
                            <BookOpenCheck className="w-5 h-5 text-slate-950" />
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold text-white">Knowledge grounding</p>
                            <p className="text-xs text-white/50">Latest retrieval context + citations</p>
                          </div>
                          {isRagLoading && <Loader2 className="w-4 h-4 text-white/70 animate-spin" />}
                        </div>
                        <div className="flex items-center justify-between text-xs text-white/60">
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded-full border text-[11px] uppercase tracking-[0.2em]',
                              ragInvoked
                                ? 'border-emerald-400/70 text-emerald-200'
                                : 'border-white/20 text-white/40'
                            )}
                          >
                            {ragInvoked ? 'RAG invoked' : 'RAG idle'}
                          </span>
                          {ragResult && (
                            <span className="text-[11px] text-white/40">
                              Updated {formatRelative(ragResult.createdAt)}
                            </span>
                          )}
                        </div>
                        {ragError && (
                          <p className="text-xs text-rose-300">{ragError}</p>
                        )}
                        {ragResult ? (
                          <div className="space-y-3">
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                              <p className="text-[11px] uppercase tracking-[0.2em] text-white/40 mb-1">Synthesized answer</p>
                              <p className="text-sm text-white/80 whitespace-pre-wrap">
                                {ragResult.answer || 'No summary returned.'}
                              </p>
                              {ragResult.guardrailTriggered && (
                                <p className="text-[11px] text-amber-300 mt-2">
                                  Guardrail enforced — insufficient citations.
                                </p>
                              )}
                            </div>
                            <div>
                              <p className="text-xs uppercase text-white/40 mb-2">Citations</p>
                              <div className="space-y-2">
                                {ragResult.citations.length === 0 && (
                                  <p className="text-xs text-white/50">
                                    No citations returned for the last turn.
                                  </p>
                                )}
                                {ragResult.citations.map((citation, index) => (
                                  <div
                                    key={`${citation.file_id}-${index}`}
                                    className="rounded-xl border border-white/10 bg-black/20 p-3"
                                  >
                                    <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-white/40 mb-1">
                                      <span>Ref {index + 1}</span>
                                      {citation.title && (
                                        <span className="text-[10px] text-white/60 normal-case">
                                          {citation.title}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-sm text-white/80">{citation.snippet}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-white/50">
                            Connect knowledge spaces to this agent to see retrieved snippets every time a user speaks.
                          </p>
                        )}
                      </Card>

                    </>
                  ) : (
                      <Card className="p-6 flex items-center justify-center h-full">
                        <div className="text-center">
                          <p className="text-gray-600 mb-2">Viewing session history</p>
                          <p className="text-sm text-gray-500">
                            Click "Back to Current Session" to return
                          </p>
                        </div>
                      </Card>
                    )}
                  </div>
                </div>
              </div>
            </MainLayout>
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={isInitialized && config ? config : currentConfig}
        onConfigChange={handlePanelConfigChange}
              activeConfigId={isInitialized ? activeConfigId : pendingConfigId}
              onActiveConfigChange={(configId) => {
                if (configId) {
                  handlePresetChange(configId);
                }
              }}
              userId={vaUser?.id || ''}
              providerKeyId={derivedProviderKeyId}
        onPresetsRefresh={async () => {
          await refreshPresets();
        }}
            />

            <MCPPanel
              isOpen={isMCPPanelOpen}
              onClose={() => setIsMCPPanelOpen(false)}
              onConnectionsChanged={handleMCPConnectionsChanged}
            />
            <N8NPanel
              isOpen={isN8NPanelOpen}
              onClose={() => setIsN8NPanelOpen(false)}
              configId={derivedPresetId || null}
              onIntegrationsChanged={handleN8NIntegrationsChanged}
            />
          </>
        )}
    </>
  );
}
