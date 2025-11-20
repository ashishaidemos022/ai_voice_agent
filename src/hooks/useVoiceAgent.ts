import { useState, useEffect, useCallback, useRef } from 'react';
import { AudioManager } from '../lib/audio-manager';
import { RealtimeAPIClient } from '../lib/realtime-client';
import { supabase } from '../lib/supabase';
import { executeTool, loadMCPTools } from '../lib/tools-registry';
import { Message, RealtimeConfig } from '../types/voice-agent';

export function useVoiceAgent() {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [waveformData, setWaveformData] = useState<Uint8Array | null>(null);
  const [volume, setVolume] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [config, setConfig] = useState<RealtimeConfig | null>(null);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcriptDebug, setTranscriptDebug] = useState<string>('');

  const audioManagerRef = useRef<AudioManager | null>(null);
  const realtimeClientRef = useRef<RealtimeAPIClient | null>(null);
  const audioIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentTranscriptRef = useRef<{ user: string; assistant: string }>({ user: '', assistant: '' });
  const sessionIdRef = useRef<string | null>(null);

  const createSession = useCallback(async (sessionConfig: RealtimeConfig, configId: string | null) => {
    const { data, error } = await supabase
      .from('va_sessions')
      .insert({
        session_metadata: { config: sessionConfig, configId },
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to create session:', error);
      return null;
    }

    return data.id;
  }, []);

  const addMessage = useCallback(async (role: 'user' | 'assistant' | 'system', content: string, toolCalls: any[] = []) => {
    const currentSessionId = sessionIdRef.current;

    if (!currentSessionId) {
      console.error('❌ Cannot add message: No session ID');
      return;
    }

    console.log(`💾 Attempting to save ${role} message:`, content.substring(0, 100));

    const { data, error } = await supabase
      .from('va_messages')
      .insert({
        session_id: currentSessionId,
        role,
        content,
        tool_calls: toolCalls
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Failed to add message to database:', error);
      setError(`Failed to save transcript: ${error.message}`);
      return;
    }

    console.log('✅ Message saved successfully:', data.id);
    setMessages(prev => [...prev, data]);

    await supabase
      .from('va_sessions')
      .update({
        message_count: messages.length + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', currentSessionId);
  }, [messages.length]);

  const initialize = useCallback(async (initConfig: RealtimeConfig, configId: string | null = null) => {
    try {
      setError(null);
      setConfig(initConfig);
      setActiveConfigId(configId);

      console.log('🔌 Loading MCP tools...');
      await loadMCPTools(configId || undefined);
      console.log('✅ MCP tools loaded');

      const sid = await createSession(initConfig, configId);
      if (!sid) {
        throw new Error('Failed to create session');
      }

      sessionIdRef.current = sid;
      setSessionId(sid);
      console.log('✅ Session created with ID:', sid);

      if (audioManagerRef.current) {
        console.warn('AudioManager already exists, cleaning up before re-initialization');
        audioManagerRef.current.close();
      }

      audioManagerRef.current = new AudioManager();
      await audioManagerRef.current.initialize();

      realtimeClientRef.current = new RealtimeAPIClient(initConfig);

      realtimeClientRef.current.on('connected', () => {
        setIsConnected(true);
      });

      realtimeClientRef.current.on('disconnected', () => {
        setIsConnected(false);
        setIsRecording(false);
      });

      realtimeClientRef.current.on('error', (event: any) => {
        console.error('Realtime API error:', event.error);
        setError(event.error);
      });

      realtimeClientRef.current.on('audio.delta', async (event: any) => {
        console.log('Received audio.delta event');
        if (audioManagerRef.current) {
          await audioManagerRef.current.playAudioData(event.delta);
        } else {
          console.warn('AudioManager not available for playback');
        }
      });

      realtimeClientRef.current.on('transcript.delta', (event: any) => {
        if (event.role === 'user') {
          currentTranscriptRef.current.user += event.delta;
          setTranscriptDebug(`User: ${currentTranscriptRef.current.user}`);
        } else if (event.role === 'assistant') {
          currentTranscriptRef.current.assistant += event.delta;
          setTranscriptDebug(`Assistant: ${currentTranscriptRef.current.assistant}`);
        }
      });

      realtimeClientRef.current.on('transcript.done', async (event: any) => {
        console.log('📥 Received transcript.done event:', event);

        if (!event.transcript || !event.transcript.trim()) {
          console.warn('⚠️ Empty transcript received, skipping');
          return;
        }

        console.log(`🗣️ ${event.role.toUpperCase()} said:`, event.transcript);

        if (event.role === 'user') {
          await addMessage('user', event.transcript);
          currentTranscriptRef.current.user = '';
          setTranscriptDebug('');
        } else if (event.role === 'assistant') {
          await addMessage('assistant', event.transcript);
          currentTranscriptRef.current.assistant = '';
          setTranscriptDebug('');
        }
        setIsProcessing(false);
      });

      realtimeClientRef.current.on('function_call', async (event: any) => {
        const { id, name, arguments: argsStr } = event.call;
        const currentSessionId = sessionIdRef.current;

        try {
          setIsProcessing(true);
          const args = JSON.parse(argsStr);
          const result = await executeTool(name, args, currentSessionId || '');

          if (realtimeClientRef.current) {
            realtimeClientRef.current.sendFunctionCallOutput(id, result);
          }
        } catch (error: any) {
          console.error('Tool execution error:', error);
          if (realtimeClientRef.current) {
            realtimeClientRef.current.sendFunctionCallOutput(id, {
              error: error.message
            });
          }
        } finally {
          setIsProcessing(false);
        }
      });

      await realtimeClientRef.current.connect();

      await startRecording();
    } catch (error: any) {
      console.error('Failed to initialize:', error);

      if (audioManagerRef.current && !audioManagerRef.current.isCurrentlyInitializing()) {
        audioManagerRef.current.close();
        audioManagerRef.current = null;
      }
      const errorMessage = error.name === 'NotAllowedError'
        ? 'Microphone permission denied. Please allow microphone access to use the voice agent.'
        : error.name === 'NotFoundError'
        ? 'No microphone found. Please connect a microphone to use the voice agent.'
        : `Failed to initialize: ${error.message}`;
      setError(errorMessage);
      throw error;
    }
  }, [createSession, addMessage]);

  const startRecording = useCallback(async () => {
    if (!audioManagerRef.current || !realtimeClientRef.current) return;

    try {
      await audioManagerRef.current.startCapture((audioData: Int16Array) => {
        if (realtimeClientRef.current) {
          realtimeClientRef.current.sendAudio(audioData);
        }
      });

      setIsRecording(true);

      audioIntervalRef.current = setInterval(() => {
        if (!audioManagerRef.current) return;

        const waveform = audioManagerRef.current.getWaveformData();
        const vol = audioManagerRef.current.getVolume();

        if (waveform) {
          setWaveformData(new Uint8Array(waveform));
          setVolume(vol);
        }
      }, 50);
    } catch (error) {
      console.error('Failed to start recording:', error);
      setError('Failed to start recording');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (!audioManagerRef.current) return;

    audioManagerRef.current.stopCapture();
    setIsRecording(false);

    if (audioIntervalRef.current) {
      clearInterval(audioIntervalRef.current);
      audioIntervalRef.current = null;
    }

    setWaveformData(null);
    setVolume(0);
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const cleanup = useCallback(async () => {
    stopRecording();

    if (realtimeClientRef.current) {
      try {
        realtimeClientRef.current.disconnect();
      } catch (error) {
        console.warn('Error during realtime client disconnect:', error);
      }
      realtimeClientRef.current = null;
    }

    if (audioManagerRef.current) {
      try {
        if (audioManagerRef.current.isCurrentlyInitializing()) {
          console.warn('Attempted cleanup during initialization, waiting briefly...');
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        audioManagerRef.current.close();
      } catch (error) {
        console.warn('Error during audio manager cleanup:', error);
      }
      audioManagerRef.current = null;
    }

    const currentSessionId = sessionIdRef.current;
    if (currentSessionId) {
      try {
        await supabase
          .from('va_sessions')
          .update({
            status: 'ended',
            updated_at: new Date().toISOString()
          })
          .eq('id', currentSessionId);
      } catch (error) {
        console.warn('Error updating session status:', error);
      }

      sessionIdRef.current = null;
      setSessionId(null);
    }

    setMessages([]);
    currentTranscriptRef.current = { user: '', assistant: '' };
    setTranscriptDebug('');
    setIsProcessing(false);
  }, [stopRecording]);

  useEffect(() => {
    return () => {
      if (isConnected || audioManagerRef.current) {
        cleanup();
      }
    };
  }, []);

  const updateConfig = useCallback((newConfig: RealtimeConfig) => {
    if (config) {
      setConfig(newConfig);
      if (realtimeClientRef.current && isConnected) {
        console.log('🔄 Applying config changes to active session');
        realtimeClientRef.current.updateSessionConfig(newConfig);
      }
    }
  }, [isConnected, config]);

  const setActiveConfig = useCallback((configId: string | null) => {
    setActiveConfigId(configId);
  }, []);

  return {
    isConnected,
    isRecording,
    messages,
    waveformData,
    volume,
    sessionId,
    isProcessing,
    config,
    error,
    transcriptDebug,
    activeConfigId,
    setConfig: updateConfig,
    setActiveConfig,
    initialize,
    toggleRecording,
    cleanup
  };
}
