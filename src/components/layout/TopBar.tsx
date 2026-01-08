import { Settings, Plug, Power, ArrowLeft, LogOut, Webhook, ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';

interface TopBarProps {
  isInitialized: boolean;
  activeConfigName?: string;
  sessionDuration?: string;
  onSettingsClick: () => void;
  onMCPClick: () => void;
  onIntegrationsClick?: () => void;
  onEndSession: () => void;
  viewMode?: 'current' | 'history';
  onBackToCurrent?: () => void;
  onSignOut?: () => void;
  userEmail?: string;
}

export function TopBar({
  isInitialized,
  activeConfigName,
  sessionDuration,
  onSettingsClick,
  onMCPClick,
  onIntegrationsClick,
  onEndSession,
  viewMode = 'current',
  onBackToCurrent,
  onSignOut,
  userEmail
}: TopBarProps) {
  return (
    <header className="h-16 border-b border-white/10 bg-slate-950/60 backdrop-blur-sm sticky top-0 z-10">
      <div className="h-full px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="hidden lg:flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-white/30">
            <span>Agent Workspace</span>
            <ChevronRight className="w-3 h-3 text-white/30" />
            <span>{viewMode === 'history' ? 'Logs' : 'Runtime'}</span>
          </div>
          {viewMode === 'history' && onBackToCurrent && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBackToCurrent}
              className="text-cyan-200 hover:text-cyan-100 hover:bg-white/5"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Current Session
            </Button>
          )}
          {viewMode === 'current' && isInitialized && sessionDuration && (
            <div className="text-sm text-white/70">
              <span className="font-medium text-white/90">Session:</span> {sessionDuration}
            </div>
          )}
          {viewMode === 'current' && activeConfigName && (
            <Badge variant="default" className="bg-cyan-400/10 text-cyan-200 border border-cyan-400/30">
              {activeConfigName}
            </Badge>
          )}
          {viewMode === 'history' && (
            <Badge variant="secondary" className="bg-white/10 text-white/70 border border-white/20">
              Viewing History
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {userEmail && (
            <div className="hidden md:flex flex-col items-end mr-2 text-right">
              <span className="text-[11px] uppercase tracking-wide text-white/40">Signed in</span>
              <span className="text-sm text-white/80 font-medium">{userEmail}</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onMCPClick}
            title="Manage MCP Connections"
            className="text-white/70 hover:text-cyan-100 hover:bg-white/5"
          >
            <Plug className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onIntegrationsClick}
            title="Configure n8n webhooks"
            className="text-white/70 hover:text-cyan-100 hover:bg-white/5"
          >
            <Webhook className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onSettingsClick}
            disabled={viewMode === 'history'}
            title={viewMode === 'history' ? 'Settings unavailable in history view' : 'Configure agent settings'}
            className="text-white/70 hover:text-cyan-100 hover:bg-white/5"
          >
            <Settings className="w-4 h-4" />
          </Button>

          {isInitialized && viewMode === 'current' && (
            <Button
              variant="destructive"
              size="sm"
              onClick={onEndSession}
              className="bg-rose-500/90 hover:bg-rose-500 text-white"
            >
              <Power className="w-4 h-4" />
              End Session
            </Button>
          )}

          {onSignOut && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSignOut}
              className="bg-transparent border-white/20 text-white/80 hover:border-cyan-300/60 hover:text-cyan-100 hover:bg-white/5"
            >
              <LogOut className="w-4 h-4 mr-1" />
              Sign Out
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
