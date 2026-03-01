import { useEffect, useMemo, useState } from 'react';
import { Copy, Globe, RefreshCcw, Waves } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import { useVoiceEmbedConfig } from '../../hooks/useVoiceEmbedConfig';
import { getConfigPresetById, type AgentConfigPreset } from '../../lib/config-service';

interface VoiceEmbedPanelProps {
  agentConfigId: string | null | undefined;
  agentName?: string;
}

const OPENAI_VOICE_OPTIONS: { value: string; label: string }[] = [
  { value: 'alloy', label: 'Alloy' },
  { value: 'ash', label: 'Ash' },
  { value: 'ballad', label: 'Ballad' },
  { value: 'coral', label: 'Coral' },
  { value: 'echo', label: 'Echo' },
  { value: 'sage', label: 'Sage' },
  { value: 'shimmer', label: 'Shimmer' },
  { value: 'verse', label: 'Verse' },
  { value: 'marin', label: 'Marin' },
  { value: 'cedar', label: 'Cedar' }
];

const EMBED_HOST = import.meta.env.VITE_EMBED_HOST || 'https://embed-chat-agent.vercel.app';
const EMBED_API_BASE = import.meta.env.VITE_EMBED_API_BASE_URL || import.meta.env.VITE_SUPABASE_URL;
const EMBED_USAGE_BASE = import.meta.env.VITE_EMBED_USAGE_BASE_URL || import.meta.env.VITE_SUPABASE_URL;

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
  const [agentPreset, setAgentPreset] = useState<AgentConfigPreset | null>(null);
  const [isLoadingPreset, setIsLoadingPreset] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [overrideVoice, setOverrideVoice] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState('alloy');
  const [logoUrl, setLogoUrl] = useState('');
  const [brandName, setBrandName] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [backgroundColor, setBackgroundColor] = useState('');
  const [surfaceColor, setSurfaceColor] = useState('');
  const [textColor, setTextColor] = useState('');
  const [buttonColor, setButtonColor] = useState('');
  const [buttonTextColor, setButtonTextColor] = useState('');
  const [helperTextColor, setHelperTextColor] = useState('');
  const [cornerRadius, setCornerRadius] = useState<number | ''>('');
  const [fontFamily, setFontFamily] = useState('');
  const [waveColor, setWaveColor] = useState('');
  const [bubbleColor, setBubbleColor] = useState('');
  const [widgetWidth, setWidgetWidth] = useState('500');
  const [widgetHeight, setWidgetHeight] = useState('760');
  const [buttonImageUrl, setButtonImageUrl] = useState('');
  const [overrideLoaderSettings, setOverrideLoaderSettings] = useState(false);
  const isDisabled = !agentConfigId || isLoading;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!agentConfigId) {
        setAgentPreset(null);
        setPresetError(null);
        return;
      }
      setIsLoadingPreset(true);
      setPresetError(null);
      try {
        const preset = await getConfigPresetById(agentConfigId);
        if (cancelled) return;
        setAgentPreset(preset);
      } catch (err: any) {
        if (cancelled) return;
        setAgentPreset(null);
        setPresetError(err?.message || 'Failed to load agent preset');
      } finally {
        if (!cancelled) setIsLoadingPreset(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [agentConfigId]);

  const voiceProvider = (agentPreset?.voice_provider ?? 'openai_realtime') as
    | 'openai_realtime'
    | 'personaplex'
    | 'elevenlabs_tts';
  const canOverrideOpenAIVoice = voiceProvider === 'openai_realtime';
  const agentVoiceLabel = useMemo(() => {
    if (!agentPreset) return null;
    if (voiceProvider === 'openai_realtime') return agentPreset.voice || 'alloy';
    return agentPreset.voice_id || null;
  }, [agentPreset, voiceProvider]);

  useEffect(() => {
    if (!embed) {
      setOriginsInput('');
      setOverrideVoice(false);
      setSelectedVoice(agentPreset?.voice || 'alloy');
      setLogoUrl('');
      setBrandName('');
      setAccentColor('');
      setBackgroundColor('');
      setSurfaceColor('');
      setTextColor('');
      setButtonColor('');
      setButtonTextColor('');
      setHelperTextColor('');
      setCornerRadius('');
      setFontFamily('');
      setWaveColor('');
      setBubbleColor('');
      setWidgetWidth('500');
      setWidgetHeight('760');
      setButtonImageUrl('');
      return;
    }
    setOriginsInput(embed.allowed_origins.join(', '));
    const nextOverride = Boolean(embed.tts_voice);
    setOverrideVoice(nextOverride);
    setSelectedVoice(nextOverride ? (embed.tts_voice as string) : (agentPreset?.voice || 'alloy'));
    setLogoUrl(embed.logo_url || '');
    setBrandName(embed.brand_name || '');
    setAccentColor(embed.accent_color || '');
    setBackgroundColor(embed.background_color || '');
    setSurfaceColor(embed.surface_color || '');
    setTextColor(embed.text_color || '');
    setButtonColor(embed.button_color || '');
    setButtonTextColor(embed.button_text_color || '');
    setHelperTextColor(embed.helper_text_color || '');
    setCornerRadius(embed.corner_radius ?? '');
    setFontFamily(embed.font_family || '');
    setWaveColor(embed.wave_color || '');
    setBubbleColor(embed.bubble_color || '');
    setWidgetWidth(String(embed.widget_width ?? 500));
    setWidgetHeight(String(embed.widget_height ?? 760));
    setButtonImageUrl(embed.button_image_url || '');
  }, [embed, agentPreset?.voice]);

  const host = EMBED_HOST;

  const iframeSnippet = useMemo(() => {
    const slug = embed?.public_id || 'voice-public-id';
    const widthValue = widgetWidth.trim() || '420';
    const heightValue = widgetHeight.trim() || '640';
    const styleValue = `width: 100%; max-width: ${widthValue}px; height: ${heightValue}px; border-radius: 20px; border: none;`;
    return `<iframe
  src="${host.replace(/\/$/, '')}/embed/voice/${slug}"
  style="${styleValue}"
  allow="microphone"
></iframe>`;
  }, [embed?.public_id, host, widgetHeight, widgetWidth]);

  const loaderSnippet = useMemo(() => {
    const slug = embed?.public_id || 'voice-public-id';
    const widthValue = widgetWidth.trim() || '500';
    const heightValue = widgetHeight.trim() || '760';
    const buttonImageAttr = buttonImageUrl.trim() ? `\n  data-button-image="${buttonImageUrl.trim()}"` : '';
    const sizeAttrs = overrideLoaderSettings
      ? `\n  data-override="1"\n  data-width="${widthValue}"\n  data-height="${heightValue}"${buttonImageAttr}`
      : '';
    const apiBaseAttr = EMBED_API_BASE
      ? `\n  data-api-base="${EMBED_API_BASE.replace(/\/$/, '')}"`
      : '';
    const usageBaseAttr = EMBED_USAGE_BASE
      ? `\n  data-usage-base="${EMBED_USAGE_BASE.replace(/\/$/, '')}"`
      : '';
    return `<script
  src="${host.replace(/\/$/, '')}/voiceLoader.js"
  data-public-id="${slug}"
  data-theme="dark"${apiBaseAttr}${usageBaseAttr}${sizeAttrs}
  async
></script>`;
  }, [buttonImageUrl, embed?.public_id, host, overrideLoaderSettings, widgetHeight, widgetWidth, EMBED_USAGE_BASE]);

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

  const saveVoiceOverrideState = async (nextOverride: boolean) => {
    if (!embed) return;
    setOverrideVoice(nextOverride);
    if (!nextOverride) {
      await handleSave({ ttsVoice: null });
      return;
    }
    await handleSave({ ttsVoice: selectedVoice || agentPreset?.voice || 'alloy' });
  };

  const saveOpenAiVoiceOverride = async (voice: string) => {
    if (!embed) return;
    setSelectedVoice(voice);
    if (!overrideVoice) return;
    await handleSave({ ttsVoice: voice });
  };

  const saveAppearance = async () => {
    if (!embed) return;
    await handleSave({
      logoUrl: logoUrl.trim() || null,
      brandName: brandName.trim() || null,
      accentColor: accentColor.trim() || null,
      backgroundColor: backgroundColor.trim() || null,
      surfaceColor: surfaceColor.trim() || null,
      textColor: textColor.trim() || null,
      buttonColor: buttonColor.trim() || null,
      buttonTextColor: buttonTextColor.trim() || null,
      helperTextColor: helperTextColor.trim() || null,
      cornerRadius: cornerRadius === '' ? null : Number(cornerRadius),
      fontFamily: fontFamily.trim() || null,
      waveColor: waveColor.trim() || null,
      bubbleColor: bubbleColor.trim() || null,
      widgetWidth: widgetWidth.trim() ? Number(widgetWidth) : null,
      widgetHeight: widgetHeight.trim() ? Number(widgetHeight) : null,
      buttonImageUrl: buttonImageUrl.trim() || null
    });
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
    <Card className="p-5 bg-black border-white/5 flex flex-col gap-4">
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

          <div className="space-y-2">
            <p className="text-xs uppercase text-white/40 tracking-[0.3em]">Embed Size</p>
            <div className="grid gap-3">
              <label className="text-xs text-white/50">Width (px)</label>
              <input
                value={widgetWidth}
                onChange={(e) => setWidgetWidth(e.target.value)}
                placeholder="500"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
              <label className="text-xs text-white/50">Height (px)</label>
              <input
                value={widgetHeight}
                onChange={(e) => setWidgetHeight(e.target.value)}
                placeholder="760"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
            </div>
            <label className="text-xs text-white/50 flex items-center gap-2">
              <input
                type="checkbox"
                checked={overrideLoaderSettings}
                onChange={(e) => setOverrideLoaderSettings(e.target.checked)}
                className="h-4 w-4 rounded border-white/30 bg-white/5 text-cyan-300 focus:ring-cyan-300/40"
              />
              Override loader snippet size/button image (iframe always uses saved size)
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase text-white/40 tracking-[0.3em]">Voice Button Image</p>
            <input
              value={buttonImageUrl}
              onChange={(e) => setButtonImageUrl(e.target.value)}
              placeholder="https://cdn.example.com/voice-icon.png"
              className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
            />
          </div>

          <div>
            <label className="text-xs uppercase text-white/40 tracking-[0.3em] mb-2 flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Voice
            </label>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-white/80">
                  <span className="text-white/50">Provider:</span>{' '}
                  <span className="font-semibold">
                    {voiceProvider === 'openai_realtime'
                      ? 'OpenAI (Realtime)'
                      : voiceProvider === 'elevenlabs_tts'
                        ? 'ElevenLabs'
                        : 'PersonaPlex'}
                  </span>
                </div>
                {isLoadingPreset && <span className="text-xs text-white/40">Loading preset…</span>}
              </div>

              {presetError && <p className="text-xs text-rose-300">{presetError}</p>}

              {voiceProvider !== 'openai_realtime' && (
                <div className="space-y-1">
                  <p className="text-xs text-white/50">
                    This embed follows the agent preset voice selection.
                  </p>
                  <p className="text-sm font-mono text-white">
                    {voiceProvider === 'elevenlabs_tts' ? 'voice_id' : 'persona_voice_id'}:{' '}
                    {agentVoiceLabel || 'Missing'}
                  </p>
                  {!agentVoiceLabel && (
                    <p className="text-xs text-rose-300">
                      Missing voice id on the preset. Configure voice selection in Agent Settings.
                    </p>
                  )}
                </div>
              )}

              {voiceProvider === 'openai_realtime' && (
                <div className="space-y-2">
                  <p className="text-xs text-white/50">
                    Agent preset voice: <span className="font-mono text-white">{agentPreset?.voice || 'alloy'}</span>
                  </p>

                  <label className="text-xs text-white/70 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={overrideVoice}
                      onChange={(e) => saveVoiceOverrideState(e.target.checked)}
                      disabled={!canOverrideOpenAIVoice || isSaving}
                      className="h-4 w-4 rounded border-white/30 bg-white/5 text-cyan-300 focus:ring-cyan-300/40"
                    />
                    Override voice for this embed
                  </label>

                  <select
                    className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/40 disabled:opacity-60"
                    value={selectedVoice}
                    onChange={(e) => saveOpenAiVoiceOverride(e.target.value)}
                    disabled={isSaving || !overrideVoice}
                  >
                    {OPENAI_VOICE_OPTIONS.map((voice) => (
                      <option key={voice.value} value={voice.value}>
                        {voice.label}
                      </option>
                    ))}
                  </select>

                  {!overrideVoice && (
                    <p className="text-xs text-white/50">
                      Using the agent preset voice. Enable override to pick a different OpenAI voice for embeds only.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs uppercase text-white/40 tracking-[0.3em]">Appearance</p>
            <div className="grid gap-3">
              <label className="text-xs text-white/50">Brand name</label>
              <input
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="Acme Voice"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
              <label className="text-xs text-white/50">Logo URL</label>
              <input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://cdn.example.com/logo.png"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
              <label className="text-xs text-white/50">Font family</label>
              <input
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                placeholder="Söhne, ui-sans-serif"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
              <label className="text-xs text-white/50">Corner radius (px)</label>
              <input
                type="number"
                min="0"
                value={cornerRadius}
                onChange={(e) => setCornerRadius(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="24"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
            </div>
            <div className="grid gap-3">
              <label className="text-xs text-white/50">Accent color</label>
              <input
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                placeholder="#6366f1"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
              <label className="text-xs text-white/50">Background color</label>
              <input
                value={backgroundColor}
                onChange={(e) => setBackgroundColor(e.target.value)}
                placeholder="#0f172a"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
              <label className="text-xs text-white/50">Surface color</label>
              <input
                value={surfaceColor}
                onChange={(e) => setSurfaceColor(e.target.value)}
                placeholder="#111827"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
              <label className="text-xs text-white/50">Text color</label>
              <input
                value={textColor}
                onChange={(e) => setTextColor(e.target.value)}
                placeholder="#f8fafc"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
              <label className="text-xs text-white/50">Button color</label>
              <input
                value={buttonColor}
                onChange={(e) => setButtonColor(e.target.value)}
                placeholder="#06b6d4"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
              <label className="text-xs text-white/50">Button text color</label>
              <input
                value={buttonTextColor}
                onChange={(e) => setButtonTextColor(e.target.value)}
                placeholder="#0f172a"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
              <label className="text-xs text-white/50">Helper text color</label>
              <input
                value={helperTextColor}
                onChange={(e) => setHelperTextColor(e.target.value)}
                placeholder="#94a3b8"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
              <label className="text-xs text-white/50">Wave color</label>
              <input
                value={waveColor}
                onChange={(e) => setWaveColor(e.target.value)}
                placeholder="#38bdf8"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
              <label className="text-xs text-white/50">Bubble color</label>
              <input
                value={bubbleColor}
                onChange={(e) => setBubbleColor(e.target.value)}
                placeholder="#1f2937"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
            </div>
            <Button size="xs" onClick={saveAppearance} disabled={isSaving}>
              Save Appearance
            </Button>
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
