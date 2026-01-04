import { useEffect, useMemo, useState } from 'react';
import { Copy, Globe, RefreshCcw } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useAgentEmbed } from '../../hooks/useAgentEmbed';
import { cn } from '../../lib/utils';

interface AgentEmbedPanelProps {
  agentConfigId: string | null | undefined;
  agentName?: string;
}

const EMBED_HOST = import.meta.env.VITE_EMBED_HOST || 'https://embed-chat-agent.vercel.app';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export function AgentEmbedPanel({ agentConfigId, agentName }: AgentEmbedPanelProps) {
  const {
    embed,
    isLoading,
    isSaving,
    error,
    regenerateError,
    handleCreate,
    handleSave,
    handleRotate
  } = useAgentEmbed(agentConfigId || null);

  const [originsInput, setOriginsInput] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
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
  const [bubbleColor, setBubbleColor] = useState('');
  const [logoBackgroundColor, setLogoBackgroundColor] = useState('');
  const [widgetWidth, setWidgetWidth] = useState('360');
  const [widgetHeight, setWidgetHeight] = useState('520');
  const [buttonImageUrl, setButtonImageUrl] = useState('');
  const [overrideWidgetSettings, setOverrideWidgetSettings] = useState(false);
  const isDisabled = !agentConfigId || isLoading;

  useEffect(() => {
    if (!embed) {
      setOriginsInput('');
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
      setBubbleColor('');
      setLogoBackgroundColor('');
      setWidgetWidth('360');
      setWidgetHeight('520');
      setButtonImageUrl('');
      return;
    }
    setOriginsInput(embed.allowed_origins.join(', '));
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
    setBubbleColor(embed.bubble_color || '');
    setLogoBackgroundColor(embed.logo_background_color || '');
    setWidgetWidth(String(embed.widget_width ?? 360));
    setWidgetHeight(String(embed.widget_height ?? 520));
    setButtonImageUrl(embed.button_image_url || '');
  }, [embed]);

  const host = EMBED_HOST;

  const iframeSnippet = useMemo(() => {
    const slug = embed?.public_id || 'public-id';
    const widthValue = widgetWidth.trim() || '360';
    const heightValue = widgetHeight.trim() || '520';
    return `<iframe
  src="${host.replace(/\/$/, '')}/embed/agent/${slug}"
  style="width: 100%; max-width: ${widthValue}px; height: ${heightValue}px; border-radius: 16px; border: none;"
  allow="microphone"
></iframe>`;
  }, [embed?.public_id, host, widgetHeight, widgetWidth]);

  const widgetSnippet = useMemo(() => {
    const slug = embed?.public_id || 'public-id';
    const widthValue = widgetWidth.trim() || '360';
    const heightValue = widgetHeight.trim() || '520';
    const buttonImageValue = buttonImageUrl.trim();
    const supabaseConfig = SUPABASE_URL
      ? `\n    supabaseUrl: "${SUPABASE_URL.replace(/\/$/, '')}",${SUPABASE_ANON_KEY ? `\n    supabaseKey: "${SUPABASE_ANON_KEY}",` : ''}`
      : '';
    const overrideConfig = overrideWidgetSettings
      ? `\n    override: true,\n    width: "${widthValue}",\n    height: "${heightValue}",\n    buttonImage: "${buttonImageValue}",\n    buttonColor: "${buttonColor.trim() || ''}",\n    buttonTextColor: "${buttonTextColor.trim() || ''}",`
      : '';
    return `<script>
  window.MyVoiceAgent = { publicId: "${slug}",${supabaseConfig}${overrideConfig} };
  (function() {
    var s = document.createElement("script");
    s.src = "${host.replace(/\/$/, '')}/widget.js";
    s.async = true;
    document.head.appendChild(s);
  })();
</script>`;
  }, [buttonColor, buttonImageUrl, buttonTextColor, embed?.public_id, host, overrideWidgetSettings, widgetHeight, widgetWidth]);

  const handleCopy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((prev) => (prev === key ? null : prev)), 2000);
    } catch (err) {
      console.warn('Copy failed', err);
    }
  };

  const parsedOrigins = useMemo(() => {
    if (!originsInput.trim()) return [];
    return originsInput
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }, [originsInput]);

  const onSave = async () => {
    if (!embed) return;
    await handleSave({
      allowedOrigins: parsedOrigins,
      isEnabled: embed.is_enabled
    });
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
      logoBackgroundColor: logoBackgroundColor.trim() || null,
      cornerRadius: cornerRadius === '' ? null : Number(cornerRadius),
      fontFamily: fontFamily.trim() || null,
      bubbleColor: bubbleColor.trim() || null,
      widgetWidth: widgetWidth.trim() ? Number(widgetWidth) : null,
      widgetHeight: widgetHeight.trim() ? Number(widgetHeight) : null,
      buttonImageUrl: buttonImageUrl.trim() || null
    });
  };

  const onToggleEnabled = async () => {
    if (!embed) return;
    await handleSave({
      allowedOrigins: embed.allowed_origins,
      isEnabled: !embed.is_enabled
    });
  };

  return (
    <Card className="p-5 bg-slate-900/40 border-white/5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-white">Embed this agent</p>
          <p className="text-xs text-white/50">Share {agentName || 'the selected preset'} on any site.</p>
        </div>
        <Globe className="w-5 h-5 text-cyan-200" />
      </div>

      {!agentConfigId && (
        <p className="text-sm text-white/50">Select an agent preset to manage embeds.</p>
      )}

      {agentConfigId && !embed && (
        <div className="rounded-2xl border border-dashed border-white/20 p-4 text-center space-y-3">
          <p className="text-sm text-white/60">Generate a public embed token to deploy this agent externally.</p>
          <Button size="sm" onClick={handleCreate} disabled={isSaving || isDisabled}>
            Create Embed Token
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
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'px-2 py-0.5 rounded-full text-[11px] uppercase tracking-[0.25em]',
                  embed.is_enabled ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-200/40' : 'bg-white/5 text-white/50 border border-white/20'
                )}
              >
                {embed.is_enabled ? 'Enabled' : 'Disabled'}
              </span>
              <Button
                variant="ghost"
                size="xs"
                onClick={onToggleEnabled}
                disabled={isSaving}
              >
                {embed.is_enabled ? 'Turn Off' : 'Turn On'}
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
              <Button size="xs" onClick={onSave} disabled={isSaving}>
                Save Origins
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs uppercase text-white/40 tracking-[0.3em]">Appearance</p>
            <div className="grid gap-3">
              <label className="text-xs text-white/50">Brand name</label>
              <input
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="Acme Support"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
              <label className="text-xs text-white/50">Logo URL</label>
              <input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://cdn.example.com/logo.png"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
              <label className="text-xs text-white/50">Logo background color</label>
              <input
                value={logoBackgroundColor}
                onChange={(e) => setLogoBackgroundColor(e.target.value)}
                placeholder="#111827"
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
                placeholder="16"
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
              <label className="text-xs text-white/50">Bubble color</label>
              <input
                value={bubbleColor}
                onChange={(e) => setBubbleColor(e.target.value)}
                placeholder="#111827"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
            </div>
            <Button size="xs" onClick={saveAppearance} disabled={isSaving}>
              Save Appearance
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase text-white/40 tracking-[0.3em]">Widget Size</p>
            <div className="grid gap-3">
              <label className="text-xs text-white/50">Width (px)</label>
              <input
                value={widgetWidth}
                onChange={(e) => setWidgetWidth(e.target.value)}
                placeholder="360"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
              <label className="text-xs text-white/50">Height (px)</label>
              <input
                value={widgetHeight}
                onChange={(e) => setWidgetHeight(e.target.value)}
                placeholder="520"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
              />
            </div>
            <label className="text-xs text-white/50 flex items-center gap-2">
              <input
                type="checkbox"
                checked={overrideWidgetSettings}
                onChange={(e) => setOverrideWidgetSettings(e.target.checked)}
                className="h-4 w-4 rounded border-white/30 bg-white/5 text-cyan-300 focus:ring-cyan-300/40"
              />
              Override widget snippet size/button image (iframe always uses saved size)
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase text-white/40 tracking-[0.3em]">Chat Button Image</p>
            <input
              value={buttonImageUrl}
              onChange={(e) => setButtonImageUrl(e.target.value)}
              placeholder="https://cdn.example.com/chat-icon.png"
              className="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
            />
          </div>

          {error && <p className="text-xs text-rose-300">{error}</p>}

          <div>
            <p className="text-xs uppercase text-white/40 tracking-[0.3em] mb-2">Iframe Embed</p>
            <CodeSnippet
              value={iframeSnippet}
              onCopy={() => handleCopy(iframeSnippet, 'iframe')}
              copied={copied === 'iframe'}
            />
          </div>

          <div>
            <p className="text-xs uppercase text-white/40 tracking-[0.3em] mb-2">Floating Widget</p>
            <CodeSnippet
              value={widgetSnippet}
              onCopy={() => handleCopy(widgetSnippet, 'widget')}
              copied={copied === 'widget'}
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
