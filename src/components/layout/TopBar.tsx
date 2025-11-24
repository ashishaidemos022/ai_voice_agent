import { Settings, Plug, Power, ArrowLeft, LogOut } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';

interface TopBarProps {
  isInitialized: boolean;
  activeConfigName?: string;
  sessionDuration?: string;
  onSettingsClick: () => void;
  onMCPClick: () => void;
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
  onEndSession,
  viewMode = 'current',
  onBackToCurrent,
  onSignOut,
  userEmail
}: TopBarProps) {
  return (
    <header className="h-16 border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
      <div className="h-full px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {viewMode === 'history' && onBackToCurrent && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBackToCurrent}
              className="text-blue-600 hover:text-blue-700"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Current Session
            </Button>
          )}
          {viewMode === 'current' && isInitialized && sessionDuration && (
            <div className="text-sm text-gray-600">
              <span className="font-medium">Session:</span> {sessionDuration}
            </div>
          )}
          {viewMode === 'current' && activeConfigName && (
            <Badge variant="default">{activeConfigName}</Badge>
          )}
          {viewMode === 'history' && (
            <Badge variant="secondary">Viewing History</Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {userEmail && (
            <div className="hidden md:flex flex-col items-end mr-2 text-right">
              <span className="text-[11px] uppercase tracking-wide text-gray-400">Signed in</span>
              <span className="text-sm text-gray-700 font-medium">{userEmail}</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onMCPClick}
            title="Manage MCP Connections"
          >
            <Plug className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onSettingsClick}
            disabled={viewMode === 'history'}
            title={viewMode === 'history' ? 'Settings unavailable in history view' : 'Configure agent settings'}
          >
            <Settings className="w-4 h-4" />
          </Button>

          {isInitialized && viewMode === 'current' && (
            <Button
              variant="destructive"
              size="sm"
              onClick={onEndSession}
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
