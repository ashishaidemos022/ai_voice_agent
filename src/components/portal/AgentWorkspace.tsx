import { useState } from 'react';
import { MessageSquare, Waves } from 'lucide-react';
import { ChatAgent } from '../chat/ChatAgent';
import { VoiceAgent } from '../VoiceAgent';
import { cn } from '../../lib/utils';

type WorkspaceTab = 'chat' | 'voice';

export function AgentWorkspace() {
  const [tab, setTab] = useState<WorkspaceTab>('chat');
  const isChat = tab === 'chat';

  return (
    <div
      className={cn(
        'h-screen flex flex-col',
        isChat ? 'bg-slate-950 text-white' : 'bg-background text-gray-900'
      )}
    >
      <div
        className={cn(
          'px-8 py-3 flex items-center gap-4 border-b transition-colors',
          isChat
            ? 'border-white/10 bg-slate-900/70 backdrop-blur text-white'
            : 'border-gray-200 bg-white text-gray-800'
        )}
      >
        <WorkspaceTabButton
          label="Chat Agent"
          icon={<MessageSquare className="w-4 h-4" />}
          isActive={isChat}
          tone={isChat ? 'light' : 'dark'}
          onClick={() => setTab('chat')}
        />
        <WorkspaceTabButton
          label="Voice Agent"
          icon={<Waves className="w-4 h-4" />}
          isActive={!isChat}
          tone={isChat ? 'light' : 'dark'}
          onClick={() => setTab('voice')}
        />
      </div>
      <div className="flex-1 overflow-hidden">
        {isChat ? <ChatAgent /> : <VoiceAgent />}
      </div>
    </div>
  );
}

function WorkspaceTabButton({
  label,
  icon,
  isActive,
  tone,
  onClick
}: {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  tone: 'light' | 'dark';
  onClick: () => void;
}) {
  const baseInactive =
    tone === 'light'
      ? 'border-white/10 text-white/70 hover:border-white/40 hover:text-white'
      : 'border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900';
  const baseActive =
    tone === 'light'
      ? 'border-white/70 bg-white/10 text-white'
      : 'border-gray-900 text-gray-900 bg-gray-100';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-1.5 rounded-full border transition-colors text-sm',
        isActive ? baseActive : baseInactive
      )}
    >
      {icon}
      {label}
    </button>
  );
}
