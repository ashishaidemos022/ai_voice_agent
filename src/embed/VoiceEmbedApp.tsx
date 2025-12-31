import { useMemo, type CSSProperties } from 'react';
import { Headphones, Loader2, Mic, RotateCcw, Square, Waves } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { ChatEmbedView } from './ChatEmbedApp';
import { useVoiceEmbedSession, type VoiceEmbedAppearance } from './useVoiceEmbed';

function resolveVoicePublicId(): string | null {
  if (typeof window === 'undefined') return null;
  const parts = window.location.pathname.split('/').filter(Boolean);
  const embedIndex = parts.findIndex((part) => part === 'voice');
  if (embedIndex === -1 || !parts[embedIndex + 1]) {
    return null;
  }
  return decodeURIComponent(parts[embedIndex + 1]);
}

const STATE_LABEL: Record<string, string> = {
  idle: 'Idle',
  listening: 'Listening…',
  thinking: 'Processing…',
  speaking: 'Speaking…',
  interrupted: 'Interrupted'
};

function buildWaveHeights(waveformData: Uint8Array | null, volume: number) {
  const bars = 28;
  if (!waveformData || waveformData.length === 0) {
    return Array.from({ length: bars }, (_, idx) => {
      const wobble = Math.sin(idx * 1.3) * 12 + 32;
      return Math.max(8, wobble * (0.4 + volume));
    });
  }
  const chunk = Math.floor(waveformData.length / bars) || 1;
  const heights: number[] = [];
  for (let i = 0; i < bars; i++) {
    const start = i * chunk;
    const slice = waveformData.slice(start, start + chunk);
    const avg = slice.reduce((acc, v) => acc + Math.abs(v - 128), 0) / slice.length;
    heights.push(12 + avg * 0.7 + volume * 30);
  }
  return heights;
}

function buildAppearanceVars(appearance: VoiceEmbedAppearance | null) {
  if (!appearance) return {};
  const vars: Record<string, string> = {};
  if (appearance.background_color) vars['--va-embed-bg'] = appearance.background_color;
  if (appearance.surface_color) vars['--va-embed-surface'] = appearance.surface_color;
  if (appearance.text_color) vars['--va-embed-text'] = appearance.text_color;
  if (appearance.accent_color) vars['--va-embed-accent'] = appearance.accent_color;
  if (appearance.button_color) vars['--va-embed-button'] = appearance.button_color;
  if (appearance.button_text_color) vars['--va-embed-button-text'] = appearance.button_text_color;
  if (appearance.helper_text_color) vars['--va-embed-helper-text'] = appearance.helper_text_color;
  if (appearance.wave_color) vars['--va-embed-wave'] = appearance.wave_color;
  if (appearance.bubble_color) vars['--va-embed-bubble'] = appearance.bubble_color;
  if (appearance.corner_radius !== null && appearance.corner_radius !== undefined) {
    vars['--va-embed-radius'] = `${appearance.corner_radius}px`;
  }
  if (appearance.font_family) vars['--va-embed-font'] = appearance.font_family;
  return vars;
}

export function VoiceEmbedApp() {
  const publicId = useMemo(() => resolveVoicePublicId(), []);
  const search = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const theme = search.get('theme') === 'light' ? 'light' : 'dark';
  const isWidget = search.get('widget') === '1';

  const {
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
    toggleRecording,
    stopSession,
    resetConversation,
    appearance
  } = useVoiceEmbedSession(publicId || '');

  const appearanceVars = buildAppearanceVars(appearance);
  const rootStyle: CSSProperties = {
    ...appearanceVars,
    ...(appearance?.background_color ? { backgroundColor: 'var(--va-embed-bg)' } : {}),
    ...(appearance?.text_color ? { color: 'var(--va-embed-text)' } : {}),
    ...(appearance?.font_family ? { fontFamily: 'var(--va-embed-font)' } : {})
  };
  const surfaceStyle = appearance?.surface_color ? { backgroundColor: 'var(--va-embed-surface)' } : undefined;
  const bubbleStyle = appearance?.bubble_color ? { backgroundColor: 'var(--va-embed-bubble)' } : undefined;
  const accentStyle = appearance?.accent_color ? { color: 'var(--va-embed-accent)' } : undefined;
  const buttonStyle = appearance?.button_color || appearance?.button_text_color
    ? {
        backgroundColor: appearance?.button_color ? 'var(--va-embed-button)' : undefined,
        color: appearance?.button_text_color ? 'var(--va-embed-button-text)' : undefined
      }
    : undefined;
  const helperTextStyle = appearance?.helper_text_color
    ? { color: 'var(--va-embed-helper-text)' }
    : undefined;
  const radiusStyle = appearance?.corner_radius !== null && appearance?.corner_radius !== undefined
    ? { borderRadius: 'var(--va-embed-radius)' }
    : undefined;

  if (!publicId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        <p>Missing public embed id.</p>
      </div>
    );
  }

  if (fallbackReason) {
    return (
      <div
        className={cn(
          'min-h-screen flex flex-col gap-4 px-4 py-6',
          theme === 'light' ? 'bg-white text-slate-900' : 'bg-slate-950 text-white',
          isWidget ? 'w-full h-full max-w-sm' : ''
        )}
        style={rootStyle}
      >
        <div className="rounded-2xl border border-amber-300/40 bg-amber-400/10 p-4" style={radiusStyle}>
          <p className="font-semibold text-amber-100 mb-1">Microphone unavailable</p>
          <p className="text-sm text-amber-200">{fallbackReason}</p>
          <p className="text-xs text-amber-200/80 mt-3">
            Falling back to text chat. Responses will stream as messages below.
          </p>
        </div>
        <div className="flex-1 min-h-0">
          <ChatEmbedView publicId={publicId} theme={theme === 'light' ? 'light' : 'dark'} isWidget={isWidget} />
        </div>
      </div>
    );
  }

  const heights = buildWaveHeights(waveformData, volume);

  return (
    <div
      className={cn(
        'min-h-screen flex flex-col',
        theme === 'light' ? 'bg-white text-slate-900' : 'bg-slate-950 text-white',
        isWidget ? 'w-full h-full max-w-sm' : ''
      )}
      style={rootStyle}
    >
      <div
        className={cn(
          'px-4 py-3 border-b flex items-center justify-between',
          theme === 'light' ? 'border-slate-200 bg-white' : 'border-white/10 bg-slate-900/70'
        )}
        style={surfaceStyle}
      >
        <div className="flex items-center gap-3">
          {appearance?.logo_url && (
            <img
              src={appearance.logo_url}
              alt={appearance.brand_name || agentMeta?.name || 'Voice Agent'}
              className="w-8 h-8 rounded-xl object-cover"
              style={radiusStyle}
            />
          )}
          <div>
            <p className="text-sm font-semibold">{appearance?.brand_name || agentMeta?.name || 'Voice Agent'}</p>
            <p className={cn('text-[11px]', theme === 'light' ? 'text-slate-500' : 'text-white/60')}>
              {agentMeta?.summary || 'Live AI assistant'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'px-2 py-0.5 rounded-full text-[11px] uppercase tracking-[0.3em]',
              isConnected ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-400/50' : 'bg-white/10 text-white/60 border border-white/20'
            )}
          >
            {isConnected ? 'Connected' : 'Offline'}
          </span>
          <Button size="xs" variant="ghost" onClick={() => { resetConversation(); stopSession(); }}>
            <RotateCcw className="w-3 h-3" />
            Reset
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-4 px-4 py-4 overflow-hidden">
        <div
          className={cn(
            'rounded-3xl border px-5 py-5',
            theme === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-white/5 border-white/10'
          )}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] opacity-60">Realtime Voice</p>
          <p className="text-lg font-semibold flex items-center gap-2">
            <Waves className="w-4 h-4 text-indigo-400" style={accentStyle} />
            {STATE_LABEL[agentState] || agentState}
          </p>
          <p className={cn('text-sm', theme === 'light' ? 'text-slate-500' : 'text-white/70')} style={helperTextStyle}>
            {isRecording ? 'Speak naturally—release to pause.' : 'Tap the mic to start talking.'}
          </p>
            </div>
            <Button
              size="sm"
              className={cn('gap-2', isRecording ? 'bg-rose-500 hover:bg-rose-400 text-white' : '')}
              onClick={toggleRecording}
              disabled={isInitializing || isLoadingMeta}
              style={!isRecording ? buttonStyle : undefined}
            >
              {isInitializing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isRecording ? (
                <>
                  <Square className="w-4 h-4" /> Stop
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4" /> Start
                </>
              )}
            </Button>
          </div>

          <div className="relative flex flex-col gap-6">
            <div className="relative rounded-2xl border overflow-hidden"
              style={{
                borderColor: theme === 'light' ? '#e2e8f0' : 'rgba(255,255,255,0.1)',
                ...(appearance?.corner_radius !== null && appearance?.corner_radius !== undefined ? radiusStyle : {})
              }}
            >
              <div
                className="absolute inset-0 grid items-end gap-[4px] px-4 pb-6 pt-10"
                style={{ gridTemplateColumns: `repeat(${heights.length}, minmax(0, 1fr))` }}
              >
                {heights.map((h, idx) => (
                  <div
                    key={idx}
                    className={cn('rounded-full', agentState === 'speaking' ? 'bg-indigo-300' : 'bg-white/25')}
                    style={{
                      height: Math.max(24, h / 1.5),
                      backgroundColor: appearance?.wave_color ? 'var(--va-embed-wave)' : undefined
                    }}
                  />
                ))}
              </div>
              <div className="relative z-10 flex flex-col gap-3 px-4 py-4">
                {liveUserTranscript && (
                  <div
                    className={cn(
                      'rounded-2xl px-4 py-3 text-sm max-w-[80%] self-start',
                      theme === 'light' ? 'bg-white shadow text-slate-900' : 'bg-white/10 text-white border border-white/10'
                    )}
                    style={{
                      ...(appearance?.accent_color ? { backgroundColor: 'var(--va-embed-accent)', color: 'var(--va-embed-button-text)' } : {}),
                      ...(radiusStyle || {})
                    }}
                  >
                    <p className="text-[10px] uppercase tracking-[0.3em] opacity-60 mb-1">You</p>
                    {liveUserTranscript}
                  </div>
                )}
                {liveAssistantTranscript && (
                  <div
                    className={cn(
                      'rounded-2xl px-4 py-3 text-sm max-w-[80%] self-end',
                      theme === 'light' ? 'bg-slate-900 text-white' : 'bg-indigo-500/30 text-white border border-indigo-200/30'
                    )}
                    style={{
                      ...(bubbleStyle || {}),
                      ...(radiusStyle || {})
                    }}
                  >
                    <p className="text-[10px] uppercase tracking-[0.3em] opacity-60 mb-1">Agent</p>
                    {liveAssistantTranscript}
                  </div>
                )}
                {!liveAssistantTranscript && !liveUserTranscript && (
                  <p
                    className={cn('text-sm', theme === 'light' ? 'text-slate-500' : 'text-white/60')}
                    style={helperTextStyle}
                  >
                    {isLoadingMeta ? 'Loading agent...' : 'Tap start and speak naturally.'}
                  </p>
                )}
              </div>
            </div>

            <div
              className={cn('flex flex-wrap gap-3 text-xs', theme === 'light' ? 'text-slate-500' : 'text-white/60')}
              style={helperTextStyle}
            >
              <span className="flex items-center gap-2">
                <Mic className="w-3.5 h-3.5" />
                {isRecording ? 'Mic live' : 'Mic idle'}
              </span>
              <span className="flex items-center gap-2">
                <Headphones className="w-3.5 h-3.5" />
                {isConnected ? 'Ready to play audio' : 'Awaiting connection'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden rounded-3xl border border-white/10 bg-black/10" style={radiusStyle}>
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between" style={surfaceStyle}>
            <p className="text-sm font-semibold">Conversation log</p>
            <span className="text-xs text-white/60">{messages.length} turns</span>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {messages.length === 0 ? (
              <p
                className={cn('text-sm', theme === 'light' ? 'text-slate-500' : 'text-white/60')}
                style={helperTextStyle}
              >
                No messages yet. Start speaking to begin the conversation.
              </p>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    'px-4 py-3 rounded-2xl text-sm max-w-[85%]',
                    message.role === 'user'
                      ? theme === 'light'
                        ? 'bg-indigo-600 text-white ml-auto rounded-br-sm'
                        : 'bg-indigo-500 text-white ml-auto rounded-br-sm'
                      : theme === 'light'
                      ? 'bg-slate-100 text-slate-900 rounded-bl-sm'
                      : 'bg-white/10 text-white rounded-bl-sm border border-white/10'
                  )}
                  style={{
                    ...(message.role === 'user' && appearance?.accent_color ? { backgroundColor: 'var(--va-embed-accent)' } : {}),
                    ...(message.role === 'assistant' ? bubbleStyle : {}),
                    ...(radiusStyle || {})
                  }}
                >
                  <p className="text-[10px] uppercase tracking-[0.2em] mb-1 opacity-60">
                    {message.role === 'user' ? 'You' : 'Agent'}
                  </p>
                  <p className="leading-relaxed whitespace-pre-wrap">{message.content}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
