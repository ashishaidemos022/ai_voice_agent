import { useEffect, useState } from 'react';
import { AuthScreen } from './auth/AuthScreen';
import { useAuth } from '../context/AuthContext';
import { LoadingScreen } from './ui/LoadingScreen';
import { ProviderKeyStep } from './portal/ProviderKeyStep';
import { AgentWorkspace } from './portal/AgentWorkspace';

export function PortalRouter() {
  const { session, vaUser, providerKeys, isLoading } = useAuth();
  const [hasUnlockedAgent, setHasUnlockedAgent] = useState(false);
  const [isRecoveryFlow, setIsRecoveryFlow] = useState(false);
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

  useEffect(() => {
    const detectRecovery = () => {
      if (typeof window === 'undefined') return false;
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      return hash.includes('type=recovery') || search.includes('type=recovery') || search.includes('recovery=1');
    };

    const updateRecovery = () => {
      setIsRecoveryFlow(detectRecovery());
    };

    updateRecovery();
    window.addEventListener('hashchange', updateRecovery);
    window.addEventListener('popstate', updateRecovery);
    return () => {
      window.removeEventListener('hashchange', updateRecovery);
      window.removeEventListener('popstate', updateRecovery);
    };
  }, []);

  if (isRecoveryFlow) {
    return <AuthScreen />;
  }

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
