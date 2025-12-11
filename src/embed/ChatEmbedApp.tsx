import { useMemo, useState } from 'react';
import { Loader2, MessageCircle, RotateCcw, Sparkles } from 'lucide-react';
import { useEmbedChat } from './useEmbedChat';
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

export function ChatEmbedView({ publicId, theme, isWidget }: ChatEmbedViewProps) {
  const [composer, setComposer] = useState('');

  const {
    messages,
    agentMeta,
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

  return (
    <div
      className={cn(
        'min-h-screen flex flex-col',
        theme === 'light' ? 'bg-white text-slate-900' : 'bg-slate-950 text-white',
        isWidget ? 'w-full h-full max-w-sm' : ''
      )}
    >
      <div
        className={cn(
          'px-4 py-3 border-b flex items-center justify-between',
          theme === 'light' ? 'border-slate-200 bg-white' : 'border-white/10 bg-slate-900/70'
        )}
      >
        <div className="flex items-center gap-2">
          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', theme === 'light' ? 'bg-slate-900 text-white' : 'bg-gradient-to-br from-indigo-500 to-purple-500 text-white')}>
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">{agentMeta?.name || 'AI Agent'}</p>
            <p className={cn('text-[11px] line-clamp-1', theme === 'light' ? 'text-slate-500' : 'text-white/60')}>
              {agentMeta?.summary || 'Conversational assistant'}
            </p>
          </div>
        </div>
        <Button
          size="xs"
          variant="ghost"
          className={cn('gap-1', theme === 'light' ? 'text-slate-500 hover:bg-slate-100' : 'text-white/70 hover:bg-white/10')}
          onClick={resetChat}
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {isLoadingMeta && (
          <div className="flex items-center gap-2 text-sm opacity-80">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading agent…
          </div>
        )}
        {messages.length === 0 && !isLoadingMeta && (
          <div className={cn('text-sm text-center', theme === 'light' ? 'text-slate-500' : 'text-white/60')}>
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
          >
            <div className={cn('text-[10px] uppercase tracking-[0.25em] mb-1 flex items-center gap-1', message.role === 'user' ? 'opacity-70' : 'opacity-60')}>
              {message.role === 'user' ? 'You' : 'Agent'}
            </div>
            <p className="leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </div>
        ))}
        {error && (
          <div className="text-xs text-rose-300">{error}</div>
        )}
      </div>

      <div
        className={cn(
          'px-4 py-3 border-t',
          theme === 'light' ? 'border-slate-200 bg-white' : 'border-white/10 bg-slate-950/80'
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2 rounded-2xl px-3 py-2 border',
            theme === 'light' ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-white/5'
          )}
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
              'flex-1 bg-transparent text-sm resize-none outline-none',
              theme === 'light' ? 'placeholder:text-slate-400 text-slate-900' : 'placeholder:text-white/40 text-white'
            )}
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!allowSend}
            className="shrink-0"
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
