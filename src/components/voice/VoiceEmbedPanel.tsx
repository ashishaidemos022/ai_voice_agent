import { useEffect, useMemo, useState } from 'react';
import { Copy, Globe, RefreshCcw, Waves } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import { useVoiceEmbedConfig } from '../../hooks/useVoiceEmbedConfig';

interface VoiceEmbedPanelProps {
  agentConfigId: string | null | undefined;
  agentName?: string;
}

const VOICE_OPTIONS = [
  { value: 'alloy', label: 'Alloy', description: 'Balanced, confident' },
  { value: 'verse', label: 'Verse', description: 'Warm, upbeat' },
  { value: 'ember', label: 'Ember', description: 'Calm, low register' },
  { value: 'xelos', label: 'Xelos', description: 'Energetic, expressive' }
];

const ORIGIN_PLACEHOLDER = 'https://app.yourdomain.com';

export function VoiceEmbedPanel({ agentConfigId, agentName }: VoiceEmbedPanelProps) {
  const {
    embed,
    isLoading,
    isSaving,
    error,
    regenerateError,
    handleCreate,
    handleSave,
    handleRotate
  } = useVoiceEmbedConfig(agentConfigId || null);

  const [originsInput, setOriginsInput] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState('alloy');
  const isDisabled = !agentConfigId || isLoading;

  useEffect(() => {
    if (!embed) {
      setOriginsInput('');
      setSelectedVoice('alloy');
      return;
    }
    setOriginsInput(embed.allowed_origins.join(', '));
    setSelectedVoice(embed.tts_voice || 'alloy');
  }, [embed]);

  const host = typeof window !== 'undefined' ? window.location.origin : ORIGIN_PLACEHOLDER;

  const iframeSnippet = useMemo(() => {
    const slug = embed?.public_id || 'voice-public-id';
    return `<iframe
  src="${host.replace(/\/$/, '')}/embed/voice/${slug}"
  style="width: 100%; max-width: 420px; height: 640px; border-radius: 20px; border: none;"
  allow="microphone"
></iframe>`;
  }, [embed?.public_id, host]);

  const loaderSnippet = useMemo(() => {
    const slug = embed?.public_id || 'voice-public-id';
    return `<script
  src="${host.replace(/\/$/, '')}/voiceLoader.js"
  data-agent="${slug}"
  data-theme="dark"
  async
></script>`;
  }, [embed?.public_id, host]);

  const parsedOrigins = useMemo(() => {
    if (!originsInput.trim()) return [];
    return originsInput
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }, [originsInput]);

  const handleCopy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((prev) => (prev === key ? null : prev)), 2000);
    } catch (err) {
      console.warn('Copy failed', err);
    }
  };

  const saveOrigins = async () => {
    if (!embed) return;
    await handleSave({ allowedOrigins: parsedOrigins });
  };

  const saveVoice = async (voice: string) => {
    if (!embed) return;
    setSelectedVoice(voice);
    await handleSave({ ttsVoice: voice });
  };

  const toggleRtc = async () => {
    if (!embed) return;
    await handleSave({ rtcEnabled: !embed.rtc_enabled });
  };

  const toggleEnabled = async () => {
    if (!embed) return;
    await handleSave({ isEnabled: !embed.is_enabled });
  };

  return (
    <Card className="p-5 bg-slate-900/40 border-white/5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-white">Voice embed</p>
          <p className="text-xs text-white/50">Deploy {agentName || 'this preset'} as a live voice widget.</p>
        </div>
        <Waves className="w-5 h-5 text-cyan-200" />
      </div>

      {!agentConfigId && (
        <p className="text-sm text-white/50">Select an agent preset to configure voice embeds.</p>
      )}

      {agentConfigId && !embed && (
        <div className="rounded-2xl border border-dashed border-white/20 p-4 text-center space-y-3">
          <p className="text-sm text-white/60">Generate a public embed token to deploy this agent externally.</p>
          <Button size="sm" onClick={handleCreate} disabled={isSaving || isDisabled}>
            Create Voice Embed Token
          </Button>
          {error && <p className="text-xs text-rose-300">{error}</p>}
        </div>
      )}

      {embed && (
        <>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-white/40 uppercase tracking-[0.3em]">Public ID</p>
                <p className="text-sm font-mono text-white">{embed.public_id}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="w-9 h-9 rounded-full"
                  variant="ghost"
                  aria-label="Rotate public id"
                  onClick={handleRotate}
                  disabled={isSaving}
                >
                  <RefreshCcw className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  className="w-9 h-9 rounded-full"
                  variant="ghost"
                  aria-label="Copy public id"
                  onClick={() => handleCopy(embed.public_id, 'public_id')}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
            {regenerateError && (
              <p className="text-xs text-rose-300">{regenerateError}</p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={cn(
                  'px-2 py-0.5 rounded-full text-[11px] uppercase tracking-[0.25em]',
                  embed.is_enabled ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-200/40' : 'bg-white/5 text-white/50 border border-white/20'
                )}
              >
                {embed.is_enabled ? 'Enabled' : 'Disabled'}
              </span>
              <Button variant="ghost" size="xs" onClick={toggleEnabled} disabled={isSaving}>
                {embed.is_enabled ? 'Turn Off' : 'Turn On'}
              </Button>
              <span
                className={cn(
                  'px-2 py-0.5 rounded-full text-[11px] uppercase tracking-[0.25em]',
                  embed.rtc_enabled ? 'bg-cyan-500/10 text-cyan-100 border border-cyan-200/40' : 'bg-white/5 text-white/50 border border-white/20'
                )}
              >
                {embed.rtc_enabled ? 'RTC' : 'Fallback WS'}
              </span>
              <Button variant="ghost" size="xs" onClick={toggleRtc} disabled={isSaving}>
                {embed.rtc_enabled ? 'Force WebSocket' : 'Enable RTC'}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase text-white/40 tracking-[0.3em]">Allowed Origins</label>
            <textarea
              rows={2}
              value={originsInput}
              onChange={(e) => setOriginsInput(e.target.value)}
              placeholder="https://example.com, https://app.example.com"
              className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
            />
            <div className="flex items-center justify-between text-[11px] text-white/40">
              <span>Leave blank to allow all origins.</span>
              <Button size="xs" onClick={saveOrigins} disabled={isSaving}>
                Save Origins
              </Button>
            </div>
          </div>

          <div>
            <label className="text-xs uppercase text-white/40 tracking-[0.3em] mb-2 flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Voice
            </label>
            <select
              className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              value={selectedVoice}
              onChange={(e) => saveVoice(e.target.value)}
              disabled={isSaving}
            >
              {VOICE_OPTIONS.map((voice) => (
                <option key={voice.value} value={voice.value}>
                  {voice.label} – {voice.description}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-rose-300">{error}</p>}

          <div>
            <p className="text-xs uppercase text-white/40 tracking-[0.3em] mb-2">Iframe Embed</p>
            <CodeSnippet
              value={iframeSnippet}
              onCopy={() => handleCopy(iframeSnippet, 'voice_iframe')}
              copied={copied === 'voice_iframe'}
            />
          </div>

          <div>
            <p className="text-xs uppercase text-white/40 tracking-[0.3em] mb-2">Loader Script</p>
            <CodeSnippet
              value={loaderSnippet}
              onCopy={() => handleCopy(loaderSnippet, 'voice_loader')}
              copied={copied === 'voice_loader'}
            />
          </div>
        </>
      )}
    </Card>
  );
}

function CodeSnippet({
  value,
  copied,
  onCopy
}: {
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="relative">
      <pre className="rounded-2xl bg-black/40 border border-white/10 p-3 text-xs text-white/80 overflow-x-auto">
        {value}
      </pre>
      <Button size="sm" variant="ghost" className="absolute top-2 right-2 w-9 h-9 rounded-full" aria-label="Copy snippet" onClick={onCopy}>
        {copied ? <span className="text-[10px] font-semibold text-emerald-300">COPIED</span> : <Copy className="w-4 h-4" />}
      </Button>
    </div>
  );
}
