import { useState, useEffect, useCallback } from 'react';
import { useVoiceAgent } from '../hooks/useVoiceAgent';
import { RealtimeConfig, Message } from '../types/voice-agent';
import { clientTools, serverTools, mcpTools } from '../lib/tools-registry';
import { getDefaultConfigPreset, configPresetToRealtimeConfig, getAllConfigPresets, AgentConfigPreset } from '../lib/config-service';
import { supabase } from '../lib/supabase';

import { MainLayout } from './layout/MainLayout';
import { Sidebar } from './layout/Sidebar';
import { TopBar } from './layout/TopBar';
import { VoiceInteractionArea } from './voice/VoiceInteractionArea';
import { ConversationThread } from './conversation/ConversationThread';
import { ToolsList } from './tools/ToolsList';
import { SettingsPanel } from './panels/SettingsPanel';
import { MCPPanel } from './panels/MCPPanel';
import { Card } from './ui/Card';
import { WelcomeHero } from './welcome/WelcomeHero';

const defaultConfig: RealtimeConfig = {
  model: 'gpt-realtime',
  voice: 'alloy',
  instructions: 'You are a helpful AI voice assistant. You can help users with various tasks, answer questions, and execute tools when needed. Be conversational and friendly.',
  temperature: 0.8,
  max_response_output_tokens: 4096,
  turn_detection: {
    type: 'server_vad',
    threshold: 0.7,
    prefix_padding_ms: 200,
    silence_duration_ms: 800
  }
};

export function VoiceAgent() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMCPPanelOpen, setIsMCPPanelOpen] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isSwitchingPreset, setIsSwitchingPreset] = useState(false);
  const [toolsCount, setToolsCount] = useState({ client: 0, server: 0, mcp: 0 });
  const [currentConfig, setCurrentConfig] = useState<RealtimeConfig>(defaultConfig);
  const [activeConfigName, setActiveConfigName] = useState<string | undefined>();
  const [viewMode, setViewMode] = useState<'current' | 'history'>('current');
  const [selectedHistoricalSessionId, setSelectedHistoricalSessionId] = useState<string | undefined>();
  const [historicalMessages, setHistoricalMessages] = useState<Message[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [pendingConfigId, setPendingConfigId] = useState<string | null>(null);
  const [presets, setPresets] = useState<AgentConfigPreset[]>([]);

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
    setConfig,
    setActiveConfig,
    initialize,
    toggleRecording,
    interrupt,
    cleanup
  } = useVoiceAgent();

  const handleStart = async () => {
    setIsInitializing(true);
    try {
      await initialize(currentConfig, pendingConfigId);
      setIsInitialized(true);
    } catch (error) {
      console.error('Initialization error:', error);
    } finally {
      setIsInitializing(false);
    }
  };

  const handleEnd = async () => {
    await cleanup();
    setIsInitialized(false);
    setViewMode('current');
    setSelectedHistoricalSessionId(undefined);
    setHistoricalMessages([]);
  };

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
    setToolsCount({
      client: clientTools.length,
      server: serverTools.length,
      mcp: mcpTools.length
    });
  };

  useEffect(() => {
    updateToolsCount();
    loadInitialConfig();
    loadPresets();
  }, []);

  const loadPresets = async () => {
    try {
      const data = await getAllConfigPresets();
      setPresets(data);
    } catch (error) {
      console.error('Failed to load presets:', error);
    }
  };

  const loadInitialConfig = useCallback(async () => {
    try {
      const defaultPreset = await getDefaultConfigPreset();
      if (defaultPreset) {
        const presetConfig = configPresetToRealtimeConfig(defaultPreset);
        setCurrentConfig(presetConfig);
        setPendingConfigId(defaultPreset.id);
        setActiveConfigName(defaultPreset.name);
      }
    } catch (error) {
      console.error('Failed to load default config:', error);
    }
  }, []);

  const handleMCPConnectionsChanged = () => {
    updateToolsCount();
  };

  const handlePresetChange = async (presetId: string | null) => {
    if (!presetId) return;
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    const newConfig = configPresetToRealtimeConfig(preset);
    setPendingConfigId(presetId);
    setActiveConfig(presetId);
    setActiveConfigName(preset.name);
    setCurrentConfig(newConfig);

    // If already running, end current session and restart with new config
    if (isInitialized) {
      setIsSwitchingPreset(true);
      try {
        await cleanup();
        setIsInitialized(false);
        await initialize(newConfig, presetId);
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
  };

  const sidebar = (
    <Sidebar
      toolsCount={toolsCount}
      isConnected={isConnected}
      onSessionSelect={handleSessionSelect}
      selectedSessionId={selectedHistoricalSessionId}
      currentSessionId={sessionId}
    >
      <ToolsList
        clientTools={clientTools}
        serverTools={serverTools}
        mcpTools={mcpTools}
      />
    </Sidebar>
  );

  const topBar = (
    <TopBar
      isInitialized={isInitialized}
      activeConfigName={activeConfigName}
      onSettingsClick={() => setIsSettingsOpen(true)}
      onMCPClick={() => setIsMCPPanelOpen(true)}
      onEndSession={handleEnd}
      viewMode={viewMode}
      onBackToCurrent={handleBackToCurrent}
    />
  );

  return (
    <>
      {!isInitialized ? (
        <WelcomeHero
          onStart={handleStart}
          isInitializing={isInitializing}
          activeConfigName={activeConfigName}
          error={error}
        />
      ) : (
        <MainLayout sidebar={sidebar} topBar={topBar}>
          <div className="flex flex-col p-6 gap-6 h-full overflow-hidden">
            <>
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
                        onInterrupt={interrupt}
                      />

                      {config && config.turn_detection && (
                        <p className="text-center text-sm text-gray-400">
                          Speak naturally - the AI will respond automatically
                        </p>
                      )}

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
            </>
          </div>
        </MainLayout>
      )}

      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={isInitialized && config ? config : currentConfig}
        onConfigChange={(newConfig) => {
          if (isInitialized) {
            setConfig(newConfig);
          } else {
            setCurrentConfig(newConfig);
          }
        }}
        activeConfigId={isInitialized ? activeConfigId : pendingConfigId}
        onActiveConfigChange={(configId) => {
          if (configId) {
            handlePresetChange(configId);
          }
        }}
      />

      <MCPPanel
        isOpen={isMCPPanelOpen}
        onClose={() => setIsMCPPanelOpen(false)}
        onConnectionsChanged={handleMCPConnectionsChanged}
      />
    </>
  );
}
