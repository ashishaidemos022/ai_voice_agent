import { useEffect, useMemo, useState } from 'react';
import { Loader2, MessageCircle, Shield, Sparkles } from 'lucide-react';
import { useChatAgent } from '../../hooks/useChatAgent';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

const params = new URLSearchParams(window.location.search);

export function ChatWidget() {
  const agentId = params.get('agent');
  const theme = params.get('theme') ?? 'dark';
  const {
    presets,
    activePresetId,
    setActivePresetId,
    session,
    messages,
    liveAssistantText,
    isStreaming,
    isConnecting,
    error,
    startSession,
    sendMessage
  } = useChatAgent();
  const { vaUser, isLoading } = useAuth();
  const [composerValue, setComposerValue] = useState('');
  const [autoStarted, setAutoStarted] = useState(false);

  useEffect(() => {
    if (agentId) {
      setActivePresetId(agentId);
    }
  }, [agentId, setActivePresetId]);

  useEffect(() => {
    if (!autoStarted && agentId && activePresetId === agentId && vaUser && !session && presets.length > 0) {
      startSession();
      setAutoStarted(true);
    }
  }, [activePresetId, agentId, autoStarted, presets.length, session, startSession, vaUser]);

  const visibleMessages = useMemo(() => {
    if (!liveAssistantText) {
      return messages;
    }
    return [
      ...messages,
      {
        id: 'live',
        sessionId: session?.id || '',
        sender: 'assistant' as const,
        content: liveAssistantText,
        createdAt: new Date().toISOString(),
        isStreaming: true
      }
    ];
  }, [liveAssistantText, messages, session?.id]);

  const handleSend = () => {
    const trimmed = composerValue.trim();
    if (!trimmed) return;
    sendMessage(trimmed);
    setComposerValue('');
  };

  const allowSend = Boolean(session) && !isConnecting && !isLoading && Boolean(vaUser);

  return (
    <div className={cn('w-full h-full flex flex-col', theme === 'light' ? 'bg-white text-slate-900' : 'bg-slate-950 text-white')}>
      <div className={cn('px-4 py-3 border-b flex items-center justify-between', theme === 'light' ? 'border-slate-200' : 'border-white/10')}>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold">Agentic Chat</p>
            <p className={cn('text-[11px]', theme === 'light' ? 'text-slate-500' : 'text-white/60')}>
              {presets.find((p) => p.id === activePresetId)?.name || 'Preset not selected'}
            </p>
          </div>
        </div>
        <div className={cn('text-[11px] flex items-center gap-1 px-2 py-1 rounded-full border', theme === 'light' ? 'border-slate-200 text-slate-600' : 'border-white/15 text-white/70')}>
          <Shield className="w-3 h-3" />
          JWT Secure
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {!vaUser && !isLoading && (
          <div className="text-sm text-center opacity-80">
            Provide a valid Supabase JWT token via <code className="px-1 py-0.5 rounded bg-black/20">data-user-jwt</code> to unlock the widget.
          </div>
        )}
        {visibleMessages.length === 0 && allowSend && (
          <div className={cn('text-center text-sm', theme === 'light' ? 'text-slate-500' : 'text-white/60')}>
            Ask anything to begin the session.
          </div>
        )}
        {visibleMessages.map((message) => (
          <div
            key={message.id}
            className={cn(
              'px-3 py-2 rounded-2xl text-sm max-w-[85%]',
              message.sender === 'user'
                ? theme === 'light'
                  ? 'bg-indigo-500 text-white ml-auto rounded-br-sm'
                  : 'bg-indigo-500 text-white ml-auto rounded-br-sm'
                : theme === 'light'
                ? 'bg-slate-100 text-slate-900 rounded-bl-sm'
                : 'bg-white/10 text-white rounded-bl-sm'
            )}
          >
            <div className={cn('flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] mb-1', theme === 'light' ? 'text-slate-500' : 'text-white/50')}>
              {message.sender === 'user' ? 'You' : 'Agent'}
              {message.isStreaming && <Loader2 className="w-3 h-3 animate-spin" />}
            </div>
            <p className="leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </div>
        ))}
      </div>

      <div className={cn('px-4 py-3 border-t', theme === 'light' ? 'border-slate-200 bg-white' : 'border-white/10 bg-slate-950/80')}>
        {error && (
          <p className="text-xs text-rose-400 mb-2">{error}</p>
        )}
        <div className={cn('flex items-center gap-2 rounded-2xl px-3 py-2 border', theme === 'light' ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-white/5')}>
          <textarea
            rows={2}
            value={composerValue}
            onChange={(e) => setComposerValue(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            disabled={!allowSend}
            placeholder={allowSend ? 'Send a message…' : 'Waiting for authentication'}
            className={cn('flex-1 bg-transparent text-sm resize-none outline-none', theme === 'light' ? 'placeholder:text-slate-400 text-slate-900' : 'placeholder:text-white/40 text-white')}
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!allowSend || !composerValue.trim()}
          >
            <MessageCircle className="w-4 h-4" />
          </Button>
        </div>
        {isStreaming && allowSend && (
          <p className={cn('text-[11px] mt-1 flex items-center gap-1', theme === 'light' ? 'text-slate-500' : 'text-white/50')}>
            <Loader2 className="w-3 h-3 animate-spin" />
            Agent is responding…
          </p>
        )}
      </div>
    </div>
  );
}
