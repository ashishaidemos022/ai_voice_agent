import { useEffect } from 'react';
import { AuthProvider } from '../context/AuthContext';
import { ChatWidget } from '../components/chat/ChatWidget';
import { supabase } from '../lib/supabase';

export function WidgetApp() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get('token') || params.get('access_token');
    const refreshToken = params.get('refresh_token') || params.get('token');
    if (accessToken) {
      supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken || accessToken
      }).catch((err) => {
        console.warn('Failed to hydrate widget session', err);
      });
    }
  }, []);

  return (
    <AuthProvider>
      <div className="w-full h-full">
        <ChatWidget />
      </div>
    </AuthProvider>
  );
}
