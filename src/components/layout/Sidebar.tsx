import { ReactNode } from 'react';
import { BarChart3, MessageSquare, Mic, Wrench } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SidebarProps {
  isConnected?: boolean;
  children?: ReactNode;
  activeNav?: 'voice' | 'chat' | 'create' | 'skills' | 'usage';
  onNavigateVoice?: () => void;
  onNavigateChat?: () => void;
  onNavigateSkills?: () => void;
  onOpenKnowledgeBase?: () => void;
  onOpenUsage?: () => void;
  onOpenSettings?: () => void;
  allowVoiceNavWhenActive?: boolean;
}

export function Sidebar({
  isConnected = false,
  children,
  activeNav = 'voice',
  onNavigateVoice,
  onNavigateChat,
  onNavigateSkills,
  onOpenKnowledgeBase,
  onOpenUsage,
  onOpenSettings,
  allowVoiceNavWhenActive = false
}: SidebarProps) {
  const headerLabel =
    activeNav === 'chat'
      ? 'Chat Agent'
      : activeNav === 'create'
        ? 'Create Agent'
        : activeNav === 'skills'
          ? 'Skills'
          : activeNav === 'usage'
            ? 'Usage'
          : 'Voice Agent';
  const showConnectionStatus = activeNav !== 'create' && activeNav !== 'skills' && activeNav !== 'usage';

  return (
    <aside className="w-72 bg-slate-950/70 border-r border-white/10 flex flex-col h-full">
      <div className="px-6 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(34,211,238,0.3)]">
            {activeNav === 'chat' ? (
              <MessageSquare className="w-5 h-5 text-slate-950" />
            ) : activeNav === 'create' || activeNav === 'skills' ? (
              <Wrench className="w-5 h-5 text-slate-950" />
            ) : activeNav === 'usage' ? (
              <BarChart3 className="w-5 h-5 text-slate-950" />
            ) : (
              <Mic className="w-5 h-5 text-slate-950" />
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Viaana AI</p>
            <h1 className="text-lg font-semibold text-white font-display">{headerLabel}</h1>
            {showConnectionStatus && (
              <div className="flex items-center gap-2 mt-0.5">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-white/30'}`} />
                <span className="text-xs text-white/60">
                  {isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 py-4 border-b border-white/10">
        <p className="text-[11px] uppercase tracking-[0.3em] text-white/40 px-2 mb-3">Workspace</p>
        <div className="space-y-2">
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-3 rounded-xl border transition shadow-[0_0_20px_rgba(34,211,238,0.08)]',
                activeNav === 'create'
                  ? 'border-cyan-400/60 bg-cyan-500/15 text-white'
                  : 'border-transparent bg-white/5 text-white/80 hover:border-cyan-300/50 hover:bg-cyan-500/10'
              )}
            >
              <span className="text-sm font-semibold">Create Agent</span>
            </button>
          )}
          {onNavigateSkills && (
            <button
              type="button"
              onClick={onNavigateSkills}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-xl border transition',
                activeNav === 'skills'
                  ? 'border-cyan-400/60 bg-cyan-500/15 text-white'
                  : 'border-white/5 text-white/70 hover:border-white/20 hover:bg-white/5'
              )}
            >
              <span className="text-sm font-medium">Skills</span>
            </button>
          )}
          <button
            type="button"
            onClick={activeNav === 'voice' && !allowVoiceNavWhenActive ? undefined : onNavigateVoice}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl border transition ${
              activeNav === 'voice'
                ? 'border-cyan-400/40 bg-cyan-500/10 text-white'
                : 'border-white/5 text-white/70 hover:border-white/20 hover:bg-white/5'
            }`}
            disabled={activeNav === 'voice' && !allowVoiceNavWhenActive}
          >
            <span className="text-sm font-medium">Voice Agent</span>
          </button>
          {onNavigateChat && (
            <button
              type="button"
              onClick={activeNav === 'chat' ? undefined : onNavigateChat}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl border transition ${
                activeNav === 'chat'
                  ? 'border-cyan-400/40 bg-cyan-500/10 text-white'
                  : 'border-white/5 text-white/70 hover:border-white/20 hover:bg-white/5'
              }`}
              disabled={activeNav === 'chat'}
            >
              <span className="text-sm font-medium">Chat Agent</span>
            </button>
          )}
          {onOpenKnowledgeBase && (
            <button
              type="button"
              onClick={onOpenKnowledgeBase}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl border border-white/5 text-white/70 hover:border-white/20 hover:bg-white/5 transition"
            >
              <span className="text-sm font-medium">Knowledge Base</span>
            </button>
          )}
          {onOpenUsage && (
            <button
              type="button"
              onClick={onOpenUsage}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-xl border transition',
                activeNav === 'usage'
                  ? 'border-cyan-400/60 bg-cyan-500/15 text-white'
                  : 'border-white/5 text-white/70 hover:border-white/20 hover:bg-white/5'
              )}
            >
              <span className="text-sm font-medium">Usage</span>
            </button>
          )}
        </div>
      </div>
      {children}
    </aside>
  );
}
