import { ReactNode, useState } from 'react';
import { ChevronDown, ChevronRight, History, Wrench } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { cn } from '../../lib/utils';

interface WorkspaceSidePanelsProps {
  toolsContent: ReactNode;
  historyContent?: ReactNode;
  toolsCount?: number;
  historyCount?: number;
  className?: string;
  defaultToolsOpen?: boolean;
  defaultHistoryOpen?: boolean;
  showHistory?: boolean;
}

export function WorkspaceSidePanels({
  toolsContent,
  historyContent,
  toolsCount,
  historyCount,
  className,
  defaultToolsOpen = true,
  defaultHistoryOpen = true,
  showHistory = true
}: WorkspaceSidePanelsProps) {
  const [isToolsOpen, setIsToolsOpen] = useState(defaultToolsOpen);
  const [isHistoryOpen, setIsHistoryOpen] = useState(defaultHistoryOpen);

  return (
    <aside
      className={cn(
        'w-80 border-l border-white/10 bg-slate-950/60 backdrop-blur flex flex-col overflow-hidden',
        className
      )}
    >
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <Card className="bg-slate-900/40 border-white/10">
          <button
            type="button"
            onClick={() => setIsToolsOpen((prev) => !prev)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2">
              {isToolsOpen ? (
                <ChevronDown className="w-4 h-4 text-white/50" />
              ) : (
                <ChevronRight className="w-4 h-4 text-white/50" />
              )}
              <Wrench className="w-4 h-4 text-cyan-300" />
              <span className="text-sm font-semibold text-white">Tools</span>
              {typeof toolsCount === 'number' && (
                <Badge variant="secondary" className="bg-white/10 text-white/70 border border-white/10">
                  {toolsCount}
                </Badge>
              )}
            </div>
            <span className="text-[11px] text-white/40 uppercase tracking-[0.2em]">
              {isToolsOpen ? 'Hide' : 'Show'}
            </span>
          </button>
          {isToolsOpen && (
            <div className="border-t border-white/10">
              {toolsContent}
            </div>
          )}
        </Card>

        {showHistory && historyContent && (
          <Card className="bg-slate-900/40 border-white/10">
            <button
              type="button"
              onClick={() => setIsHistoryOpen((prev) => !prev)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isHistoryOpen ? (
                  <ChevronDown className="w-4 h-4 text-white/50" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-white/50" />
                )}
                <History className="w-4 h-4 text-amber-200" />
                <span className="text-sm font-semibold text-white">History</span>
                {typeof historyCount === 'number' && (
                  <Badge variant="secondary" className="bg-white/10 text-white/70 border border-white/10">
                    {historyCount}
                  </Badge>
                )}
              </div>
              <span className="text-[11px] text-white/40 uppercase tracking-[0.2em]">
                {isHistoryOpen ? 'Hide' : 'Show'}
              </span>
            </button>
            {isHistoryOpen && (
              <div className="border-t border-white/10">
                {historyContent}
              </div>
            )}
          </Card>
        )}
      </div>
    </aside>
  );
}
