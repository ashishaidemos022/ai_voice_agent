import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export function VoiceAudioUsage({ sessionId, refresh }: { sessionId?: string; refresh?: string }) {
  const [summary, setSummary] = useState('');
  useEffect(() => {
    let active = true;
    setSummary('');
    if (!sessionId) return;
    void (async () => {
      const { data, error } = await supabase.from('va_voice_audio_events')
        .select('operation,estimated_cost_usd').eq('session_id', sessionId).order('created_at').limit(1000);
      if (!active) return;
      if (error) { setSummary('Audio usage unavailable.'); return; }
      const rows = data || [];
      const transcription = rows.filter(row => row.operation === 'transcribe').length;
      const unknown = rows.filter(row => row.estimated_cost_usd == null).length;
      const cost = rows.reduce((sum, row) => sum + Number(row.estimated_cost_usd || 0), 0);
      setSummary(`${transcription} recordings · ${rows.length - transcription} speech segments · estimated audio cost ${unknown ? 'at least ' : ''}$${cost.toFixed(5)}${unknown ? ` (${unknown} unpriced)` : ''}${rows.length === 1000 ? ' · first 1,000 requests' : ''}`);
    })();
    return () => { active = false; };
  }, [sessionId, refresh]);
  return summary ? <p className="text-[11px] text-white/50">{summary}</p> : null;
}
