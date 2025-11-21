import { ReactNode, useState } from 'react';
import { Badge } from '../ui/Badge';
import { Mic, Wrench, History } from 'lucide-react';
import { SessionHistory } from '../session/SessionHistory';

interface SidebarProps {
  toolsCount: number;
  isConnected: boolean;
  onSessionSelect: (sessionId: string) => void;
  selectedSessionId?: string;
  currentSessionId?: string | null;
  children?: ReactNode;
}

export function Sidebar({
  toolsCount,
  isConnected,
  onSessionSelect,
  selectedSessionId,
  currentSessionId,
  children
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<'tools' | 'history'>('tools');

  return (
    <aside className="w-72 bg-white border-r border-gray-200 flex flex-col h-full">
      <div className="px-6 py-5 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-sm">
            <Mic className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Voice Agent</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className="text-xs text-gray-500">
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-gray-200 bg-gray-50">
        <div className="flex">
          <button
            onClick={() => setActiveTab('tools')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'tools'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <Wrench className="w-4 h-4" />
              <span>Tools</span>
              <Badge variant="secondary" className="text-xs">
                {toolsCount}
              </Badge>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'history'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <History className="w-4 h-4" />
              <span>History</span>
            </div>
          </button>
        </div>
      </div>

      {activeTab === 'tools' && (
        <>
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
            <div className="text-center space-y-1">
              <div className="text-lg font-semibold text-green-600">{toolsCount}</div>
              <div className="text-xs text-gray-500">MCP Tools Available</div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {children}
          </div>
        </>
      )}

      {activeTab === 'history' && (
        <div className="flex-1 overflow-hidden">
          <SessionHistory
            onSessionSelect={onSessionSelect}
            selectedSessionId={selectedSessionId}
            currentSessionId={currentSessionId}
          />
        </div>
      )}
    </aside>
  );
}
