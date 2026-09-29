import { ReactNode, useEffect, useState } from 'react';
import {
  BarChart3, BookOpen, Code2, FlaskConical, MessageSquare, Mic, PanelLeftClose, PanelLeftOpen, Sparkles, Wrench,
  type LucideIcon
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface SidebarProps {
  isConnected?: boolean;
  children?: ReactNode;
  activeNav?: 'voice' | 'chat' | 'voice-lab' | 'open-weight-lab' | 'create' | 'skills' | 'usage' | 'embed-usage';
  onNavigateVoice?: () => void;
  onNavigateChat?: () => void;
  onNavigateVoiceLab?: () => void;
  onNavigateOpenWeightLab?: () => void;
  onNavigateSkills?: () => void;
  onOpenKnowledgeBase?: () => void;
  onOpenUsage?: () => void;
  onOpenEmbedUsage?: () => void;
  onOpenSettings?: () => void;
  allowVoiceNavWhenActive?: boolean;
}

const COLLAPSED_KEY = 'va-sidebar-collapsed';

type NavTone = 'cyan' | 'violet' | 'amber';

interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick?: () => void;
  disabled?: boolean;
  tone?: NavTone;
  emphasized?: boolean;
}

const ACTIVE_TONE: Record<NavTone, string> = {
  cyan: 'border-cyan-400/60 bg-cyan-500/15 text-white',
  violet: 'border-violet-400/60 bg-violet-500/15 text-white',
  amber: 'border-amber-400/60 bg-amber-500/15 text-white'
};

const IDLE_TONE: Record<NavTone, string> = {
  cyan: 'border-white/5 text-white/70 hover:border-white/20 hover:bg-white/5',
  violet: 'border-white/5 text-white/70 hover:border-violet-300/40 hover:bg-violet-500/10',
  amber: 'border-white/5 text-white/70 hover:border-amber-300/40 hover:bg-amber-500/10'
};

function NavButton({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  const tone = item.tone ?? 'cyan';
  return (
    <button
      type="button"
      onClick={item.disabled ? undefined : item.onClick}
      disabled={item.disabled}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      aria-current={item.active ? 'page' : undefined}
      className={cn(
        'w-full flex items-center rounded-xl border transition',
        collapsed ? 'justify-center h-10 px-0' : 'gap-3 px-3',
        !collapsed && (item.emphasized ? 'py-3' : 'py-2'),
        item.emphasized && 'shadow-[0_0_20px_rgba(34,211,238,0.08)]',
        item.active
          ? ACTIVE_TONE[tone]
          : item.emphasized
            ? 'border-transparent bg-white/5 text-white/80 hover:border-cyan-300/50 hover:bg-cyan-500/10'
            : IDLE_TONE[tone]
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span className={cn('text-sm', item.emphasized ? 'font-semibold' : 'font-medium')}>{item.label}</span>}
    </button>
  );
}

function readCollapsed() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(COLLAPSED_KEY) === 'true';
}

export function Sidebar({
  isConnected = false,
  children,
  activeNav = 'voice',
  onNavigateVoice,
  onNavigateChat,
  onNavigateVoiceLab,
  onNavigateOpenWeightLab,
  onNavigateSkills,
  onOpenKnowledgeBase,
  onOpenUsage,
  onOpenEmbedUsage,
  onOpenSettings,
  allowVoiceNavWhenActive = false
}: SidebarProps) {
  const headerLabel =
    activeNav === 'chat'
      ? 'Chat Agent'
      : activeNav === 'voice-lab'
        ? 'Voice Lab'
      : activeNav === 'open-weight-lab'
        ? 'Open Weight Lab'
      : activeNav === 'create'
        ? 'Create Agent'
        : activeNav === 'skills'
          ? 'Skills'
          : activeNav === 'usage'
            ? 'Usage'
            : activeNav === 'embed-usage'
              ? 'Embed Usage'
          : 'Voice Agent';
  const [collapsed, setCollapsed] = useState(readCollapsed);
  useEffect(() => {
    if (collapsed) window.localStorage.setItem(COLLAPSED_KEY, 'true');
    else window.localStorage.removeItem(COLLAPSED_KEY);
  }, [collapsed]);

  const showConnectionStatus =
    activeNav !== 'create' && activeNav !== 'skills' && activeNav !== 'usage' && activeNav !== 'embed-usage' && activeNav !== 'voice-lab' && activeNav !== 'open-weight-lab';

  const HeaderIcon =
    activeNav === 'voice-lab' ? FlaskConical
      : activeNav === 'chat' ? MessageSquare
        : activeNav === 'create' || activeNav === 'skills' ? Wrench
          : activeNav === 'usage' ? BarChart3
            : Mic;

  const items: NavItem[] = [
    ...(onOpenSettings
      ? [{ key: 'create', label: 'Create Agent', icon: Sparkles, active: activeNav === 'create', onClick: onOpenSettings, emphasized: true }]
      : []),
    ...(onNavigateSkills
      ? [{ key: 'skills', label: 'Skills', icon: Wrench, active: activeNav === 'skills', onClick: onNavigateSkills }]
      : []),
    {
      key: 'voice', label: 'Voice Agent', icon: Mic, active: activeNav === 'voice', onClick: onNavigateVoice,
      disabled: activeNav === 'voice' && !allowVoiceNavWhenActive
    },
    ...(onNavigateChat
      ? [{ key: 'chat', label: 'Chat Agent', icon: MessageSquare, active: activeNav === 'chat', onClick: onNavigateChat, disabled: activeNav === 'chat' }]
      : []),
    ...(onNavigateVoiceLab
      ? [{
        key: 'voice-lab', label: 'Voice Lab', icon: FlaskConical, active: activeNav === 'voice-lab', onClick: onNavigateVoiceLab,
        disabled: activeNav === 'voice-lab', tone: 'violet' as const
      }]
      : []),
    ...(onNavigateOpenWeightLab
      ? [{
        key: 'open-weight-lab', label: 'Open Weight Lab', icon: FlaskConical, active: activeNav === 'open-weight-lab',
        onClick: onNavigateOpenWeightLab, disabled: activeNav === 'open-weight-lab', tone: 'amber' as const
      }]
      : []),
    ...(onOpenKnowledgeBase
      ? [{ key: 'knowledge', label: 'Knowledge Base', icon: BookOpen, active: false, onClick: onOpenKnowledgeBase }]
      : []),
    ...(onOpenUsage
      ? [{ key: 'usage', label: 'Usage', icon: BarChart3, active: activeNav === 'usage', onClick: onOpenUsage }]
      : []),
    ...(onOpenEmbedUsage
      ? [{ key: 'embed-usage', label: 'Embed Usage Stats', icon: Code2, active: activeNav === 'embed-usage', onClick: onOpenEmbedUsage }]
      : [])
  ];

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';

  return (
    <aside
      className={cn(
        'bg-slate-950/70 border-r border-white/10 flex flex-col h-full shrink-0 transition-[width] duration-200 ease-out',
        collapsed ? 'w-16' : 'w-72'
      )}
    >
      <div className={cn('border-b border-white/10', collapsed ? 'px-3 py-4 flex flex-col items-center gap-3' : 'px-6 py-5')}>
        <div className={cn('flex items-center', collapsed ? 'justify-center' : 'gap-3')}>
          <div
            className="relative w-10 h-10 shrink-0 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(34,211,238,0.3)]"
            title={collapsed ? headerLabel : undefined}
          >
            <HeaderIcon className="w-5 h-5 text-slate-950" />
            {collapsed && showConnectionStatus && (
              <span
                className={cn(
                  'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-950',
                  isConnected ? 'bg-emerald-400' : 'bg-slate-500'
                )}
                title={isConnected ? 'Connected' : 'Disconnected'}
              />
            )}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
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
          )}
          {!collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label={toggleLabel}
              title={toggleLabel}
              className="self-start rounded-lg p-1.5 text-white/40 hover:bg-white/5 hover:text-white transition"
            >
              <ToggleIcon className="w-4 h-4" />
            </button>
          )}
        </div>
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label={toggleLabel}
            title={toggleLabel}
            className="rounded-lg p-1.5 text-white/40 hover:bg-white/5 hover:text-white transition"
          >
            <ToggleIcon className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className={cn('border-b border-white/10', collapsed ? 'px-3 py-4' : 'px-4 py-4')}>
        {!collapsed && <p className="text-[11px] uppercase tracking-[0.3em] text-white/40 px-2 mb-3">Workspace</p>}
        <nav className="space-y-2" aria-label="Workspace">
          {items.map((item) => <NavButton key={item.key} item={item} collapsed={collapsed} />)}
        </nav>
      </div>
      {!collapsed && children}
    </aside>
  );
}
