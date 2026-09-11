import { liveVoiceSession, LIVE_VOICE_INSTRUCTIONS } from '../../shared/live-voice';
import { RealtimeConfig } from '../types/voice-agent';
import { isGPTLiveModel, OPENAI_MODELS } from '../../shared/openai-models';
import {
  getXAIVoiceLanguageLabel,
  normalizeXAIVoiceLanguage
} from '../../shared/xai-voice-models';
import { getToolSchemas } from './tools-registry';
import { getAudioManager } from './audio-manager';
import {
  beginBenchmarkTurn,
  emitBenchmarkEvent,
  emitBenchmarkMilestone,
  getBenchmarkTrace,
  recordBenchmarkWaveform
} from './benchmark-instrumentation';
import { saveBenchmarkOutputAudio } from './benchmark-audio-store';

export type AgentState = 'idle' | 'listening' | 'speaking' | 'thinking' | 'interrupted';

export type RealtimeEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'error'; error: string }
  | { type: 'agent_state'; state: AgentState; reason?: string }
  | { type: 'audio.delta'; delta: string }
  | { type: 'audio.done' }
  | {
      type: 'transcript.delta';
      delta: string;
      role: 'user' | 'assistant';
      itemId?: string;
    }
  | {
      type: 'transcript.done';
      transcript: string;
      role: 'user' | 'assistant';
      itemId?: string;
      logprobs?: Array<{ token?: string; logprob?: number; bytes?: number[] }>;
      usage?: Record<string, unknown>;
    }
  | { type: 'transcript.reset'; role: 'user' | 'assistant'; itemId?: string }
  | { type: 'text.delta'; delta: string }
  | { type: 'text.done'; text: string }
  | { type: 'response.created'; id?: string }
  | { type: 'response.done'; response: any }
  | { type: 'usage.reported'; usage: any; response?: any }
  | { type: 'provider.metrics'; provider: string; metrics: Record<string, number | null> }
  | { type: 'interruption' }
  | {
      type: 'function_call';
      call: { id: string; name: string; arguments: string };
    }
  | { type: 'conversation.item.created'; item: any }
  | { type: 'session.updated' }
  | { type: 'speech.started' }
  | { type: 'speech.stopped' };

type RealtimeClientOptions = {
  routedVoice?: boolean;
  apiKey?: string;
  provider?: 'openai' | 'xai';
  tools?: ReturnType<typeof getToolSchemas>;
  allowInterruptions?: boolean;
  textOnly?: boolean;
  webrtc?: {
    sessionUrl: string;
    headers?: Record<string, string>;
  };
};

export class RealtimeAPIClient {
  private ws: WebSocket | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private mediaStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private config: RealtimeConfig;
  private eventHandlers: Map<string, Set<(event: any) => void>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private agentState: AgentState = 'idle';
  private intentionalClose = false;
  private hasBufferedAudio = false;
  private bufferedSamples = 0;
  private hasReceivedAudio = false;
  private sessionUpdateSent = false;
  private overrideApiKey?: string;
  private provider: 'openai' | 'xai';
  private overrideTools?: ReturnType<typeof getToolSchemas>;
  private activeResponseCount = 0;
  private cancelPending = false;
  private allowInterruptions: boolean;
  private textOnly: boolean;
  private webrtc?: RealtimeClientOptions['webrtc'];
  private remoteRecorder: MediaRecorder | null = null;
  private remoteRecordingChunks: Blob[] = [];
  private remoteWaveformContext: AudioContext | null = null;
  private remoteWaveformTimer: number | null = null;
  private remoteAnalyser: AnalyserNode | null = null;
  private remoteSamples: Uint8Array | null = null;
  private routedVoice = false;
  private routedSpeechRequested = false;
  private suppressRoutedAudio = false;
  private pendingRoutedAnswer: string | null = null;
  private outputAudioBufferStartedAt: number | null = null;
  private readonly usesGPTLive: boolean;
  private liveSessionStarted = false;
  private liveSessionReadyResolve: (() => void) | null = null;
  private liveSessionReadyReject: ((error: Error) => void) | null = null;
  private liveCloseTimer: number | null = null;
  private liveTranscriptSequence = { user: 0, assistant: 0 };
  private liveTranscriptBuffers = { user: '', assistant: '' };
  private liveTranscriptIds: { user: string | null; assistant: string | null } = {
    user: null,
    assistant: null
  };
  private liveTranscriptTimers: { user: number | null; assistant: number | null } = {
    user: null,
    assistant: null
  };
  private liveDelegationResponses = new Map<string, {
    pendingCalls: Set<string>;
    returnedCalls: Set<string>;
    completed: boolean;
    continued: boolean;
  }>();
  private liveDelegationResponseIds = new Map<string, string>();
  private liveCallResponseIds = new Map<string, string>();

  constructor(config: RealtimeConfig, options?: RealtimeClientOptions) {
    this.config = config;
    this.routedVoice = options?.routedVoice ?? false;
    this.overrideApiKey = options?.apiKey;
    this.provider = options?.provider ?? 'openai';
    this.overrideTools = options?.tools;
    this.allowInterruptions = options?.allowInterruptions ?? true;
    this.textOnly = options?.textOnly ?? false;
    this.webrtc = options?.webrtc;
    this.usesGPTLive = this.provider === 'openai' && isGPTLiveModel(config.model);
  }

  updateSessionConfig(newConfig: RealtimeConfig): void {
    this.config = newConfig;
    if (this.isConnected()) {
      this.sessionUpdateSent = false;
      this.sendSessionUpdate();
    }
  }

  async connect(): Promise<void> {
    emitBenchmarkEvent('session.connect_started', {
      transport: this.webrtc ? 'webrtc' : 'websocket'
    });
    this.intentionalClose = false;
    this.sessionUpdateSent = false;
    this.hasReceivedAudio = false;
    this.hasBufferedAudio = false;
    this.bufferedSamples = 0;
    this.activeResponseCount = 0;
    this.cancelPending = false;
    this.liveSessionStarted = false;
    if (this.remoteRecorder?.state === 'recording') {
      try {
        this.remoteRecorder.stop();
      } catch {
        // recorder is already closing
      }
    }
    this.remoteRecorder = null;
    if (this.remoteWaveformTimer) window.clearInterval(this.remoteWaveformTimer);
    this.remoteWaveformTimer = null;
    if (this.remoteWaveformContext && this.remoteWaveformContext.state !== 'closed') {
      void this.remoteWaveformContext.close();
    }
    this.remoteWaveformContext = null;
    this.remoteAnalyser = null;
    this.remoteSamples = null;
    if (this.webrtc) {
      return this.connectWebRTC();
    }

    const apiKey = this.overrideApiKey;
    if (!apiKey) {
      throw new Error('WebSocket transport requires a server-issued ephemeral provider key');
    }

    return new Promise((resolve, reject) => {
      try {
        const isXAI = this.provider === 'xai';
        const url = isXAI
          ? `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(this.config.model)}`
          : `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.config.model)}`;
        const protocols = isXAI
          ? [`xai-client-secret.${apiKey}`]
          : ['realtime', `openai-insecure-api-key.${apiKey}`];
        this.ws = new WebSocket(url, protocols);

        this.ws.onopen = () => {
          console.log('WebSocket connected successfully');
          this.reconnectAttempts = 0;
          this.emit({ type: 'connected' });
          emitBenchmarkEvent('session.connected', { transport: 'websocket' });
          this.sendSessionUpdate();
          resolve();
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket closed:', {
            code: event.code,
            reason: event.reason || 'No reason provided',
            wasClean: event.wasClean
          });

          if (event.code === 1005) {
            console.error('Connection closed without status - possible authentication or protocol issue');
          } else if (event.code === 1006) {
            console.error('Connection closed abnormally');
          } else if (event.code === 1008) {
            console.error('Connection closed due to policy violation');
          }

          this.emit({
            type: 'disconnected',
            reason: event.reason || `code:${event.code}`
          });
          emitBenchmarkEvent('session.disconnected', {
            reason: event.reason || `code:${event.code}`
          });
          this.setAgentState('idle', 'socket-closed');

          const shouldRetry = !this.intentionalClose && this.reconnectAttempts < this.maxReconnectAttempts;
          if (shouldRetry) {
            this.attemptReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.emit({ type: 'error', error: 'WebSocket connection error' });
          emitBenchmarkEvent('session.error', { transport: 'websocket' });
          reject(error);
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleServerMessage(message);
          } catch (error) {
            console.error('Failed to parse message:', error, event.data);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private async connectWebRTC(): Promise<void> {
    if (!this.webrtc) throw new Error('WebRTC session endpoint is not configured');

    const pc = new RTCPeerConnection();
    this.peerConnection = pc;
    pc.onconnectionstatechange = () => {
      console.log('[Realtime WebRTC] peer connection state', pc.connectionState);
    };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: this.routedVoice ? { echoCancellation: true, noiseSuppression: true } : true });
    if (this.intentionalClose || this.peerConnection !== pc) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('Voice connection canceled');
    }
    this.mediaStream = stream;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = false;
      pc.addTrack(track, stream);
    });
    this.setupWaveformAnalysis(stream);

    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.onplaying = () => emitBenchmarkMilestone('playback.started', { transport: 'webrtc' });
    this.remoteAudio = audio;
    pc.ontrack = (event) => {
      audio.srcObject = event.streams[0];
      if (!this.remoteWaveformContext) {
        try {
          this.remoteWaveformContext = new AudioContext();
          const source = this.remoteWaveformContext.createMediaStreamSource(event.streams[0]);
          this.remoteAnalyser = this.remoteWaveformContext.createAnalyser();
          this.remoteAnalyser.fftSize = 256;
          source.connect(this.remoteAnalyser);
          this.remoteSamples = new Uint8Array(this.remoteAnalyser.frequencyBinCount);
          if (getBenchmarkTrace()) {
            this.remoteWaveformTimer = window.setInterval(() => {
              recordBenchmarkWaveform('output', this.getOutputVolume());
            }, 40);
          }
        } catch (error) {
          console.warn('[VoiceBenchmark] native waveform capture unavailable', error);
        }
      }
      if (getBenchmarkTrace() && typeof MediaRecorder !== 'undefined' && !this.remoteRecorder) {
        try {
          this.remoteRecorder = new MediaRecorder(event.streams[0]);
          this.remoteRecorder.ondataavailable = (recorded) => {
            if (recorded.data.size) this.remoteRecordingChunks.push(recorded.data);
          };
          this.remoteRecorder.start();
        } catch (error) {
          console.warn('[VoiceBenchmark] native output recording unavailable', error);
        }
      }
      void audio.play().catch((error) => {
        console.warn('Remote audio autoplay was blocked', error);
        if (this.routedVoice) this.emit({ type: 'error', error: 'Browser blocked audio playback. Reconnect the microphone to allow live audio.' });
      });
    };

    const channel = pc.createDataChannel('oai-events');
    this.dataChannel = channel;
    channel.onopen = () => {
      console.log('[Realtime WebRTC] data channel open');
    };
    channel.onmessage = (event) => {
      try {
        this.handleServerMessage(JSON.parse(event.data));
      } catch (error) {
        console.error('Failed to parse Realtime data-channel message', error);
      }
    };
    channel.onerror = () => this.emit({ type: 'error', error: 'Realtime WebRTC data channel error' });
    channel.onclose = () => {
      this.liveSessionReadyReject?.(new Error('GPT-Live data channel closed before session startup'));
      this.liveSessionReadyResolve = null;
      this.liveSessionReadyReject = null;
      if (!this.intentionalClose) {
        this.emit({
          type: 'disconnected',
          reason: 'webrtc-data-channel-closed'
        });
        this.setAgentState('idle', 'webrtc-data-channel-closed');
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const liveSessionReady = this.usesGPTLive
      ? new Promise<void>((resolve, reject) => {
          this.liveSessionReadyResolve = resolve;
          this.liveSessionReadyReject = reject;
        })
      : null;
    const response = await fetch(this.webrtc.sessionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': this.usesGPTLive ? 'application/json' : 'application/sdp',
        ...(this.webrtc.headers || {})
      },
      body: this.usesGPTLive
        ? JSON.stringify({ transport: 'webrtc', sdp: offer.sdp })
        : offer.sdp
    });
    console.log('[Realtime WebRTC] session handshake response', {
      status: response.status,
      live: this.usesGPTLive
    });
    if (!response.ok) {
      const detail = await response.text();
      this.disconnect();
      throw new Error(detail || `Failed to create WebRTC session (${response.status})`);
    }
    if (this.intentionalClose || this.peerConnection !== pc) throw new Error('Voice connection canceled');
    const responseBody = await response.text();
    let answerSdp = responseBody;
    if (this.usesGPTLive) {
      const payload = JSON.parse(responseBody);
      answerSdp = payload?.transport?.sdp;
      if (typeof answerSdp !== 'string' || !answerSdp.trim()) {
        this.disconnect();
        throw new Error('GPT-Live session response is missing the SDP answer');
      }
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    console.log('[Realtime WebRTC] remote description applied', { live: this.usesGPTLive });

    const finalizeConnection = () => {
      this.reconnectAttempts = 0;
      this.emit({ type: 'connected' });
      emitBenchmarkEvent('session.connected', { transport: 'webrtc' });
      if (!this.usesGPTLive) this.sendSessionUpdate();
    };
    if (liveSessionReady) {
      const timeout = window.setTimeout(() => {
        this.liveSessionReadyReject?.(new Error('GPT-Live session startup timeout'));
      }, 15_000);
      try {
        await liveSessionReady;
        finalizeConnection();
      } finally {
        window.clearTimeout(timeout);
        this.liveSessionReadyResolve = null;
        this.liveSessionReadyReject = null;
      }
      return;
    }
    if (channel.readyState === 'open') {
      finalizeConnection();
    } else {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          this.disconnect();
          reject(new Error('Realtime WebRTC data channel timeout'));
        }, 15_000);
        channel.onopen = () => {
          window.clearTimeout(timeout);
          finalizeConnection();
          resolve();
        };
      });
    }
  }

  private setupWaveformAnalysis(stream: MediaStream): void {
    try {
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
    } catch (error) {
      console.warn('Unable to initialize WebRTC waveform analysis', error);
    }
  }

  async reconnect(): Promise<void> {
    console.log('[RealtimeAPIClient] reconnect requested', {
      hasSocket: !!this.ws,
      readyState: this.ws?.readyState
    });
    if (this.isConnected() || (this.ws && this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.intentionalClose = false;
    this.sessionUpdateSent = false;
    this.activeResponseCount = 0;
    this.cancelPending = false;
    return this.connect();
  }

  sendSessionUpdate(): void {
    if (this.usesGPTLive) return;
    if (this.sessionUpdateSent) {
      console.log('Session update already sent, skipping duplicate');
      return;
    }
    if (this.routedVoice) {
      this.send({ type: 'session.update', session: this.provider === 'xai' ? { voice: this.config.voice, instructions: LIVE_VOICE_INSTRUCTIONS, turn_detection: null, tools: [], audio: { output: { format: { type: 'audio/pcm', rate: 24000 } } } } : liveVoiceSession({ model: this.config.model, voice: this.config.voice, textOnly: this.textOnly, turn_detection: this.config.turn_detection }) });
      this.sessionUpdateSent = true;
      return;
    }
    const tools = this.overrideTools ?? getToolSchemas();
    const isXAI = this.provider === 'xai';
    const xaiLanguage = normalizeXAIVoiceLanguage(this.config.voice_provider_config?.xai_language);
    const languageInstruction = isXAI
      ? xaiLanguage === 'auto'
        ? "Detect the language of the user's latest utterance and respond naturally in that language. Switch languages immediately when the user switches languages or explicitly requests another language."
        : `Respond in ${getXAIVoiceLanguageLabel(xaiLanguage)} unless the user explicitly requests another language.`
      : 'Always respond in English unless the user explicitly requests a different language.';
    const a2uiInstruction = this.config.a2ui_enabled
      ? '\n\nWhen useful, you may include a JSON object with {"a2ui":{"version":"0.8","ui":<tree>},"fallback_text":"..."}.\nIf A2UI is not needed, respond normally with text.\nFor time/weather requests, prefer a Card with props {variant:\"time\", icon, title, subtitle, meta, badges, accent_color} and children Text nodes for the main time/weather values.'
      : '';
    const ragInstructions =
      this.config.rag_mode === 'guardrail'
        ? `${this.config.instructions}\n\nIf relevant knowledge from the approved knowledge base is unavailable, respond with "I do not have enough knowledge to answer that yet."\n\n${languageInstruction}${a2uiInstruction}`
        : `${this.config.instructions}\n\n${languageInstruction}${a2uiInstruction}`;
    const sessionConfig: any = {
      type: 'session.update',
      session: isXAI ? {
        voice: this.config.voice,
        instructions: ragInstructions,
        reasoning: {
          effort: this.config.voice_provider_config?.reasoning_effort === 'none' ? 'none' : 'high'
        },
        tools,
        tool_choice: 'auto',
        turn_detection: this.config.turn_detection === null
          ? null
          : this.config.turn_detection ?? {
              type: 'server_vad',
              threshold: 0.75,
              prefix_padding_ms: 150,
              silence_duration_ms: 700
            },
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: {
              model: 'grok-transcribe',
              ...(xaiLanguage !== 'auto' ? { language_hint: xaiLanguage } : {})
            }
          },
          output: { format: { type: 'audio/pcm', rate: 24000 } }
        }
      } : {
        type: 'realtime',
        model: this.config.model,
        output_modalities: this.textOnly ? ['text'] : ['audio'],
        instructions: ragInstructions,
        tools,
        tool_choice: 'auto',
        max_output_tokens: this.config.max_response_output_tokens
      }
    };
    if (!isXAI) sessionConfig.session.audio = {
      input: {
        ...(!this.webrtc ? { format: { type: 'audio/pcm', rate: 24000 } } : {}),
        transcription: {
          model: OPENAI_MODELS.transcription.accurate,
          language: 'en'
        },
        turn_detection: this.config.turn_detection === null
          ? null
          : this.config.turn_detection ?? {
              type: 'server_vad',
              threshold: 0.75,
              prefix_padding_ms: 150,
              silence_duration_ms: 700
            }
      },
      ...(!this.textOnly
        ? {
            output: {
              ...(!this.webrtc ? { format: { type: 'audio/pcm' } } : {}),
              voice: this.config.voice
            }
          }
        : {})
    };

    console.log('📤 Sending session.update', {
      turnDetection: sessionConfig.session.audio?.input?.turn_detection,
      voice: sessionConfig.session.audio?.output?.voice,
      model: this.config.model
    });

    this.send(sessionConfig);
    this.sessionUpdateSent = true;
  }

  private handleServerMessage(message: any): void {
    switch (message.type) {
      case 'session.started':
        this.liveSessionStarted = true;
        this.liveSessionReadyResolve?.();
        this.emit({ type: 'session.updated' });
        this.setAgentState('idle', 'live-session-started');
        break;

      case 'session.input_transcript.delta':
        this.handleLiveTranscript('user', message);
        break;

      case 'session.output_transcript.delta':
        this.handleLiveTranscript('assistant', message);
        break;

      case 'session.usage.updated':
        this.emit({
          type: 'usage.reported',
          usage: { voice_duration_seconds: message.usage?.seconds ?? null },
          response: message
        });
        this.emit({
          type: 'provider.metrics',
          provider: 'openai_live',
          metrics: { voiceDurationSeconds: message.usage?.seconds ?? null }
        });
        break;

      case 'response.event':
        this.handleLiveResponseEvent(message);
        break;

      case 'session.delegation.created':
        if (message.target === 'responses' && typeof message.response_id === 'string') {
          this.ensureLiveDelegationResponse(message.response_id);
          if (typeof message.delegation_id === 'string') {
            this.liveDelegationResponseIds.set(message.delegation_id, message.response_id);
          }
        }
        break;

      case 'session.closed':
        this.flushLiveTranscript('user');
        this.flushLiveTranscript('assistant');
        this.emit({
          type: 'usage.reported',
          usage: { voice_duration_seconds: message.usage?.seconds ?? null },
          response: message
        });
        this.emit({ type: 'disconnected', reason: message.reason || 'session-closed' });
        this.forceDisconnect();
        break;

      case 'session.created':
        console.log('Session created successfully');
        break;

      case 'session.updated':
        console.log('✅ Session updated');
        this.emit({ type: 'session.updated' });
        break;

      case 'input_audio_buffer.speech_started':
        if (this.agentState === 'speaking' && this.allowInterruptions) {
          emitBenchmarkEvent('interruption.requested', { source: 'vad' });
        }
        beginBenchmarkTurn();
        emitBenchmarkEvent('vad.speech_started');
        this.emit({ type: 'speech.started' });
        // Server VAD has already detected speech in the current input buffer.
        // Never clear that buffer here: doing so erases the active utterance.
        this.bufferedSamples = 0;
        this.hasBufferedAudio = false;
        this.hasReceivedAudio = false;
        if (this.agentState === 'speaking' && this.allowInterruptions) {
          this.cancelResponse();
          this.emit({ type: 'interruption' });
        }
        this.emit({ type: 'transcript.reset', role: 'user' });
        this.setAgentState('listening');
        break;

      case 'input_audio_buffer.speech_stopped':
        emitBenchmarkEvent('vad.speech_stopped');
        this.emit({ type: 'speech.stopped' });
        // With server VAD, let the server handle commit; just reset local flags
        this.hasBufferedAudio = false;
        this.hasReceivedAudio = false;
        this.bufferedSamples = 0;
        this.setAgentState('thinking');
        break;

      case 'input_audio_buffer.committed':
        break;
      case 'input_audio_buffer.cleared':
        this.hasBufferedAudio = false;
        this.hasReceivedAudio = false;
        this.bufferedSamples = 0;
        break;

      case 'conversation.item.input_audio_transcription.delta':
        this.emit({
          type: 'transcript.delta',
          delta: message.delta,
          role: 'user',
          itemId: message.item_id
        });
        break;

      case 'conversation.item.input_audio_transcription.updated':
        this.emit({ type: 'transcript.reset', role: 'user', itemId: message.item_id });
        this.emit({
          type: 'transcript.delta',
          delta: message.transcript || '',
          role: 'user',
          itemId: message.item_id
        });
        break;

      case 'conversation.item.input_audio_transcription.completed':
        this.emit({
          type: 'transcript.done',
          transcript: message.transcript,
          role: 'user',
          itemId: message.item_id,
          logprobs: message.logprobs,
          usage: message.usage
        });
        break;

      case 'response.created':
        emitBenchmarkMilestone('response.created', {
          response_id: message.response?.id
        });
        this.markResponseCreated();
        if (this.routedVoice && this.suppressRoutedAudio) this.cancelResponse({ suppressState: true });
        this.setAgentState('thinking');
        this.emit({ type: 'response.created', id: message.response?.id });
        break;

      case 'response.audio.delta':
        if (this.routedVoice && this.suppressRoutedAudio) break;
        if (this.textOnly) break;
        emitBenchmarkMilestone('audio.first_chunk', { source: 'openai' });
        this.setAgentState('speaking');
        this.emit({ type: 'audio.delta', delta: message.delta });
        break;

      case 'response.audio.done':
        if (this.textOnly) break;
        this.emit({ type: 'audio.done' });
        break;

      case 'response.audio_transcript.delta':
        emitBenchmarkMilestone('response.first_text', { source: 'openai_audio_transcript' });
        this.emit({
          type: 'transcript.delta',
          delta: message.delta,
          role: 'assistant',
          itemId: message.item_id
        });
        break;

      case 'response.audio_transcript.done':
        this.emit({
          type: 'transcript.done',
          transcript: message.transcript,
          role: 'assistant',
          itemId: message.item_id
        });
        break;

      // Newer Realtime event names (output_*). Mirror the legacy audio.* behavior.
      case 'response.output_audio.delta':
        if (this.routedVoice && this.suppressRoutedAudio) break;
        if (this.textOnly) break;
        emitBenchmarkMilestone('audio.first_chunk', { source: 'openai' });
        this.setAgentState('speaking');
        this.emit({ type: 'audio.delta', delta: message.delta });
        break;

      case 'response.output_audio.done':
        if (this.textOnly) break;
        this.emit({ type: 'audio.done' });
        break;
      case 'response.output_text.delta':
      case 'response.text.delta':
        emitBenchmarkMilestone('response.first_text', { source: 'openai' });
        this.emit({ type: 'text.delta', delta: message.delta || '' });
        break;
      case 'response.output_text.done':
      case 'response.text.done':
        this.emit({
          type: 'text.done',
          text: message.output_text || message.text || ''
        });
        break;

      case 'response.output_audio_transcript.delta':
        emitBenchmarkMilestone('response.first_text', { source: 'openai_audio_transcript' });
        this.emit({
          type: 'transcript.delta',
          delta: message.delta,
          role: 'assistant',
          itemId: message.item_id
        });
        break;

      case 'response.output_audio_transcript.done':
        this.emit({
          type: 'transcript.done',
          transcript: message.transcript,
          role: 'assistant',
          itemId: message.item_id
        });
        break;

      case 'response.output_item.added':
        console.log('🧩 Response item added:', message.item);
        break;

      case 'response.output_item.done':
        console.log('🧩 Response item done:', message.item);
        break;

      case 'response.content_part.added':
        console.log('🧩 Content part added:', message.part);
        break;

      case 'response.content_part.done':
        console.log('🧩 Content part done:', message.part);
        break;

      case 'response.function_call_arguments.delta':
        console.log('🛠️ Function call args delta:', message.delta);
        break;

      case 'response.function_call_arguments.done':
        console.log('🛠️ Function call args done:', {
          name: message.name,
          arguments: message.arguments
        });
        this.emit({
          type: 'function_call',
          call: {
            id: message.call_id,
            name: message.name,
            arguments: message.arguments
          }
        });
        break;

      case 'response.interrupted':
      case 'response.canceled':
      case 'response.cancelled': // handle both spellings just in case
        this.markResponseFinished();
        this.setAgentState('interrupted');
        this.emit({ type: 'interruption' });
        this.hasBufferedAudio = false;
        this.bufferedSamples = 0;
        break;

      case 'response.completed':
      case 'response.done': {
        this.preserveRemoteBenchmarkAudio();
        emitBenchmarkEvent('response.completed');
        this.markResponseFinished();
        this.setAgentState('idle');
        const response = message.response ?? message;
        this.emit({ type: 'response.done', response });
        if (this.routedVoice) {
          this.routedSpeechRequested = false;
          const pending = this.pendingRoutedAnswer; this.pendingRoutedAnswer = null;
          if (pending) this.speakAnswer(pending);
        }
        if (response?.usage) {
          this.emit({
            type: 'usage.reported',
            usage: response.usage,
            response
          });
          this.emit({
            type: 'provider.metrics',
            provider: this.provider === 'xai' ? 'xai_realtime' : 'openai_realtime',
            metrics: {
              inputAudioTokens: response.usage?.input_token_details?.audio_tokens ?? null,
              outputAudioTokens: response.usage?.output_token_details?.audio_tokens ?? null
            }
          });
        }
        break;
      }

      case 'output_audio_buffer.started':
        this.outputAudioBufferStartedAt = performance.now();
        this.emit({
          type: 'provider.metrics',
          provider: this.provider === 'xai' ? 'xai_realtime' : 'openai_realtime',
          metrics: { outputAudioBufferStarted: 0 }
        });
        break;

      case 'output_audio_buffer.stopped': {
        const stoppedAt = performance.now();
        this.emit({
          type: 'provider.metrics',
          provider: this.provider === 'xai' ? 'xai_realtime' : 'openai_realtime',
          metrics: {
            outputAudioBufferDurationMs:
              this.outputAudioBufferStartedAt === null ? null : stoppedAt - this.outputAudioBufferStartedAt
          }
        });
        this.outputAudioBufferStartedAt = null;
        break;
      }

      case 'conversation.item.created':
        this.emit({ type: 'conversation.item.created', item: message.item });
        break;

      case 'rate_limits.updated':
        break;

      case 'error':
        // Server VAD may win the race with the client's cancellation.
        if (this.routedVoice && this.suppressRoutedAudio && message.error?.code === 'response_cancel_not_active') {
          this.cancelPending = false;
          break;
        }
        console.error('Server error:', message.error);
        this.emit({
          type: 'error',
          error: message.error.message || JSON.stringify(message.error)
        });
        emitBenchmarkEvent('session.error', {
          message: message.error.message || JSON.stringify(message.error)
        });
        break;

      default:
        console.log('Unhandled message type:', message.type);
        break;
    }
  }

  private handleLiveTranscript(role: 'user' | 'assistant', message: any): void {
    const delta = typeof message.delta === 'string' ? message.delta : '';
    if (!delta) return;
    if (!this.liveTranscriptIds[role]) {
      this.liveTranscriptSequence[role] += 1;
      this.liveTranscriptIds[role] = `live-${role}-${this.liveTranscriptSequence[role]}`;
      this.liveTranscriptBuffers[role] = '';
      this.emit({ type: 'transcript.reset', role });
    }
    this.liveTranscriptBuffers[role] += delta;
    this.emit({ type: 'transcript.delta', delta, role, itemId: this.liveTranscriptIds[role]! });
    this.setAgentState(role === 'user' ? 'listening' : 'speaking', `live-${role}-transcript`);
    const currentTimer = this.liveTranscriptTimers[role];
    if (currentTimer) window.clearTimeout(currentTimer);
    this.liveTranscriptTimers[role] = window.setTimeout(() => this.flushLiveTranscript(role), 1200);
  }

  private handleLiveResponseEvent(envelope: any): void {
    const nested = envelope?.event;
    if (!nested?.type) return;
    const delegationId = typeof envelope.delegation_id === 'string' ? envelope.delegation_id : null;
    if (nested.type === 'response.created') {
      const responseId = nested.response?.id;
      if (typeof responseId === 'string') {
        this.ensureLiveDelegationResponse(responseId);
        if (delegationId) this.liveDelegationResponseIds.set(delegationId, responseId);
      }
      return;
    }
    if (nested.type === 'response.output_item.done' && nested.item?.type === 'function_call') {
      const callId = nested.item.call_id;
      const responseId = nested.response_id || (delegationId ? this.liveDelegationResponseIds.get(delegationId) : undefined);
      if (typeof callId !== 'string' || typeof responseId !== 'string') return;
      const state = this.liveDelegationResponses.get(responseId);
      if (!state || state.pendingCalls.has(callId)) return;
      state.pendingCalls.add(callId);
      this.liveCallResponseIds.set(callId, responseId);
      this.emit({
        type: 'function_call',
        call: {
          id: callId,
          name: nested.item.name,
          arguments: nested.item.arguments || '{}'
        }
      });
      return;
    }
    if (nested.type === 'response.completed' || nested.type === 'response.done') {
      const responseId = nested.response?.id || nested.response_id || (delegationId ? this.liveDelegationResponseIds.get(delegationId) : undefined);
      if (typeof responseId !== 'string') return;
      const state = this.liveDelegationResponses.get(responseId);
      if (!state) return;
      state.completed = true;
      this.continueLiveDelegationIfReady(responseId);
      return;
    }
    if (nested.type === 'error' || nested.type === 'response.failed') {
      const error = nested.error || nested.response?.error;
      this.emit({
        type: 'error',
        error: error?.message || 'GPT-Live delegated backend request failed'
      });
    }
  }

  private ensureLiveDelegationResponse(responseId: string) {
    let state = this.liveDelegationResponses.get(responseId);
    if (!state) {
      state = {
        pendingCalls: new Set(),
        returnedCalls: new Set(),
        completed: false,
        continued: false
      };
      this.liveDelegationResponses.set(responseId, state);
    }
    return state;
  }

  private continueLiveDelegationIfReady(responseId: string): void {
    const state = this.liveDelegationResponses.get(responseId);
    if (!state || state.continued || !state.completed || state.pendingCalls.size === 0) return;
    if (state.returnedCalls.size !== state.pendingCalls.size) return;
    state.continued = true;
    this.send({ type: 'response.create', event_id: crypto.randomUUID() });
    for (const callId of state.pendingCalls) this.liveCallResponseIds.delete(callId);
    this.liveDelegationResponses.delete(responseId);
    for (const [delegationId, mappedResponseId] of this.liveDelegationResponseIds) {
      if (mappedResponseId === responseId) this.liveDelegationResponseIds.delete(delegationId);
    }
  }

  private flushLiveTranscript(role: 'user' | 'assistant'): void {
    const timer = this.liveTranscriptTimers[role];
    if (timer) window.clearTimeout(timer);
    this.liveTranscriptTimers[role] = null;
    const itemId = this.liveTranscriptIds[role];
    const transcript = this.liveTranscriptBuffers[role];
    this.liveTranscriptIds[role] = null;
    this.liveTranscriptBuffers[role] = '';
    if (itemId && transcript.trim()) {
      this.emit({ type: 'transcript.done', transcript, role, itemId });
    }
    if (role === 'assistant') this.setAgentState('idle', 'live-assistant-caption-settled');
  }

  sendAudio(audioData: Int16Array): void {
    if (this.webrtc) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const base64Audio = this.arrayBufferToBase64(audioData.buffer);
    this.hasBufferedAudio = true;
    this.bufferedSamples += audioData.length;
    this.hasReceivedAudio = true;
    this.send({
      type: 'input_audio_buffer.append',
      audio: base64Audio
    });
  }

  commitAudio(): void {
    if (this.webrtc) return;
    if (!this.hasBufferedAudio || this.bufferedSamples < 2400 || !this.hasReceivedAudio) {
      console.warn('Skip commit: insufficient buffered audio', {
        bufferedSamples: this.bufferedSamples,
        hasReceivedAudio: this.hasReceivedAudio
      });
      return;
    }
    this.send({
      type: 'input_audio_buffer.commit'
    });
    this.hasBufferedAudio = false;
    this.bufferedSamples = 0;
    this.hasReceivedAudio = false;
  }

  clearAudioBuffer(): void {
    this.hasBufferedAudio = false;
    this.bufferedSamples = 0;
    this.hasReceivedAudio = false;
    this.send({
      type: 'input_audio_buffer.clear'
    });
  }

  sendFunctionCallOutput(callId: string, output: any): void {
    if (this.usesGPTLive) {
      const responseId = this.liveCallResponseIds.get(callId);
      if (!responseId) {
        console.warn('Ignoring a GPT-Live function result with no pending delegated call', { callId });
        return;
      }
      this.send({
        type: 'response.item.create',
        event_id: crypto.randomUUID(),
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(output)
        }
      });
      const state = this.liveDelegationResponses.get(responseId);
      state?.returnedCalls.add(callId);
      this.continueLiveDelegationIfReady(responseId);
      return;
    }
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output)
      }
    });

    this.send({
      type: 'response.create'
    });
  }

  sendSystemMessage(text: string): void {
    if (!text || !text.trim()) {
      return;
    }
    if (this.usesGPTLive) {
      this.send({
        type: 'session.instructions.append',
        event_id: crypto.randomUUID(),
        delegation_id: null,
        content: text.trim()
      });
      return;
    }
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: text.trim()
          }
        ]
      }
    });
  }

  sendUserMessage(text: string): void {
    if (!text || !text.trim()) {
      return;
    }
    if (this.usesGPTLive) {
      console.warn('Text user messages are not supported by this GPT-Live voice adapter');
      return;
    }
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: text.trim()
          }
        ]
      }
    });
    this.requestResponse();
  }

  cancelResponse(options?: { suppressState?: boolean }): void {
    if (this.usesGPTLive) return;
    if (!this.hasActiveResponse()) {
      console.warn('Cancel requested but no active response');
      return;
    }
    if (this.cancelPending) {
      console.warn('Cancel already in progress, ignoring duplicate');
      return;
    }
    this.hasBufferedAudio = false;
    this.bufferedSamples = 0;
    this.hasReceivedAudio = false;
    this.cancelPending = true;
    this.send({
      type: 'response.cancel'
    });
    if (this.webrtc) {
      this.send({ type: 'output_audio_buffer.clear' });
    }
    if (!options?.suppressState) {
      this.setAgentState('interrupted');
    }
  }

  /** Independent speech response: microphone context never competes with the routed answer. */
  speakAnswer(text: string): void {
    if (!this.routedVoice || !text.trim()) return;
    if (this.routedSpeechRequested || this.hasActiveResponse()) { this.pendingRoutedAnswer = text; return; }
    this.routedSpeechRequested = true; this.suppressRoutedAudio = false;
    if (this.remoteAudio) this.remoteAudio.muted = false;
    if (this.provider === 'xai') {
      this.send({ type: 'conversation.item.create', item: { type: 'force_message', role: 'assistant', interruptible: true, content: [{ type: 'output_text', text }] } });
      return;
    }
    this.send({ type: 'response.create', response: {
      conversation: 'none', output_modalities: ['audio'],
      instructions: LIVE_VOICE_INSTRUCTIONS,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: `Read this answer aloud exactly:\n${text}` }] }],
      tools: [], tool_choice: 'none'
    } });
  }

  interruptSpeech(): void {
    this.pendingRoutedAnswer = null;
    this.suppressRoutedAudio = true;
    if (this.remoteAudio) this.remoteAudio.muted = true;
    if (this.hasActiveResponse()) this.cancelResponse({ suppressState: true });
    else if (this.webrtc && this.outputAudioBufferStartedAt !== null) this.send({ type: 'output_audio_buffer.clear' });
  }

  requestResponse(): void {
    if (this.usesGPTLive) return;
    this.send({
      type: 'response.create'
    });
  }

  async injectAudio(encodedAudio: ArrayBuffer): Promise<void> {
    const decodeContext = new AudioContext();
    try {
      const decoded = await decodeContext.decodeAudioData(encodedAudio.slice(0));
      const frameCount = Math.max(1, Math.ceil(decoded.duration * 24000));
      const offline = new OfflineAudioContext(1, frameCount, 24000);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();

      if (this.webrtc && this.peerConnection) {
        const playbackContext = new AudioContext({ sampleRate: 24000 });
        const destination = playbackContext.createMediaStreamDestination();
        const playbackSource = playbackContext.createBufferSource();
        playbackSource.buffer = rendered;
        playbackSource.connect(destination);
        const sender = this.peerConnection.getSenders().find((item) => item.track?.kind === 'audio');
        const originalTrack = this.mediaStream?.getAudioTracks()[0] || null;
        await sender?.replaceTrack(destination.stream.getAudioTracks()[0]);
        emitBenchmarkEvent('microphone.capture_started', {
          mode: 'prerecorded',
          duration_ms: rendered.duration * 1000
        });
        playbackSource.start();
        await new Promise<void>((resolve) => {
          playbackSource.onended = () => resolve();
        });
        emitBenchmarkEvent('input.audio_ended', { mode: 'prerecorded' });
        await sender?.replaceTrack(originalTrack);
        destination.stream.getTracks().forEach((track) => track.stop());
        await playbackContext.close();
        return;
      }

      const channel = rendered.getChannelData(0);
      const chunkSize = 2400;
      for (let offset = 0; offset < channel.length; offset += chunkSize) {
        const slice = channel.subarray(offset, Math.min(channel.length, offset + chunkSize));
        const pcm = new Int16Array(slice.length);
        for (let index = 0; index < slice.length; index += 1) {
          pcm[index] = Math.max(-32768, Math.min(32767, Math.round(slice[index] * 32767)));
        }
        this.sendAudio(pcm);
        await new Promise((resolve) => setTimeout(resolve, (slice.length / 24000) * 1000));
      }
      emitBenchmarkEvent('input.audio_ended', { mode: 'prerecorded' });
    } finally {
      await decodeContext.close();
    }
  }

  private preserveRemoteBenchmarkAudio(): void {
    const trace = getBenchmarkTrace();
    const recorder = this.remoteRecorder;
    if (!trace || !recorder || recorder.state !== 'recording') return;
    recorder.requestData();
    window.setTimeout(() => {
      if (!this.remoteRecordingChunks.length) return;
      const blob = new Blob(this.remoteRecordingChunks, {
        type: recorder.mimeType || 'audio/webm'
      });
      this.remoteRecordingChunks = [];
      void saveBenchmarkOutputAudio(trace.runId, blob).catch((error) =>
        console.warn('[VoiceBenchmark] failed to preserve native output', error)
      );
    }, 100);
  }

  private send(message: any): void {
    if (this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(message));
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('Cannot send message, WebSocket not open. State:', this.ws?.readyState);
    }
  }

  on(eventType: RealtimeEvent['type'], handler: (event: any) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);
  }

  off(eventType: RealtimeEvent['type'], handler: (event: any) => void): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  private emit(event: RealtimeEvent): void {
    const handlers = this.eventHandlers.get(event.type);
    if (handlers) {
      handlers.forEach((handler) => handler(event));
    }
  }

  private setAgentState(state: AgentState, reason?: string): void {
    if (this.agentState === state && !reason) return;
    this.agentState = state;
    this.emit({ type: 'agent_state', state, reason });
  }

  private markResponseCreated(): void {
    this.activeResponseCount = Math.max(0, this.activeResponseCount) + 1;
  }

  private markResponseFinished(): void {
    this.activeResponseCount = Math.max(0, this.activeResponseCount - 1);
    this.cancelPending = false;
  }

  private hasActiveResponse(): boolean {
    return this.activeResponseCount > 0;
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(
      `[RealtimeAPIClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    setTimeout(() => {
      console.log('[RealtimeAPIClient] reconnect timer firing');
      this.connect().catch((error) => {
        console.error('Reconnection failed:', error);
      });
    }, delay);
  }

  private arrayBufferToBase64(buffer: ArrayBuffer | ArrayBufferLike): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  disconnect(): void {
    if (this.usesGPTLive && this.liveSessionStarted && this.dataChannel?.readyState === 'open' && !this.intentionalClose) {
      this.intentionalClose = true;
      this.send({ type: 'session.close', event_id: crypto.randomUUID() });
      this.liveCloseTimer = window.setTimeout(() => this.forceDisconnect(), 3_000);
      return;
    }
    this.forceDisconnect();
  }

  private forceDisconnect(): void {
    this.routedSpeechRequested = false; this.pendingRoutedAnswer = null;
    this.intentionalClose = true;
    this.sessionUpdateSent = false;
    this.hasReceivedAudio = false;
    this.hasBufferedAudio = false;
    this.bufferedSamples = 0;
    this.activeResponseCount = 0;
    this.cancelPending = false;
    this.liveSessionStarted = false;
    this.liveSessionReadyReject?.(new Error('Voice connection canceled'));
    this.liveSessionReadyResolve = null;
    this.liveSessionReadyReject = null;
    if (this.liveCloseTimer) window.clearTimeout(this.liveCloseTimer);
    this.liveCloseTimer = null;
    this.liveDelegationResponses.clear();
    this.liveDelegationResponseIds.clear();
    this.liveCallResponseIds.clear();
    this.flushLiveTranscript('user');
    this.flushLiveTranscript('assistant');
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch (error) {
        console.warn('Error closing WebSocket:', error);
      }
      this.ws = null;
    }
    this.dataChannel?.close();
    this.dataChannel = null;
    this.peerConnection?.close();
    this.peerConnection = null;
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
    if (this.remoteAudio) {
      this.remoteAudio.pause();
      this.remoteAudio.srcObject = null;
      this.remoteAudio = null;
    }
    if (this.remoteRecorder?.state === 'recording') {
      try {
        this.remoteRecorder.stop();
      } catch {
        // recorder is already closing
      }
    }
    this.remoteRecorder = null;
    if (this.remoteWaveformTimer) window.clearInterval(this.remoteWaveformTimer);
    this.remoteWaveformTimer = null;
    if (this.remoteWaveformContext && this.remoteWaveformContext.state !== 'closed') {
      void this.remoteWaveformContext.close();
    }
    this.remoteWaveformContext = null;
    this.remoteAnalyser = null;
    this.remoteSamples = null;
    void this.audioContext?.close();
    this.audioContext = null;
    this.analyser = null;
    this.eventHandlers.clear();
    this.agentState = 'idle';
  }

  isConnected(): boolean {
    return (this.usesGPTLive
      ? this.liveSessionStarted && this.dataChannel?.readyState === 'open'
      : this.dataChannel?.readyState === 'open') || (this.ws !== null && this.ws.readyState === WebSocket.OPEN);
  }

  async startCapture(): Promise<void> {
    if (!this.webrtc) {
      const audioManager = getAudioManager();
      if (!audioManager.isReady()) await audioManager.initialize();
      await audioManager.startCapture((audioData) => this.sendAudio(audioData));
      return;
    }
    if (this.audioContext?.state === 'suspended') await this.audioContext.resume();
    this.mediaStream?.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
  }

  stopCapture(): void {
    if (!this.webrtc) {
      getAudioManager().stopCapture();
      return;
    }
    this.mediaStream?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
  }

  getWaveformData(): Uint8Array | null {
    if (!this.webrtc) return getAudioManager().getWaveformData();
    if (!this.analyser) return null;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    return data;
  }

  getVolume(): number {
    if (!this.webrtc) return getAudioManager().getVolume();
    const waveform = this.getWaveformData();
    if (!waveform?.length) return 0;
    const sum = waveform.reduce((total, value) => total + Math.pow((value - 128) / 128, 2), 0);
    return Math.min(1, Math.sqrt(sum / waveform.length));
  }

  getOutputVolume(): number {
    if (!this.webrtc) return getAudioManager().getOutputVolume();
    if (!this.remoteAnalyser || !this.remoteSamples) return 0;
    const samples = this.remoteSamples as Uint8Array<ArrayBuffer>;
    this.remoteAnalyser.getByteTimeDomainData(samples);
    let energy = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const value = (samples[index] - 128) / 128;
      energy += value * value;
    }
    return Math.min(1, Math.sqrt(energy / Math.max(1, samples.length)));
  }
}
