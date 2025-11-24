import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type VaUserProfile = {
  id: string;
  auth_user_id: string;
  email: string;
  display_name: string | null;
  onboarding_state: 'pending' | 'needs_api_key' | 'needs_agent' | 'ready';
  default_agent_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ProviderKey = {
  id: string;
  user_id: string;
  provider: 'openai';
  key_alias: string;
  encrypted_key: string;
  last_four: string | null;
  created_at: string;
  updated_at: string;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  vaUser: VaUserProfile | null;
  providerKeys: ProviderKey[];
  isLoading: boolean;
  refreshProfile: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchVaUserProfile(): Promise<VaUserProfile | null> {
  const { data, error } = await supabase
    .from('va_users')
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('Failed to load va_user profile:', error);
    throw error;
  }

  return data as VaUserProfile | null;
}

async function fetchProviderKeys(): Promise<ProviderKey[]> {
  const { data, error } = await supabase
    .from('va_provider_keys')
    .select('id, user_id, provider, key_alias, last_four, created_at, updated_at')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to load provider keys:', error);
    throw error;
  }

  return (data || []) as ProviderKey[];
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [vaUser, setVaUser] = useState<VaUserProfile | null>(null);
  const [providerKeys, setProviderKeys] = useState<ProviderKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    if (!session) {
      setVaUser(null);
      setProviderKeys([]);
      return;
    }

    try {
      const [profile, keys] = await Promise.all([
        fetchVaUserProfile(),
        fetchProviderKeys()
      ]);
      setVaUser(profile);
      setProviderKeys(keys);
    } catch (error) {
      console.error('Failed to refresh profile:', error);
    }
  }, [session]);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (!nextSession) {
        setVaUser(null);
        setProviderKeys([]);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    refreshProfile().finally(() => setIsLoading(false));
  }, [refreshProfile, session]);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw error;
    }
  }, []);

  const signUpWithPassword = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      throw error;
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
    if (error) {
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw error;
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user,
    vaUser,
    providerKeys,
    isLoading,
    refreshProfile,
    signInWithPassword,
    signUpWithPassword,
    signInWithGoogle,
    signOut
  }), [
    session,
    user,
    vaUser,
    providerKeys,
    isLoading,
    refreshProfile,
    signInWithPassword,
    signUpWithPassword,
    signInWithGoogle,
    signOut
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
