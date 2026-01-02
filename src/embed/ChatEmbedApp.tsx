import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Loader2, MessageCircle, RotateCcw, Sparkles } from 'lucide-react';
import { useEmbedChat, type ChatEmbedAppearance } from './useEmbedChat';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/utils';

function resolvePublicId(): string | null {
  if (typeof window === 'undefined') return null;
  const parts = window.location.pathname.split('/').filter(Boolean);
  const embedIndex = parts.findIndex((part) => part === 'embed');
  if (embedIndex === -1 || !parts[embedIndex + 2]) {
    return null;
  }
  return decodeURIComponent(parts[embedIndex + 2]);
}

type ChatEmbedViewProps = {
  publicId: string;
  theme: 'light' | 'dark';
  isWidget: boolean;
};

function buildAppearanceVars(appearance: ChatEmbedAppearance | null | undefined) {
  if (!appearance) return {};
  const vars: Record<string, string> = {};
  if (appearance.background_color) vars['--va-chat-bg'] = appearance.background_color;
  if (appearance.surface_color) vars['--va-chat-surface'] = appearance.surface_color;
  if (appearance.text_color) vars['--va-chat-text'] = appearance.text_color;
  if (appearance.accent_color) vars['--va-chat-accent'] = appearance.accent_color;
  if (appearance.button_color) vars['--va-chat-button'] = appearance.button_color;
  if (appearance.button_text_color) vars['--va-chat-button-text'] = appearance.button_text_color;
  if (appearance.helper_text_color) vars['--va-chat-helper-text'] = appearance.helper_text_color;
  if (appearance.bubble_color) vars['--va-chat-bubble'] = appearance.bubble_color;
  if (appearance.logo_background_color) vars['--va-chat-logo-bg'] = appearance.logo_background_color;
  if (appearance.corner_radius !== null && appearance.corner_radius !== undefined) {
    vars['--va-chat-radius'] = `${appearance.corner_radius}px`;
  }
  if (appearance.font_family) vars['--va-chat-font'] = appearance.font_family;
  return vars;
}

export function ChatEmbedView({ publicId, theme, isWidget }: ChatEmbedViewProps) {
  const [composer, setComposer] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const {
    messages,
    agentMeta,
    appearance,
    isLoadingMeta,
    isSending,
    error,
    sendMessage,
    resetChat
  } = useEmbedChat(publicId, { persist: isWidget });

  const allowSend = composer.trim().length > 0 && !isSending;

  const handleSend = () => {
    if (!composer.trim()) return;
    sendMessage(composer);
    setComposer('');
  };

  const appearanceVars = buildAppearanceVars(appearance);
  const rootStyle: CSSProperties = {
    ...appearanceVars,
    ...(appearance?.background_color ? { backgroundColor: 'var(--va-chat-bg)' } : {}),
    ...(appearance?.text_color ? { color: 'var(--va-chat-text)' } : {}),
    ...(appearance?.font_family ? { fontFamily: 'var(--va-chat-font)' } : {})
  };
  const surfaceStyle = appearance?.surface_color ? { backgroundColor: 'var(--va-chat-surface)' } : undefined;
  const radiusStyle = appearance?.corner_radius !== null && appearance?.corner_radius !== undefined
    ? { borderRadius: 'var(--va-chat-radius)' }
    : undefined;
  const bubbleStyle = appearance?.bubble_color ? { backgroundColor: 'var(--va-chat-bubble)' } : undefined;
  const logoStyle = appearance?.logo_background_color
    ? { background: 'var(--va-chat-logo-bg)', backgroundImage: 'none' }
    : undefined;
  const helperTextStyle = appearance?.helper_text_color
    ? { color: 'var(--va-chat-helper-text)' }
    : undefined;
  const buttonStyle = appearance?.button_color || appearance?.button_text_color
    ? {
        backgroundColor: appearance?.button_color ? 'var(--va-chat-button)' : undefined,
        color: appearance?.button_text_color ? 'var(--va-chat-button-text)' : undefined
      }
    : undefined;
  const composerStyle = appearance?.text_color
    ? { color: 'var(--va-chat-text)', caretColor: 'var(--va-chat-text)' }
    : undefined;
  const placeholderColor = appearance?.helper_text_color
    ? 'var(--va-chat-helper-text)'
    : theme === 'light'
    ? 'rgba(100, 116, 139, 0.6)'
    : 'rgba(255, 255, 255, 0.5)';
  const composerInlineStyle = {
    ...composerStyle,
    '--va-chat-placeholder': placeholderColor
  } as CSSProperties;

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      return;
    }
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, isSending, isLoadingMeta]);

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
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'w-10 h-10 p-1 rounded-xl flex items-center justify-center',
              theme === 'light' ? 'bg-slate-900 text-white' : 'bg-gradient-to-br from-indigo-500 to-purple-500 text-white'
            )}
            style={{ ...(radiusStyle || {}), ...(logoStyle || {}) }}
          >
            {appearance?.logo_url ? (
              <img
                src={appearance.logo_url}
                alt={appearance.brand_name || agentMeta?.name || 'AI Agent'}
                className="w-8 h-8 rounded-xl object-cover"
                style={radiusStyle}
              />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold">{appearance?.brand_name || agentMeta?.name || 'AI Agent'}</p>
            <p
              className={cn('text-[11px] line-clamp-1', theme === 'light' ? 'text-slate-500' : 'text-white/60')}
              style={helperTextStyle}
            >
              {agentMeta?.summary || 'Conversational assistant'}
            </p>
          </div>
        </div>
        <Button
          size="xs"
          variant="ghost"
          className={cn('gap-1', theme === 'light' ? 'text-slate-500 hover:bg-slate-100' : 'text-white/70 hover:bg-white/10')}
          onClick={resetChat}
          style={helperTextStyle}
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" ref={scrollContainerRef}>
        {isLoadingMeta && (
          <div className="flex items-center gap-2 text-sm opacity-80" style={helperTextStyle}>
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading agent…
          </div>
        )}
        {messages.length === 0 && !isLoadingMeta && (
          <div
            className={cn('text-sm text-center', theme === 'light' ? 'text-slate-500' : 'text-white/60')}
            style={helperTextStyle}
          >
            Start the conversation and this agent will respond in real time.
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              'px-3 py-2 rounded-2xl text-sm max-w-[85%]',
              message.role === 'user'
                ? theme === 'light'
                  ? 'bg-indigo-600 text-white ml-auto rounded-br-sm'
                  : 'bg-indigo-500 text-white ml-auto rounded-br-sm'
                : theme === 'light'
                ? 'bg-slate-100 text-slate-900 rounded-bl-sm'
                : 'bg-white/10 text-white rounded-bl-sm border border-white/10'
            )}
            style={{
              ...(message.role === 'user' && appearance?.accent_color ? { backgroundColor: 'var(--va-chat-accent)' } : {}),
              ...(message.role === 'assistant' ? bubbleStyle : {}),
              ...(radiusStyle || {})
            }}
          >
            <div className={cn('text-[10px] uppercase tracking-[0.25em] mb-1 flex items-center gap-1', message.role === 'user' ? 'opacity-70' : 'opacity-60')}>
              {message.role === 'user' ? 'You' : 'Agent'}
            </div>
            <p className="leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </div>
        ))}
        {isSending && (
          <div
            className={cn(
              'px-3 py-2 rounded-2xl text-sm max-w-[70%]',
              theme === 'light'
                ? 'bg-slate-100 text-slate-900 rounded-bl-sm'
                : 'bg-white/10 text-white rounded-bl-sm border border-white/10'
            )}
            style={{
              ...(bubbleStyle || {}),
              ...(radiusStyle || {})
            }}
          >
            <div className={cn('text-[10px] uppercase tracking-[0.25em] mb-1 opacity-60')}>Agent</div>
            <div className="flex items-center gap-2" style={helperTextStyle}>
              <span>Thinking</span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '120ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '240ms' }} />
              </span>
            </div>
          </div>
        )}
        {error && (
          <div className="text-xs text-rose-300">{error}</div>
        )}
        <div ref={scrollAnchorRef} />
      </div>

      <div
        className={cn(
          'px-4 py-3 border-t',
          theme === 'light' ? 'border-slate-200 bg-white' : 'border-white/10 bg-slate-950/80'
        )}
        style={surfaceStyle}
      >
        <div
          className={cn(
            'flex items-center gap-2 rounded-2xl px-3 py-2 border',
            theme === 'light' ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-white/5'
          )}
          style={radiusStyle}
        >
          <textarea
            rows={isWidget ? 1 : 2}
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder="Send a message…"
            className={cn(
              'va-chat-input flex-1 bg-transparent text-sm resize-none outline-none',
              theme === 'light' ? 'text-slate-900' : 'text-white'
            )}
            style={composerInlineStyle}
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!allowSend}
            className="shrink-0"
            style={buttonStyle}
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ChatEmbedApp() {
  const publicId = useMemo(() => resolvePublicId(), []);
  const search = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const theme = search.get('theme') === 'light' ? 'light' : 'dark';
  const isWidget = search.get('widget') === '1';

  if (!publicId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        <p>Missing public embed id.</p>
      </div>
    );
  }

  return <ChatEmbedView publicId={publicId} theme={theme} isWidget={isWidget} />;
}
