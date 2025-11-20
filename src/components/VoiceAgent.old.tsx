import { useState, useEffect, useCallback } from 'react';
import { Settings, Power, Plug } from 'lucide-react';
import { useVoiceAgent } from '../hooks/useVoiceAgent';
import { WaveformVisualizer } from './WaveformVisualizer';
import { AgentAvatar } from './AgentAvatar';
import { MicrophoneButton } from './MicrophoneButton';
import { TranscriptPanel } from './TranscriptPanel';
import { ConnectionStatus } from './ConnectionStatus';
import { SettingsPanel } from './SettingsPanel';
import { MCPConnectionsPanel } from './MCPConnectionsPanel';
import { RealtimeConfig } from '../types/voice-agent';
import { clientTools, serverTools, mcpTools } from '../lib/tools-registry';
import { getDefaultConfigPreset, configPresetToRealtimeConfig } from '../lib/config-service';

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
  const [toolsCount, setToolsCount] = useState({ client: 0, server: 0, mcp: 0 });
  const [initialConfig, setInitialConfig] = useState<RealtimeConfig>(defaultConfig);

  const {
    isConnected,
    isRecording,
    messages,
    waveformData,
    volume,
    isProcessing,
    config,
    error,
    transcriptDebug,
    activeConfigId,
    setConfig,
    setActiveConfig,
    initialize,
    toggleRecording,
    cleanup
  } = useVoiceAgent(initialConfig);

  const handleStart = async () => {
    setIsInitializing(true);
    try {
      await initialize();
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
  }, []);

  const loadInitialConfig = useCallback(async () => {
    try {
      const defaultPreset = await getDefaultConfigPreset();
      if (defaultPreset) {
        const presetConfig = configPresetToRealtimeConfig(defaultPreset);
        setInitialConfig(presetConfig);
        setConfig(presetConfig);
        setActiveConfig(defaultPreset.id);
      }
    } catch (error) {
      console.error('Failed to load default config:', error);
    }
  }, [setConfig, setActiveConfig]);

  const handleMCPConnectionsChanged = () => {
    updateToolsCount();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="container mx-auto px-4 py-6 h-screen flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xl">VA</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-800">Voice AI Agent</h1>
          </div>

          <div className="flex items-center gap-3">
            <ConnectionStatus isConnected={isConnected} />

            <button
              onClick={() => setIsMCPPanelOpen(true)}
              className="p-2 hover:bg-white rounded-lg transition-colors"
              title="Manage MCP Connections"
            >
              <Plug className="w-5 h-5 text-gray-600" />
            </button>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 hover:bg-white rounded-lg transition-colors"
              disabled={!isInitialized}
            >
              <Settings className="w-5 h-5 text-gray-600" />
            </button>

            {isInitialized && (
              <button
                onClick={handleEnd}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center gap-2"
              >
                <Power className="w-4 h-4" />
                End Session
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 overflow-hidden">
          <div className="flex flex-col gap-6">
            <div className="bg-white rounded-lg shadow-lg p-6 flex-1 flex flex-col items-center justify-center">
              <AgentAvatar
                isActive={isRecording || isProcessing}
                volume={volume}
              />

              <div className="mt-8 w-full max-w-2xl">
                <WaveformVisualizer
                  waveformData={waveformData}
                  isActive={isRecording}
                  color="#3b82f6"
                />
              </div>

              <div className="mt-8">
                {!isInitialized ? (
                  <div className="flex flex-col items-center gap-3">
                    <button
                      onClick={handleStart}
                      disabled={isInitializing}
                      className="px-8 py-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-lg font-semibold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isInitializing ? 'Requesting Permissions...' : 'Start Voice Agent'}
                    </button>
                    {error && (
                      <div className="px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm max-w-md text-center">
                        {error}
                      </div>
                    )}
                  </div>
                ) : (
                  <MicrophoneButton
                    isRecording={isRecording}
                    isConnected={isConnected}
                    onToggle={toggleRecording}
                  />
                )}
              </div>

              {isInitialized && (
                <div className="mt-6 text-center space-y-2">
                  <p className="text-sm text-gray-600">
                    {config.turn_detection
                      ? 'Speak naturally - the AI will respond automatically'
                      : 'Click the microphone to start/stop recording'}
                  </p>
                  {transcriptDebug && (
                    <div className="mt-2 px-4 py-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800 max-w-md mx-auto">
                      <span className="font-semibold">Live Transcript: </span>
                      {transcriptDebug}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg shadow-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">Available Tools</h3>
                <span className="text-xs text-gray-500">
                  {toolsCount.client + toolsCount.server + toolsCount.mcp} total
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs max-h-40 overflow-y-auto">
                {clientTools.map(tool => (
                  <div key={tool.name} className="px-3 py-2 bg-blue-50 rounded border border-blue-200">
                    <span className="font-medium text-blue-700">{tool.name}</span>
                  </div>
                ))}
                {serverTools.map(tool => (
                  <div key={tool.name} className="px-3 py-2 bg-amber-50 rounded border border-amber-200">
                    <span className="font-medium text-amber-700">{tool.name}</span>
                  </div>
                ))}
                {mcpTools.map(tool => (
                  <div key={tool.name} className="px-3 py-2 bg-emerald-50 rounded border border-emerald-200">
                    <span className="font-medium text-emerald-700">{tool.name}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Blue: Client • Amber: Server • Emerald: MCP
              </p>
            </div>
          </div>

          <div className="h-full">
            <TranscriptPanel messages={messages} isProcessing={isProcessing} />
          </div>
        </div>
      </div>

      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onConfigChange={setConfig}
        activeConfigId={activeConfigId}
        onActiveConfigChange={setActiveConfig}
      />

      <MCPConnectionsPanel
        isOpen={isMCPPanelOpen}
        onClose={() => setIsMCPPanelOpen(false)}
        onConnectionsChanged={handleMCPConnectionsChanged}
      />
    </div>
  );
}
