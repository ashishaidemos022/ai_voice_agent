import { useState, useEffect, useCallback, useRef } from 'react';
import { AudioManager, getAudioManager } from '../lib/audio-manager';
import { AgentState, RealtimeAPIClient } from '../lib/realtime-client';
import { supabase } from '../lib/supabase';
import { executeTool, loadMCPTools } from '../lib/tools-registry';
import { Message, RealtimeConfig } from '../types/voice-agent';

type LiveTranscripts = {
  user: Record<string, string>;
  assistant: Record<string, string>;
  activeUserId: string | null;
  activeAssistantId: string | null;
};

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
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [liveUserTranscript, setLiveUserTranscript] = useState('');
  const [liveAssistantTranscript, setLiveAssistantTranscript] = useState('');

  const audioManagerRef = useRef<AudioManager | null>(null);
  const realtimeClientRef = useRef<RealtimeAPIClient | null>(null);
  const audioIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const transcriptsRef = useRef<LiveTranscripts>({
    user: {},
    assistant: {},
    activeUserId: null,
    activeAssistantId: null
  });
  const messagesRef = useRef<Message[]>([]);
  const savedMessagesRef = useRef<Set<string>>(new Set());
  const isCleaningUpRef = useRef(false);
  const micStartedRef = useRef(false);
  const shouldPersistSession = useRef(true);

  const createSession = useCallback(async (sessionConfig: RealtimeConfig, configId: string | null) => {
    if (!configId) {
      throw new Error('An agent configuration must be selected before starting a session.');
    }

    const { data, error: dbError } = await supabase
      .from('va_sessions')
      .insert({
        agent_id: configId,
        session_metadata: { config: sessionConfig, configId },
        status: 'active'
      })
      .select()
      .single();

    if (dbError) {
      console.error('Failed to create session:', dbError);
      return null;
    }

    return data.id;
  }, []);

  const updateSessionMessageCount = useCallback(async (count: number) => {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) return;
    try {
      await supabase
        .from('va_sessions')
        .update({
          message_count: count,
          updated_at: new Date().toISOString()
        })
        .eq('id', currentSessionId);
    } catch (err) {
      console.warn('Failed to update session message count', err);
    }
  }, []);

  const persistMessage = useCallback(
    async (role: 'user' | 'assistant' | 'system', content: string, toolCalls: any[] = []) => {
      const currentSessionId = sessionIdRef.current;
      if (!currentSessionId || !content.trim()) return;

      const key = `${role}:${content.trim()}`;
      if (savedMessagesRef.current.has(key)) {
        return;
      }
      savedMessagesRef.current.add(key);

      try {
        const { data, error: insertError } = await supabase
          .from('va_messages')
          .insert({
            session_id: currentSessionId,
            role,
            content,
            tool_calls: toolCalls
          })
          .select()
          .single();

        if (insertError) {
          console.error('Failed to add message to database:', insertError);
          setError(`Failed to save transcript: ${insertError.message}`);
          return;
        }

        setMessages(prev => {
          const next = [...prev, data];
          messagesRef.current = next;
          updateSessionMessageCount(next.length);
          return next;
        });
      } catch (err: any) {
        console.error('Failed to persist message', err);
      }
    },
    [updateSessionMessageCount]
  );

  const resetTranscripts = useCallback(() => {
    transcriptsRef.current = {
      user: {},
      assistant: {},
      activeUserId: null,
      activeAssistantId: null
    };
    setLiveUserTranscript('');
    setLiveAssistantTranscript('');
  }, []);

  const attachRealtimeHandlers = useCallback(() => {
    const client = realtimeClientRef.current;
    const audioManager = audioManagerRef.current;
    if (!client) return;

    client.on('connected', () => {
      console.log('[useVoiceAgent] realtime event: connected');
      setIsConnected(true);
      setAgentState('idle');
    });

    client.on('disconnected', (event) => {
      console.warn('[useVoiceAgent] realtime event: disconnected', event);
      setIsConnected(false);
      setAgentState('idle');
      setIsRecording(false);
    });

    client.on('agent_state', (event) => {
      console.log('[useVoiceAgent] agent_state update', event);
      setAgentState(event.state);
      if (event.state === 'listening' && audioManager) {
        audioManager.stopPlayback();
      }
    });

    client.on('error', (event: any) => {
      console.error('[useVoiceAgent] Realtime API error:', event.error);
      setError(event.error);
    });

    client.on('audio.delta', async (event: any) => {
      console.debug('[useVoiceAgent] audio.delta received');
      if (audioManager) {
        await audioManager.playAudioData(event.delta);
      }
    });

    client.on('transcript.delta', (event: any) => {
      console.debug('[useVoiceAgent] transcript.delta', {
        role: event.role,
        itemId: event.itemId
      });
      const isUser = event.role === 'user';
      const buffer = isUser ? transcriptsRef.current.user : transcriptsRef.current.assistant;
      const fallbackId = isUser ? 'user-default' : 'assistant-default';
      const itemId = event.itemId || (isUser ? transcriptsRef.current.activeUserId : transcriptsRef.current.activeAssistantId) || fallbackId;

      if (isUser) {
        transcriptsRef.current.activeUserId = itemId;
      } else {
        transcriptsRef.current.activeAssistantId = itemId;
      }

      buffer[itemId] = (buffer[itemId] || '') + event.delta;

      if (event.role === 'user') {
        setLiveUserTranscript(buffer[itemId]);
        setAgentState('listening');
      } else {
        setLiveAssistantTranscript(buffer[itemId]);
      }
    });

    client.on('transcript.done', async (event: any) => {
      console.debug('[useVoiceAgent] transcript.done', {
        role: event.role,
        itemId: event.itemId
      });
      const isUser = event.role === 'user';
      const buffers = isUser ? transcriptsRef.current.user : transcriptsRef.current.assistant;
      const activeId = isUser ? transcriptsRef.current.activeUserId : transcriptsRef.current.activeAssistantId;
      const itemId = event.itemId || activeId || (isUser ? 'user-default' : 'assistant-default');
      const transcriptText = event.transcript || buffers[itemId] || '';

      if (!transcriptText || !transcriptText.trim()) {
        delete buffers[itemId];
        if (isUser && transcriptsRef.current.activeUserId === itemId) {
          transcriptsRef.current.activeUserId = null;
          setLiveUserTranscript('');
        } else if (!isUser && transcriptsRef.current.activeAssistantId === itemId) {
          transcriptsRef.current.activeAssistantId = null;
          setLiveAssistantTranscript('');
        }
        return;
      }

      if (isUser) {
        await persistMessage('user', transcriptText);
        delete transcriptsRef.current.user[itemId];
        if (transcriptsRef.current.activeUserId === itemId) {
          transcriptsRef.current.activeUserId = null;
          setLiveUserTranscript('');
        }
      } else {
        await persistMessage('assistant', transcriptText);
        delete transcriptsRef.current.assistant[itemId];
        if (transcriptsRef.current.activeAssistantId === itemId) {
          transcriptsRef.current.activeAssistantId = null;
          setLiveAssistantTranscript('');
        }
      }
      setIsProcessing(false);
    });

    client.on('transcript.reset', (event: any) => {
      if (event.role === 'user') {
        if (event.itemId) {
          delete transcriptsRef.current.user[event.itemId];
          if (transcriptsRef.current.activeUserId === event.itemId) {
            transcriptsRef.current.activeUserId = null;
            setLiveUserTranscript('');
          }
        } else {
          transcriptsRef.current.user = {};
          transcriptsRef.current.activeUserId = null;
          setLiveUserTranscript('');
        }
      } else {
        if (event.itemId) {
          delete transcriptsRef.current.assistant[event.itemId];
          if (transcriptsRef.current.activeAssistantId === event.itemId) {
            transcriptsRef.current.activeAssistantId = null;
            setLiveAssistantTranscript('');
          }
        } else {
          transcriptsRef.current.assistant = {};
          transcriptsRef.current.activeAssistantId = null;
          setLiveAssistantTranscript('');
        }
      }
    });

    client.on('response.created', () => {
      setIsProcessing(true);
      setAgentState('thinking');
      setLiveAssistantTranscript('');
    });

    client.on('response.done', () => {
      setIsProcessing(false);
      setAgentState('idle');
      setLiveAssistantTranscript('');
    });

    client.on('interruption', () => {
      if (audioManager) {
        audioManager.stopPlayback();
      }
      setAgentState('interrupted');
      setIsProcessing(false);
      resetTranscripts();
    });

    client.on('function_call', async (event: any) => {
      const { id, name, arguments: argsStr } = event.call;
      const currentSessionId = sessionIdRef.current;

      try {
        setIsProcessing(true);
        console.log('[useVoiceAgent] Function call received', { name, rawArguments: argsStr });
        const args = argsStr ? JSON.parse(argsStr) : {};
        console.log('[useVoiceAgent] Parsed function call args', { name, args });
        const result = await executeTool(name, args, currentSessionId || '');
        client.sendFunctionCallOutput(id, result);
      } catch (toolError: any) {
        console.error('Tool execution error:', toolError);
        client.sendFunctionCallOutput(id, { error: toolError.message });
      } finally {
        setIsProcessing(false);
      }
    });
  }, [persistMessage, resetTranscripts]);

  const startRecording = useCallback(async () => {
    if (!audioManagerRef.current || !realtimeClientRef.current) return;
    if (isRecording || micStartedRef.current) return;

    try {
      await audioManagerRef.current.startCapture((audioData: Int16Array) => {
        realtimeClientRef.current?.sendAudio(audioData);
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
      }, 40);
      micStartedRef.current = true;
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError('Failed to start recording');
    }
  }, [isRecording]);

  const stopRecording = useCallback(() => {
    if (!audioManagerRef.current) return;
    audioManagerRef.current.stopCapture();
    setIsRecording(false);
    micStartedRef.current = false;

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

  const interrupt = useCallback(() => {
    if (realtimeClientRef.current) {
      realtimeClientRef.current.cancelResponse();
    }
    if (audioManagerRef.current) {
      audioManagerRef.current.stopPlayback();
    }
    resetTranscripts();
    setAgentState('interrupted');
    setIsProcessing(false);
  }, [resetTranscripts]);

  const initialize = useCallback(
    async (initConfig: RealtimeConfig, configId: string | null = null) => {
      console.log('[useVoiceAgent] initialize called', {
        configId,
        hasExistingSession: !!sessionIdRef.current
      });
      try {
        setError(null);
        if (!configId) {
          throw new Error('Select an agent preset before starting the voice agent.');
        }
        setConfig(initConfig);
        setActiveConfigId(configId);
        resetTranscripts();
        savedMessagesRef.current.clear();
        messagesRef.current = [];
        setMessages([]);

        await loadMCPTools(configId);

        const sid = await createSession(initConfig, configId);
        if (!sid) throw new Error('Failed to create session');

        sessionIdRef.current = sid;
        setSessionId(sid);
        console.log('[useVoiceAgent] session row created', { sessionId: sid });

        if (!audioManagerRef.current) {
          audioManagerRef.current = getAudioManager();
        }
        if (audioManagerRef.current) {
          if (audioManagerRef.current.isReady()) {
            console.warn('[useVoiceAgent] AudioManager already ready - reusing singleton');
          } else {
            console.log('[useVoiceAgent] Initializing AudioManager singleton');
            await audioManagerRef.current.initialize();
          }
        }

        if (realtimeClientRef.current) {
          console.log('[useVoiceAgent] disposing previous realtime client instance');
          realtimeClientRef.current.disconnect();
        }
        realtimeClientRef.current = new RealtimeAPIClient(initConfig);

        attachRealtimeHandlers();
        await realtimeClientRef.current.connect();
        console.log('[useVoiceAgent] realtime socket connected');
        setAgentState('idle');
      } catch (err: any) {
        console.error('[useVoiceAgent] Failed to initialize agent:', err);

        if (audioManagerRef.current && !audioManagerRef.current.isCurrentlyInitializing()) {
          audioManagerRef.current.close(true);
          audioManagerRef.current = null;
        }
        const errorMessage = err.name === 'NotAllowedError'
          ? 'Microphone permission denied. Please allow microphone access to use the voice agent.'
          : err.name === 'NotFoundError'
          ? 'No microphone found. Please connect a microphone to use the voice agent.'
          : `Failed to initialize: ${err.message}`;
        setError(errorMessage);
        throw err;
      }
    },
    [attachRealtimeHandlers, createSession, resetTranscripts, startRecording]
  );

  const cleanup = useCallback(async () => {
    if (isCleaningUpRef.current) return;
    isCleaningUpRef.current = true;
    console.log('[useVoiceAgent] cleanup start', {
      sessionId: sessionIdRef.current,
      realtimeConnected: realtimeClientRef.current?.isConnected() ?? false
    });

    stopRecording();

    if (realtimeClientRef.current) {
      try {
        realtimeClientRef.current.disconnect();
        console.log('[useVoiceAgent] realtime socket closed during cleanup');
      } catch (cleanupErr) {
        console.warn('Error during realtime client disconnect:', cleanupErr);
      }
      realtimeClientRef.current = null;
    }

    if (audioManagerRef.current) {
      try {
        if (audioManagerRef.current.isCurrentlyInitializing()) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        audioManagerRef.current.close(true);
      } catch (cleanupErr) {
        console.warn('Error during audio manager cleanup:', cleanupErr);
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
        console.log('[useVoiceAgent] session marked ended', { sessionId: currentSessionId });
      } catch (err) {
        console.warn('Error updating session status:', err);
      }
    }

    sessionIdRef.current = null;
    setSessionId(null);
    setMessages([]);
    messagesRef.current = [];
    resetTranscripts();
    setIsProcessing(false);
    setAgentState('idle');
    setIsConnected(false);
    micStartedRef.current = false;
    isCleaningUpRef.current = false;
    shouldPersistSession.current = true;
  }, [resetTranscripts, stopRecording]);

  useEffect(() => {
    return () => {
      console.log('[useVoiceAgent] unmount effect fired', { shouldPersist: shouldPersistSession.current });
      if (!shouldPersistSession.current) {
        cleanup();
      }
    };
  }, [cleanup]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleBeforeUnload = () => {
      shouldPersistSession.current = false;
      console.log('[useVoiceAgent] beforeunload triggered cleanup');
      cleanup();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [cleanup]);

  useEffect(() => {
    if (sessionIdRef.current && realtimeClientRef.current) {
      if (!realtimeClientRef.current.isConnected()) {
        console.log('[useVoiceAgent] attempting socket reconnect on remount', { sessionId: sessionIdRef.current });
        realtimeClientRef.current.reconnect().catch((err) => {
          console.warn('Failed to reconnect realtime client on mount', err);
        });
      } else {
        console.log('[useVoiceAgent] realtime client already connected on remount');
      }
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibility = () => {
      console.log('[useVoiceAgent] visibilitychange', document.visibilityState);
      if (document.visibilityState === 'visible' && sessionIdRef.current && realtimeClientRef.current && !realtimeClientRef.current.isConnected()) {
        console.log('[useVoiceAgent] visibilitychange triggered reconnect', { sessionId: sessionIdRef.current });
        realtimeClientRef.current.reconnect().catch((err) => {
          console.warn('Failed to reconnect realtime client after visibility change', err);
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const updateConfig = useCallback((newConfig: RealtimeConfig) => {
    setConfig(newConfig);
    if (realtimeClientRef.current && isConnected) {
      realtimeClientRef.current.updateSessionConfig(newConfig);
    }
  }, [isConnected]);

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
    agentState,
    liveUserTranscript,
    liveAssistantTranscript,
    activeConfigId,
    setConfig: updateConfig,
    setActiveConfig,
    initialize,
    toggleRecording,
    interrupt,
    cleanup
  };
}
