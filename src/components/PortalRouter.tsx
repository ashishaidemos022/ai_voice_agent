import { useEffect, useState } from 'react';
import { AuthScreen } from './auth/AuthScreen';
import { useAuth } from '../context/AuthContext';
import { LoadingScreen } from './ui/LoadingScreen';
import { ProviderKeyStep } from './portal/ProviderKeyStep';
import { AgentWorkspace } from './portal/AgentWorkspace';

export function PortalRouter() {
  const { session, vaUser, providerKeys, isLoading } = useAuth();
  const [hasUnlockedAgent, setHasUnlockedAgent] = useState(false);
  const isAgentReady = !!session && !!vaUser && !!vaUser.default_agent_id && providerKeys.length > 0;

  useEffect(() => {
    if (!session) {
      setHasUnlockedAgent(false);
      return;
    }
    if (isAgentReady) {
      setHasUnlockedAgent(true);
    }
  }, [session, isAgentReady]);

  if (!session) {
    return <AuthScreen />;
  }

  if (hasUnlockedAgent) {
    return <AgentWorkspace />;
  }

  if (isLoading || !vaUser) {
    return <LoadingScreen message="Loading your workspace..." />;
  }

  if (!providerKeys.length) {
    return <ProviderKeyStep />;
  }

  return <AgentWorkspace />;
}
