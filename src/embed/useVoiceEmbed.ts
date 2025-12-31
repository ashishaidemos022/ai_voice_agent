import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAudioManager, AudioManager } from '../lib/audio-manager';
import { RealtimeAPIClient, AgentState } from '../lib/realtime-client';
import { executeTool, registerToolsFromServer } from '../lib/tools-registry';
import type { RealtimeConfig } from '../types/voice-agent';

type TranscriptBuffers = {
  user: Record<string, string>;
  assistant: Record<string, string>;
  activeUserId: string | null;
  activeAssistantId: string | null;
};

export type VoiceEmbedAppearance = {
  logo_url?: string | null;
  brand_name?: string | null;
  accent_color?: string | null;
  background_color?: string | null;
  surface_color?: string | null;
  text_color?: string | null;
  button_color?: string | null;
  button_text_color?: string | null;
  helper_text_color?: string | null;
  corner_radius?: number | null;
  font_family?: string | null;
  wave_color?: string | null;
  bubble_color?: string | null;
};

export type VoiceEmbedMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  thinking?: boolean;
};

export type UseVoiceEmbedResult = {
  agentMeta: {
    name: string;
    summary?: string | null;
    voice?: string | null;
  } | null;
  isLoadingMeta: boolean;
  isInitializing: boolean;
  isConnected: boolean;
  isRecording: boolean;
  agentState: AgentState;
  waveformData: Uint8Array | null;
  volume: number;
  messages: VoiceEmbedMessage[];
  liveUserTranscript: string;
  liveAssistantTranscript: string;
  error: string | null;
  fallbackReason: string | null;
  sessionId: string | null;
  agentConfigId: string | null;
  rtcEnabled: boolean;
  appearance: VoiceEmbedAppearance | null;
  toggleRecording: () => Promise<void>;
  stopSession: () => void;
  resetConversation: () => void;
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase environment variables for voice embed widget');
}

const VOICE_EMBED_URL = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/voice-ephemeral-key`;
const REQUEST_HEADERS = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`
};
const SUPPORTED_REALTIME_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
const sanitizeVoice = (voice?: string | null) => {
  if (!voice) return 'alloy';
  const normalized = voice.toLowerCase();
  return SUPPORTED_REALTIME_VOICES.includes(normalized) ? normalized : 'alloy';
};
const EMBED_LOG_PREFIX = '[voice-embed]';

export function useVoiceEmbedSession(publicId: string): UseVoiceEmbedResult {
  const [agentMeta, setAgentMeta] = useState<UseVoiceEmbedResult['agentMeta']>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(true);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [waveformData, setWaveformData] = useState<Uint8Array | null>(null);
  const [volume, setVolume] = useState(0);
  const [messages, setMessages] = useState<VoiceEmbedMessage[]>([]);
  const [liveUserTranscript, setLiveUserTranscript] = useState('');
  const [liveAssistantTranscript, setLiveAssistantTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [rtcEnabled, setRtcEnabled] = useState(true);
  const [agentConfigId, setAgentConfigId] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<VoiceEmbedAppearance | null>(null);

  const audioManagerRef = useRef<AudioManager | null>(null);
  const realtimeClientRef = useRef<RealtimeAPIClient | null>(null);
  const waveformIntervalRef = useRef<number | null>(null);
  const transcriptsRef = useRef<TranscriptBuffers>({
    user: {},
    assistant: {},
    activeUserId: null,
    activeAssistantId: null
  });
  const sessionStorageKey = useMemo(() => `va-voice-embed-session-${publicId}`, [publicId]);
  const clientSessionIdRef = useRef<string | null>(null);
  const userMicIntentRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const agentConfigIdRef = useRef<string | null>(null);
  const loadedToolsConfigRef = useRef<string | null>(null);
  const lastUserTextRef = useRef<string>('');
  const agentMetaRef = useRef<UseVoiceEmbedResult['agentMeta']>(null);

  const updateSessionId = useCallback((value: string | null) => {
    sessionIdRef.current = value;
    setSessionId(value);
  }, []);

  const updateAgentConfigId = useCallback((value: string | null) => {
    agentConfigIdRef.current = value;
    setAgentConfigId(value);
  }, []);
  const hasActiveSessionRef = useRef(false);

  useEffect(() => {
    try {
      const cached = sessionStorageKey ? window.localStorage.getItem(sessionStorageKey) : null;
      if (cached) {
        clientSessionIdRef.current = cached;
      } else {
        const nextId = crypto.randomUUID();
        clientSessionIdRef.current = nextId;
        if (sessionStorageKey) {
          window.localStorage.setItem(sessionStorageKey, nextId);
        }
      }
    } catch (storageError) {
      console.warn('[voice-embed] failed to initialize session storage', storageError);
    }
  }, [sessionStorageKey]);

  const cleanupWaveformInterval = useCallback(() => {
    if (waveformIntervalRef.current) {
      window.clearInterval(waveformIntervalRef.current);
      waveformIntervalRef.current = null;
    }
  }, []);

  /**
   * Full audio shutdown: stop mic, stop playback, and close audio resources.
   * Used for explicit user stops, session end, or disconnects.
   */
  const stopAudioCapture = useCallback(
    (options?: { reason?: string }) => {
      console.debug(EMBED_LOG_PREFIX, 'Stopping audio capture (full)', {
        reason: options?.reason
      });

      if (audioManagerRef.current) {
        audioManagerRef.current.stopCapture();
        audioManagerRef.current.stopPlayback();
        audioManagerRef.current.close();
      }

      cleanupWaveformInterval();
      setIsRecording(false);
      setWaveformData(null);
      setVolume(0);
    },
    [cleanupWaveformInterval]
  );

  const disconnectRealtime = useCallback(() => {
    if (realtimeClientRef.current) {
      realtimeClientRef.current.disconnect();
      realtimeClientRef.current = null;
    }
  }, []);

  const resetTranscripts = useCallback(() => {
    transcriptsRef.current = {
      user: {},
      assistant: {},
      activeUserId: null,
      activeAssistantId: null
    };
    setLiveAssistantTranscript('');
    setLiveUserTranscript('');
  }, []);

  const resetConversation = useCallback(() => {
    resetTranscripts();
    setMessages([]);
    setError(null);
    updateSessionId(null);
  }, [resetTranscripts, updateSessionId]);

  function attachRealtimeHandlers(client: RealtimeAPIClient, audioManager: AudioManager) {
    client.on('connected', () => {
      console.debug(EMBED_LOG_PREFIX, 'Realtime connected');
      setIsConnected(true);
      setAgentState('idle');
    });

    client.on('disconnected', () => {
      console.warn(EMBED_LOG_PREFIX, 'Realtime disconnected');
      setIsConnected(false);
      setAgentState('idle');
      stopAudioCapture({ reason: 'socket-disconnected' });
    });

    client.on('agent_state', (event) => {
      console.debug(EMBED_LOG_PREFIX, 'Agent state update', {
        next: event.state,
        reason: event.reason,
        userIntent: userMicIntentRef.current
      });

      setAgentState(event.state);

      if (event.state === 'listening') {
        audioManager.stopPlayback();
      }
    });

    client.on('audio.delta', async (event: { delta: string }) => {
      try {
        console.debug(EMBED_LOG_PREFIX, 'Audio delta received', {
          chunkBytes: event.delta?.length || 0
        });
        await audioManager.playAudioData(event.delta);
      } catch (playError) {
        console.warn('[voice-embed] failed to play audio chunk', playError);
      }
    });

    client.on('audio.done', () => {
      console.debug(EMBED_LOG_PREFIX, 'Audio stream completed');
      // Do not stop playback here; let queued buffers finish naturally.
    });

    client.on('error', (event: any) => {
      const message = event?.error || 'Realtime error';
      console.error('[voice-embed] realtime error', message);
      setError(typeof message === 'string' ? message : JSON.stringify(message));
    });

    client.on('transcript.delta', (event: any) => {
      const isUser = event.role === 'user';
      const buffers = isUser ? transcriptsRef.current.user : transcriptsRef.current.assistant;
      const activeId = isUser ? transcriptsRef.current.activeUserId : transcriptsRef.current.activeAssistantId;
      const fallbackId = isUser ? 'user-default' : 'assistant-default';
      const itemId = event.itemId || activeId || fallbackId;

      if (isUser) {
        transcriptsRef.current.activeUserId = itemId;
      } else {
        transcriptsRef.current.activeAssistantId = itemId;
      }

      buffers[itemId] = (buffers[itemId] || '') + (event.delta || '');
      if (isUser) {
        setLiveUserTranscript(buffers[itemId]);
        lastUserTextRef.current = buffers[itemId];
      } else {
        setLiveAssistantTranscript(buffers[itemId]);
      }
    });

    client.on('transcript.done', async (event: any) => {
      const isUser = event.role === 'user';
      const buffers = isUser ? transcriptsRef.current.user : transcriptsRef.current.assistant;
      const activeId = isUser ? transcriptsRef.current.activeUserId : transcriptsRef.current.activeAssistantId;
      const itemId = event.itemId || activeId || (isUser ? 'user-default' : 'assistant-default');
      const transcriptText = event.transcript || buffers[itemId] || '';

      if (!transcriptText.trim()) {
        delete buffers[itemId];
        if (isUser && transcriptsRef.current.activeUserId === itemId) {
          transcriptsRef.current.activeUserId = null;
          setLiveUserTranscript('');
        }
        if (!isUser && transcriptsRef.current.activeAssistantId === itemId) {
          transcriptsRef.current.activeAssistantId = null;
          setLiveAssistantTranscript('');
        }
        return;
      }

      if (isUser) {
        const nextMessage: VoiceEmbedMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          content: transcriptText,
          createdAt: new Date().toISOString()
        };
        setMessages((prev) => [...prev, nextMessage].slice(-30));
        lastUserTextRef.current = transcriptText;
      }

      delete buffers[itemId];
      if (isUser) {
        if (transcriptsRef.current.activeUserId === itemId) {
          transcriptsRef.current.activeUserId = null;
          setLiveUserTranscript('');
        }
      } else {
        const nextMessage: VoiceEmbedMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: transcriptText,
          createdAt: new Date().toISOString()
        };
        setMessages((prev) => [...prev, nextMessage].slice(-30));
        if (transcriptsRef.current.activeAssistantId === itemId) {
          transcriptsRef.current.activeAssistantId = null;
          setLiveAssistantTranscript('');
        }
      }
    });

    client.on('transcript.reset', (event: any) => {
      if (event.role === 'user') {
        transcriptsRef.current.user = {};
        transcriptsRef.current.activeUserId = null;
        setLiveUserTranscript('');
      } else {
        transcriptsRef.current.assistant = {};
        transcriptsRef.current.activeAssistantId = null;
        setLiveAssistantTranscript('');
      }
    });

    client.on('response.created', () => {
      setAgentState('thinking');
    });

    client.on('response.done', () => {
      setAgentState('idle');
      setLiveAssistantTranscript('');
    });

    client.on('function_call', async (event: any) => {
      const call = event?.call || {};
      const callId: string | undefined = call.id;
      const toolName: string | undefined = call.name;
      if (!toolName) {
        console.warn(EMBED_LOG_PREFIX, 'Function call missing tool name', { event });
        return;
      }

      let parsedArgs: Record<string, any> = {};
      try {
        if (typeof call.arguments === 'string') {
          parsedArgs = call.arguments ? JSON.parse(call.arguments) : {};
        } else if (call.arguments && typeof call.arguments === 'object') {
          parsedArgs = call.arguments;
        }
      } catch (parseError) {
        console.warn(EMBED_LOG_PREFIX, 'Failed to parse function call arguments', {
          toolName,
          raw: call.arguments,
          error: parseError
        });
      }

      const currentSessionId = sessionIdRef.current;
      if (!currentSessionId) {
        const message = 'Voice session missing for tool execution';
        console.warn(EMBED_LOG_PREFIX, message, { toolName });
        client.sendFunctionCallOutput(callId || crypto.randomUUID(), { error: message });
        return;
      }
      try {
        console.debug(EMBED_LOG_PREFIX, 'Executing tool for realtime function call', {
          toolName,
          parsedArgs,
          sessionId: currentSessionId
        });
        const result = await executeTool(toolName, parsedArgs, {
          sessionId: currentSessionId,
          source: 'voice-embed'
        });
        client.sendFunctionCallOutput(callId || crypto.randomUUID(), result);
      } catch (toolError: any) {
        const message = toolError?.message || 'Tool execution failed';
        console.error(EMBED_LOG_PREFIX, 'Tool execution error', {
          toolName,
          error: message
        });
        setError(message);
        client.sendFunctionCallOutput(callId || crypto.randomUUID(), { error: message });
      }
    });
  }

  const ensureSession = useCallback(async () => {
    if (realtimeClientRef.current && audioManagerRef.current) {
      console.debug(EMBED_LOG_PREFIX, 'ensureSession noop - existing client');
      return;
    }
    console.debug(EMBED_LOG_PREFIX, 'ensureSession start', {
      publicId,
      hasClient: !!realtimeClientRef.current
    });
    setIsInitializing(true);
    setError(null);
    try {
      const response = await fetch(VOICE_EMBED_URL, {
        method: 'POST',
        headers: REQUEST_HEADERS,
        body: JSON.stringify({
          public_id: publicId,
          client_session_id: clientSessionIdRef.current || undefined
        })
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || 'Failed to create realtime session');
      }
      updateSessionId(json.session_id || null);
      const nextConfigId: string | null = json?.agent?.id || agentConfigIdRef.current || null;
      updateAgentConfigId(nextConfigId);
      if (json?.tools) {
        registerToolsFromServer(json.tools);
        loadedToolsConfigRef.current = nextConfigId;
      } else if (loadedToolsConfigRef.current !== nextConfigId) {
        registerToolsFromServer([]);
        loadedToolsConfigRef.current = nextConfigId;
      }
      setRtcEnabled(Boolean(json?.settings?.rtc_enabled ?? true));
      setAppearance((json?.settings?.appearance as VoiceEmbedAppearance) || null);
      setAgentMeta((prev) => ({
        name: json?.agent?.name || prev?.name || 'Voice Agent',
        summary: json?.agent?.summary || prev?.summary || null,
        voice: sanitizeVoice(json?.agent?.voice || prev?.voice || null)
      }));
      agentMetaRef.current = {
        name: json?.agent?.name || 'Voice Agent',
        summary: json?.agent?.summary || null,
        voice: sanitizeVoice(json?.agent?.voice || null)
      };

      const realtimeConfig: RealtimeConfig = {
        model: json?.agent?.model || 'gpt-4o-realtime-preview',
        voice: sanitizeVoice(json?.agent?.voice),
        instructions: json?.agent?.instructions || 'You are a helpful AI voice assistant.',
        temperature: 0.8,
        max_response_output_tokens: 1024,
        turn_detection: {
          type: 'server_vad',
          threshold: 0.75,
          prefix_padding_ms: 150,
          silence_duration_ms: 700
        }
      };

      const audioManager = getAudioManager();
      const realtimeClient = new RealtimeAPIClient(realtimeConfig, {
        apiKey: json.token,
        allowInterruptions: true
      });
      audioManagerRef.current = audioManager;
      realtimeClientRef.current = realtimeClient;
      attachRealtimeHandlers(realtimeClient, audioManager);
      await realtimeClient.connect();
      hasActiveSessionRef.current = true;
      console.debug(EMBED_LOG_PREFIX, 'Realtime session ready', {
        rtcEnabled: json?.settings?.rtc_enabled,
        model: realtimeConfig.model,
        voice: realtimeConfig.voice
      });
    } finally {
      setIsInitializing(false);
    }
  }, [publicId, updateAgentConfigId, updateSessionId]);

  const beginCapture = useCallback(async () => {
    if (!realtimeClientRef.current || !audioManagerRef.current) {
      await ensureSession();
    }
    if (!audioManagerRef.current || !realtimeClientRef.current) {
      throw new Error('Voice session is not ready yet');
    }
    console.debug(EMBED_LOG_PREFIX, 'Starting capture');
    await audioManagerRef.current.initialize();
    await audioManagerRef.current.startCapture((data: Int16Array) => {
      realtimeClientRef.current?.sendAudio(data);
    });
    setIsRecording(true);
    cleanupWaveformInterval();
    waveformIntervalRef.current = window.setInterval(() => {
      if (!audioManagerRef.current) return;
      const waveform = audioManagerRef.current.getWaveformData();
      const currentVolume = audioManagerRef.current.getVolume();
      if (waveform) {
        setWaveformData(new Uint8Array(waveform));
        setVolume(currentVolume);
      }
    }, 40);
    console.debug(EMBED_LOG_PREFIX, 'Capture running');
  }, [cleanupWaveformInterval, ensureSession]);

  const fetchMetadata = useCallback(async () => {
    if (!publicId) return;
    setIsLoadingMeta(true);
    setError(null);
    try {
      const url = new URL(VOICE_EMBED_URL);
      url.searchParams.set('public_id', publicId);
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: REQUEST_HEADERS
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || 'Unable to load voice embed');
      }
      setAgentMeta((prev) => ({
        name: json?.agent?.name || prev?.name || 'Voice Agent',
        summary: json?.agent?.summary || prev?.summary || null,
        voice: sanitizeVoice(json?.agent?.voice || prev?.voice || null)
      }));
      updateAgentConfigId(json?.agent?.id || null);
      setRtcEnabled(Boolean(json?.settings?.rtc_enabled ?? true));
      setAppearance((json?.settings?.appearance as VoiceEmbedAppearance) || null);
    } catch (metaError: any) {
      setError(metaError?.message || 'Failed to load voice embed');
    } finally {
      setIsLoadingMeta(false);
    }
  }, [publicId, updateAgentConfigId]);

  useEffect(() => {
    fetchMetadata();
  }, [fetchMetadata]);

  const startRecording = useCallback(async () => {
    if (isRecording) return;
    try {
      userMicIntentRef.current = true;
      console.debug(EMBED_LOG_PREFIX, 'User toggled mic on');
      await beginCapture();
    } catch (recordError: any) {
      console.error('[voice-embed] startRecording error', recordError);
      const message = recordError?.message || 'Unable to access microphone';
      setError(message);
      if (/microphone/i.test(message) || /permission/i.test(message)) {
        setFallbackReason(message);
      }
      userMicIntentRef.current = false;
      stopAudioCapture({ reason: 'start-failed' });
      disconnectRealtime();
      throw recordError;
    }
  }, [beginCapture, disconnectRealtime, isRecording, setError, setFallbackReason, stopAudioCapture]);

  const stopRecording = useCallback(() => {
    userMicIntentRef.current = false;
    console.debug(EMBED_LOG_PREFIX, 'User toggled mic off');
    stopAudioCapture({ reason: 'user-toggle-off' });
  }, [stopAudioCapture]);

  const toggleRecording = useCallback(async () => {
    setError(null);
    setFallbackReason(null);
    if (isRecording || userMicIntentRef.current) {
      stopRecording();
      return;
    }
    try {
      await startRecording();
    } catch {
      // handled inside startRecording
    }
  }, [isRecording, startRecording, stopRecording]);

  const stopSessionInternal = useCallback(
    (source: string = 'manual') => {
      if (!hasActiveSessionRef.current) {
        console.debug(EMBED_LOG_PREFIX, 'stopSession skipped - no active session', { source });
        return;
      }
      hasActiveSessionRef.current = false;
      userMicIntentRef.current = false;
      console.debug(EMBED_LOG_PREFIX, 'Stopping embed session', { source });
      stopAudioCapture({ reason: `stop-session:${source}` });
      disconnectRealtime();
      resetTranscripts();
      setAgentState('idle');
      setIsConnected(false);
      updateSessionId(null);
    },
    [disconnectRealtime, resetTranscripts, stopAudioCapture, updateSessionId]
  );

  const stopSession = useCallback(() => {
    stopSessionInternal('manual');
  }, [stopSessionInternal]);

  // Always tear down the session when the component truly unmounts.
  const strictCleanupSkippedRef = useRef(false);
  useEffect(() => {
    return () => {
      if (strictCleanupSkippedRef.current) {
        stopSessionInternal('unmount');
      } else {
        strictCleanupSkippedRef.current = true;
      }
    };
  }, [stopSessionInternal]);

  // Ensure we stop cleanly on browser navigation/refresh.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return () => {};
    }
    const handleBeforeUnload = () => {
      stopSessionInternal('beforeunload');
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [stopSessionInternal]);

  return {
    agentMeta,
    isLoadingMeta,
    isInitializing,
    isConnected,
    isRecording,
    agentState,
    waveformData,
    volume,
    messages,
    liveUserTranscript,
    liveAssistantTranscript,
    error,
    fallbackReason,
    sessionId,
    agentConfigId,
    rtcEnabled,
    appearance,
    toggleRecording,
    stopSession,
    resetConversation
  };
}
