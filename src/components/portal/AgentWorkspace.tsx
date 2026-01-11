import { useEffect, useRef, useState } from 'react';
import { ChatAgent } from '../chat/ChatAgent';
import { VoiceAgent } from '../VoiceAgent';
import { KnowledgeBaseDrawer } from '../rag/KnowledgeBaseDrawer';
import { useAuth } from '../../context/AuthContext';

type WorkspaceTab = 'chat' | 'voice';

export function AgentWorkspace() {
  const { vaUser } = useAuth();
  const [tab, setTab] = useState<WorkspaceTab>('voice');
  const [isKnowledgeDrawerOpen, setIsKnowledgeDrawerOpen] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [showEmbedUsage, setShowEmbedUsage] = useState(false);
  const didAutoOpenCreateRef = useRef(false);

  useEffect(() => {
    if (!vaUser || didAutoOpenCreateRef.current) return;
    if (!vaUser.default_agent_id) {
      setShowCreateAgent(true);
      setTab('voice');
      didAutoOpenCreateRef.current = true;
    }
  }, [vaUser]);

  const handleNavigateVoice = () => {
    setShowCreateAgent(false);
    setShowSkills(false);
    setShowUsage(false);
    setShowEmbedUsage(false);
    setTab('voice');
  };

  const handleNavigateChat = () => {
    setShowCreateAgent(false);
    setShowSkills(false);
    setShowUsage(false);
    setShowEmbedUsage(false);
    setTab('chat');
  };

  const handleOpenCreateAgent = () => {
    setShowCreateAgent(true);
    setShowSkills(false);
    setShowUsage(false);
    setShowEmbedUsage(false);
    setTab('voice');
  };

  const handleOpenSkills = () => {
    setShowSkills(true);
    setShowCreateAgent(false);
    setShowUsage(false);
    setShowEmbedUsage(false);
    setTab('voice');
  };

  const handleOpenUsage = () => {
    setShowUsage(true);
    setShowCreateAgent(false);
    setShowSkills(false);
    setShowEmbedUsage(false);
    setTab('voice');
  };

  const handleOpenEmbedUsage = () => {
    setShowEmbedUsage(true);
    setShowUsage(false);
    setShowCreateAgent(false);
    setShowSkills(false);
    setTab('voice');
  };

  return (
    <div className="h-screen overflow-hidden">
      {tab === 'chat' ? (
        <ChatAgent
          onNavigateVoice={handleNavigateVoice}
          onOpenCreateAgent={handleOpenCreateAgent}
          onOpenSkills={handleOpenSkills}
          onOpenKnowledgeBase={() => setIsKnowledgeDrawerOpen(true)}
          onOpenUsage={handleOpenUsage}
          onOpenEmbedUsage={handleOpenEmbedUsage}
        />
      ) : (
        <VoiceAgent
          onNavigateChat={handleNavigateChat}
          onOpenKnowledgeBase={() => setIsKnowledgeDrawerOpen(true)}
          showCreateAgent={showCreateAgent}
          onOpenCreateAgent={handleOpenCreateAgent}
          onCloseCreateAgent={() => setShowCreateAgent(false)}
          showSkills={showSkills}
          onOpenSkills={handleOpenSkills}
          onCloseSkills={() => setShowSkills(false)}
          showUsage={showUsage}
          onOpenUsage={handleOpenUsage}
          onCloseUsage={() => setShowUsage(false)}
          showEmbedUsage={showEmbedUsage}
          onOpenEmbedUsage={handleOpenEmbedUsage}
          onCloseEmbedUsage={() => setShowEmbedUsage(false)}
        />
      )}
      <KnowledgeBaseDrawer
        isOpen={isKnowledgeDrawerOpen}
        onClose={() => setIsKnowledgeDrawerOpen(false)}
      />
    </div>
  );
}
