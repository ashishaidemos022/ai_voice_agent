import { useEffect, useState } from 'react';
import { AuthScreen } from './auth/AuthScreen';
import { useAuth } from '../context/AuthContext';
import { LoadingScreen } from './ui/LoadingScreen';
import { AgentWorkspace } from './portal/AgentWorkspace';

export function PortalRouter() {
  const { session, vaUser, isLoading } = useAuth();
  const [isRecoveryFlow, setIsRecoveryFlow] = useState(false);

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

  if (isLoading || !vaUser) {
    return <LoadingScreen message="Loading your workspace..." />;
  }

  return <AgentWorkspace />;
}
