import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { History, Clock, MessageCircle, Calendar, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Badge } from '../ui/Badge';

interface Session {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  message_count: number;
  duration_seconds: number;
}

interface SessionHistoryProps {
  onSessionSelect: (sessionId: string) => void;
  selectedSessionId?: string;
  currentSessionId?: string | null;
}

export function SessionHistory({ onSessionSelect, selectedSessionId, currentSessionId }: SessionHistoryProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const lastClickedRef = useRef<{ sessionId: string; timestamp: number } | null>(null);

  useEffect(() => {
    loadSessions();
  }, [currentSessionId]);

  useEffect(() => {
    if (selectedSessionId) {
      setLoadingSessionId(null);
    }
  }, [selectedSessionId]);

  const loadSessions = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('va_sessions')
        .select('id, created_at, updated_at, status, message_count, duration_seconds')
        .eq('status', 'ended')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('Failed to load sessions:', error);
        return;
      }

      setSessions(data || []);
    } catch (error) {
      console.error('Error loading sessions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  if (isLoading) {
    return (
      <div className="px-6 py-4">
        <div className="text-sm text-gray-500 text-center">Loading history...</div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="px-6 py-8">
        <div className="text-center">
          <History className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No session history yet</p>
          <p className="text-xs text-gray-400 mt-1">Past sessions will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
            Session History
          </span>
          <Badge variant="secondary">{sessions.length}</Badge>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-1 p-2">
          {sessions.map((session) => (
            <motion.button
              key={session.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => {
                const now = Date.now();
                const lastClick = lastClickedRef.current;

                if (lastClick && lastClick.sessionId === session.id && now - lastClick.timestamp < 1000) {
                  console.log('⏱️ Ignoring duplicate click (debounced)');
                  return;
                }

                if (loadingSessionId) {
                  console.log('⏱️ Already loading a session, ignoring click');
                  return;
                }

                lastClickedRef.current = { sessionId: session.id, timestamp: now };

                console.log('👆 Session clicked:', {
                  sessionId: session.id,
                  messageCount: session.message_count,
                  status: session.status,
                  createdAt: session.created_at
                });
                setLoadingSessionId(session.id);
                onSessionSelect(session.id);
              }}
              disabled={loadingSessionId === session.id || loadingSessionId !== null}
              className={`w-full text-left px-4 py-3 rounded-lg transition-all disabled:opacity-60 ${
                selectedSessionId === session.id
                  ? 'bg-blue-50 border border-blue-200'
                  : 'hover:bg-gray-50 border border-transparent'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs text-gray-600 font-medium">
                    {formatDate(session.created_at)}
                  </span>
                </div>
                {loadingSessionId === session.id ? (
                  <div className="flex items-center gap-1">
                    <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
                    <span className="text-xs text-blue-600">Loading...</span>
                  </div>
                ) : selectedSessionId === session.id ? (
                  <Badge variant="default" className="text-xs">Viewing</Badge>
                ) : null}
              </div>

              <div className="flex items-center gap-3 text-xs text-gray-500">
                <div className="flex items-center gap-1">
                  <MessageCircle className="w-3 h-3" />
                  <span>{session.message_count || 0}</span>
                </div>
                {session.duration_seconds > 0 && (
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{formatDuration(session.duration_seconds)}</span>
                  </div>
                )}
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
