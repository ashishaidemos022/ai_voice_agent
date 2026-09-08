import { RealtimeAPIClient } from '../realtime-client';
import type { VoiceEventType } from './types';
import { ElevenLabsVoiceAdapter } from './elevenlabs-adapter';
import { configPresetToRealtimeConfig, getConfigPresetById } from '../config-service';
import { requestElevenLabsGatewayToken } from '../elevenlabs-gateway';
import { requestRealtimeWebSocketSecret } from '../realtime-session';
import { supabase } from '../supabase';
import { liveVoiceSession } from '../../../shared/live-voice';

export interface RoutedVoiceAdapter {
  connect(): Promise<void>;
  disconnect(): void;
  startCapture(): Promise<void>;
  stopCapture(): void;
  speakAnswer(text: string): void;
  interruptSpeech(): void;
  on(type: VoiceEventType, handler: (event: any) => void): void;
}

/** Playback-only PCM sink. It never opens a second microphone. */
class PcmPlayback {
  private context: AudioContext | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private next = 0;
  private enabled = false;
  constructor(private rate: number) {}
  async open() { this.context = new AudioContext(); await this.context.resume(); }
  enable() { this.enabled = true; }
  push(encoded: string) {
    const context = this.context;
    if (!this.enabled || !context) return;
    const binary = atob(encoded); if (binary.length < 2) return; const buffer = context.createBuffer(1, Math.floor(binary.length / 2), this.rate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      const value = binary.charCodeAt(i * 2) | binary.charCodeAt(i * 2 + 1) << 8;
      samples[i] = (value > 32767 ? value - 65536 : value) / 32768;
    }
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
    this.sources.add(source); source.onended = () => { this.sources.delete(source); source.disconnect(); };
    this.next = Math.max(context.currentTime + 0.02, this.next); source.start(this.next); this.next += buffer.duration;
  }
  stop() { this.enabled = false; this.sources.forEach(source => { try { source.stop(); } catch { /* already ended */ } }); this.sources.clear(); this.next = 0; }
  close() { this.stop(); void this.context?.close(); this.context = null; }
}

export async function createRoutedVoiceAdapter(agentId: string, sessionId: string): Promise<{ adapter: RoutedVoiceAdapter; label: string; pcmOutput: boolean }> {
  const preset = await getConfigPresetById(agentId);
  if (!preset) throw new Error('Selected agent configuration is unavailable.');
  const config = configPresetToRealtimeConfig(preset);
  const provider = config.voice_provider || 'openai_realtime';
  if (provider === 'elevenlabs_agent' || provider === 'personaplex') {
    throw new Error(`${provider === 'elevenlabs_agent' ? 'ElevenLabs Agent' : 'PersonaPlex'} manages its own conversation. Shared memory and dynamic routing are not connected to this hosted adapter. Use Native voice to keep its configured voice and behavior, or select an OpenAI, xAI, or ElevenLabs TTS provider for shared routing.`);
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Sign in to start live voice.');
  const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/realtime-session`);
  url.searchParams.set('agent_id', agentId); url.searchParams.set('routed_session_id', sessionId);
  const webrtc = { sessionUrl: url.toString(), headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } };
  if (provider === 'openai_realtime') {
    const selected = liveVoiceSession(config);
    return { pcmOutput: false, adapter: new RealtimeAPIClient({ ...config, model: selected.model, voice: selected.audio.output!.voice }, { routedVoice: true, tools: [], allowInterruptions: true, webrtc }), label: `OpenAI · ${selected.audio.output!.voice} · ${selected.model}` };
  }
  const inputConfig = { ...config, model: liveVoiceSession(provider === 'xai_realtime' ? {} : config).model };
  let input: RoutedVoiceAdapter;
  let output: RealtimeAPIClient | null = null;
  let label: string;
  let rate = 24000;
  if (provider === 'elevenlabs_tts') {
    if (!config.voice_id) throw new Error('Select an ElevenLabs voice in the agent settings.');
    const format = config.voice_provider_config?.output_format || 'pcm_24000';
    if (!/^pcm_(16000|22050|24000|44100|48000)$/.test(format)) throw new Error('Shared live voice requires a PCM output format. Choose PCM in the ElevenLabs provider settings.');
    rate = Number(format.slice(4));
    const gateway = await requestElevenLabsGatewayToken({ agentId, sessionId, origin: window.location.origin, routedVoice: true });
    input = new ElevenLabsVoiceAdapter(inputConfig, { gatewayUrl: gateway.gateway_ws_url, token: gateway.token, agentId, sessionId }, { routedVoice: true, webrtc });
    label = `ElevenLabs · ${config.voice_id} · ${config.voice_provider_config?.model_id || 'configured TTS model'} · OpenAI speech recognition`;
  } else {
    const secret = await requestRealtimeWebSocketSecret(agentId, undefined, sessionId);
    input = new RealtimeAPIClient(inputConfig, { routedVoice: true, textOnly: true, tools: [], webrtc });
    output = new RealtimeAPIClient(config, { routedVoice: true, provider: 'xai', apiKey: secret.token, tools: [] });
    label = `xAI · ${config.voice} · ${config.model} · OpenAI speech recognition`;
  }
  const playback = new PcmPlayback(rate);
  const speaker = output || input;
  speaker.on('audio.delta', event => playback.push(event.delta));
  let closed = false;
  const adapter: RoutedVoiceAdapter = {
    async connect() {
      try { await playback.open(); if (closed) { playback.close(); return; } await input.connect(); if (closed) { input.disconnect(); return; } if (output) await output.connect(); if (closed) output?.disconnect(); }
      catch (error) { adapter.disconnect(); throw error; }
    },
    disconnect() { closed = true; input.disconnect(); output?.disconnect(); playback.close(); },
    async startCapture() { if (!closed) await input.startCapture(); },
    stopCapture() { if (!closed) input.stopCapture?.(); },
    speakAnswer(text) { if (!closed) { playback.enable(); speaker.speakAnswer(text); } },
    interruptSpeech() { playback.stop(); speaker.interruptSpeech(); },
    on(type, handler) {
      if (!output || ['speech.started','speech.stopped','transcript.delta','transcript.done','transcript.reset','connected'].includes(type)) input.on(type, handler);
      else output.on(type, handler);
      if (output && ['error','disconnected'].includes(type)) input.on(type, handler);
    }
  };
  return { adapter, label, pcmOutput: true };
}
