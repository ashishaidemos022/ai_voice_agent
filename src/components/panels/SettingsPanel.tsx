import { useEffect, useState } from 'react';
import type { PostgrestError } from '@supabase/supabase-js';
import {
  BadgeCheck,
  Copy,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
  Workflow
} from 'lucide-react';
import { RealtimeConfig } from '../../types/voice-agent';
import {
  AgentConfigPreset,
  configPresetToRealtimeConfig,
  deleteConfigPreset,
  getAllConfigPresets,
  realtimeConfigToPreset,
  saveConfigPreset,
  updateConfigPreset
} from '../../lib/config-service';
import { inviteUserByEmail } from '../../lib/invite-service';
import { supabase } from '../../lib/supabase';
import { RightPanel } from '../layout/RightPanel';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { ToolSelectionPanel } from '../settings/ToolSelectionPanel';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  config: RealtimeConfig;
  onConfigChange: (config: RealtimeConfig) => void;
  activeConfigId: string | null;
  onActiveConfigChange: (configId: string | null) => void;
  userId: string;
  providerKeyId: string | null;
  onPresetsRefresh?: () => Promise<void> | void;
  onToolsChanged?: () => Promise<void> | void;
  onProfileRefresh?: () => Promise<void> | void;
  embedded?: boolean;
  onBack?: () => void;
}

const DEFAULT_INSTRUCTIONS =
  'You are a helpful AI voice assistant. You can help users with various tasks, answer questions, and execute tools when needed. Be conversational and friendly.';

// Voice options (OpenAI supported). Premium voices are labeled.
const VOICE_OPTIONS = [
  { value: 'alloy', label: 'Alloy', description: 'Balanced, default choice' },
  { value: 'verse', label: 'Verse', description: 'Expressive and dynamic' },
  { value: 'shimmer', label: 'Shimmer', description: 'Warm and gentle' },
  { value: 'echo', label: 'Echo', description: 'Clear and energetic' },
  { value: 'ash', label: 'Ash (premium)', description: 'Premium: crisp and modern' },
  { value: 'ballad', label: 'Ballad (premium)', description: 'Premium: narrative, steady cadence' },
  { value: 'coral', label: 'Coral (premium)', description: 'Premium: bright, approachable' },
  { value: 'sage', label: 'Sage (premium)', description: 'Premium: calm and measured' },
  { value: 'marin', label: 'Marin (premium)', description: 'Premium: smooth, contemporary' },
  { value: 'cedar', label: 'Cedar (premium)', description: 'Premium: warm and grounded' }
];

const VOICE_PROVIDERS = [
  {
    value: 'openai_realtime',
    label: 'OpenAI Realtime',
    description: 'Low-latency realtime voice with tool calling.'
  },
  {
    value: 'personaplex',
    label: 'NVIDIA PersonaPlex',
    description: 'Full-duplex speech-to-speech at 24kHz (hosted endpoint required).'
  }
];

const PERSONAPLEX_VOICE_OPTIONS = [
  { value: 'NATF0', label: 'NATF0', description: 'Natural female 0' },
  { value: 'NATF1', label: 'NATF1', description: 'Natural female 1' },
  { value: 'NATF2', label: 'NATF2', description: 'Natural female 2' },
  { value: 'NATF3', label: 'NATF3', description: 'Natural female 3' },
  { value: 'NATM0', label: 'NATM0', description: 'Natural male 0' },
  { value: 'NATM1', label: 'NATM1', description: 'Natural male 1' },
  { value: 'NATM2', label: 'NATM2', description: 'Natural male 2' },
  { value: 'NATM3', label: 'NATM3', description: 'Natural male 3' },
  { value: 'VARF0', label: 'VARF0', description: 'Varied female 0' },
  { value: 'VARF1', label: 'VARF1', description: 'Varied female 1' },
  { value: 'VARF2', label: 'VARF2', description: 'Varied female 2' },
  { value: 'VARF3', label: 'VARF3', description: 'Varied female 3' },
  { value: 'VARF4', label: 'VARF4', description: 'Varied female 4' },
  { value: 'VARM0', label: 'VARM0', description: 'Varied male 0' },
  { value: 'VARM1', label: 'VARM1', description: 'Varied male 1' },
  { value: 'VARM2', label: 'VARM2', description: 'Varied male 2' },
  { value: 'VARM3', label: 'VARM3', description: 'Varied male 3' },
  { value: 'VARM4', label: 'VARM4', description: 'Varied male 4' }
];

const BASE_DEFAULT_CONFIG: RealtimeConfig = {
  model: 'gpt-realtime',
  voice: 'alloy',
  voice_provider: 'openai_realtime',
  voice_persona_prompt: null,
  voice_id: null,
  voice_sample_rate_hz: null,
  a2ui_enabled: false,
  instructions: DEFAULT_INSTRUCTIONS,
  temperature: 0.8,
  max_response_output_tokens: 4096,
  turn_detection: {
    type: 'server_vad',
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: 500
  }
};

export function SettingsPanel({
  isOpen,
  onClose,
  config,
  onConfigChange,
  activeConfigId,
  onActiveConfigChange,
  userId,
  providerKeyId,
  onPresetsRefresh,
  onToolsChanged,
  onProfileRefresh,
  embedded = false,
  onBack
}: SettingsPanelProps) {
  const [presets, setPresets] = useState<AgentConfigPreset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [localProviderKeyId, setLocalProviderKeyId] = useState<string | null>(providerKeyId);
  const [keyAlias, setKeyAlias] = useState('Primary');
  const [apiKey, setApiKey] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySuccessMessage, setKeySuccessMessage] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccessMessage, setInviteSuccessMessage] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const activePreset = presets.find((p) => p.id === activeConfigId);
  const effectiveProviderKeyId = localProviderKeyId ?? providerKeyId;
  const resolvedProvider = config.voice_provider ?? 'openai_realtime';
  const isPersonaPlex = resolvedProvider === 'personaplex';

  useEffect(() => {
    if (embedded || isOpen) {
      void loadPresets();
    }
  }, [embedded, isOpen]);

  useEffect(() => {
    setLocalProviderKeyId(providerKeyId);
  }, [providerKeyId]);

  useEffect(() => {
    if (activeConfigId && activePreset) {
      const presetConfig = configPresetToRealtimeConfig(activePreset);
      setHasUnsavedChanges(JSON.stringify(presetConfig) !== JSON.stringify(config));
    } else {
      setHasUnsavedChanges(false);
    }
  }, [config, activeConfigId, activePreset]);

  const loadPresets = async () => {
    setIsLoading(true);
    try {
      const data = await getAllConfigPresets();
      setPresets(data);
    } catch (error) {
      console.error('Failed to load presets:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePresetSelect = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    const newConfig = configPresetToRealtimeConfig(preset);
    onConfigChange(newConfig);
    onActiveConfigChange(presetId);
    setHasUnsavedChanges(false);
  };

  const handleSaveNewPreset = async () => {
    if (!newPresetName.trim()) {
      setSaveError('Please enter a preset name');
      return;
    }
    if (!effectiveProviderKeyId && !isPersonaPlex) {
      setSaveError('Add an OpenAI API key before saving presets.');
      return;
    }

    setIsLoading(true);
    setSaveError(null);
    try {
      const isFirstPreset = presets.length === 0;
      const presetData = {
        ...realtimeConfigToPreset(config, newPresetName.trim()),
        is_default: isFirstPreset
      };
      const savedPreset = await saveConfigPreset(presetData, userId, effectiveProviderKeyId ?? undefined);
      if (isFirstPreset) {
        const { error: profileError } = await supabase
          .from('va_users')
          .update({
            onboarding_state: 'ready',
            default_agent_id: savedPreset.id
          })
          .eq('id', userId);
        if (profileError) {
          throw profileError;
        }
        await onProfileRefresh?.();
      }
      await loadPresets();
      await onPresetsRefresh?.();
      onActiveConfigChange(savedPreset.id);
      setShowSaveDialog(false);
      setNewPresetName('');
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('Failed to save preset:', error);
      setSaveError('Failed to save preset. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveProviderKey = async () => {
    if (!apiKey.trim()) {
      setKeyError('Please provide your OpenAI API key');
      return;
    }

    setIsSavingKey(true);
    setKeyError(null);
    setKeySuccessMessage(null);

    const isConflict = (dbError?: Pick<PostgrestError, 'code'> | null) => dbError?.code === '23505';

    try {
      const masked = apiKey.trim();
      const encoded = btoa(masked);
      const lastFour = masked.slice(-4);

      const insertPayload = {
        user_id: userId,
        provider: 'openai',
        key_alias: keyAlias || 'Primary',
        encrypted_key: encoded,
        last_four: lastFour
      };

      const { error: insertError } = await supabase.from('va_provider_keys').insert(insertPayload);

      if (insertError) {
        if (isConflict(insertError)) {
          const updatePayload = {
            provider: 'openai',
            key_alias: keyAlias || 'Primary',
            encrypted_key: encoded,
            last_four: lastFour
          };
          const { error: updateError } = await supabase
            .from('va_provider_keys')
            .update(updatePayload)
            .eq('user_id', userId)
            .eq('provider', 'openai')
            .eq('key_alias', keyAlias || 'Primary');

          if (updateError) {
            throw updateError;
          }
        } else {
          throw insertError;
        }
      }

      const { data: providerKeyRow, error: providerKeyError } = await supabase
        .from('va_provider_keys')
        .select('id')
        .eq('user_id', userId)
        .eq('provider', 'openai')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (providerKeyError) {
        throw providerKeyError;
      }

      setLocalProviderKeyId(providerKeyRow.id);
      setApiKey('');
      setKeySuccessMessage('Key saved. You can finish creating your agent.');
      await onProfileRefresh?.();
    } catch (error: any) {
      console.error('Failed to save provider key:', error);
      if (isConflict(error)) {
        setKeyError('A key with this label already exists. Update it by saving again.');
      } else {
        setKeyError(error.message || 'Failed to save key');
      }
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      setInviteError('Please enter an email address.');
      return;
    }
    setIsInviting(true);
    setInviteError(null);
    setInviteSuccessMessage(null);
    try {
      await inviteUserByEmail(inviteEmail);
      setInviteSuccessMessage(`Invitation sent to ${inviteEmail.trim()}.`);
      setInviteEmail('');
    } catch (error: any) {
      console.error('Failed to send invite:', error);
      setInviteError(error.message || 'Failed to send invite.');
    } finally {
      setIsInviting(false);
    }
  };

  const handleDuplicate = () => {
    const fallbackName = activePreset?.name ? `${activePreset.name} Copy` : 'New Agent Copy';
    setNewPresetName(fallbackName);
    setShowSaveDialog(true);
    setSaveError(null);
  };

  const handleUpdateCurrentPreset = async () => {
    if (!activeConfigId) return;
    setIsLoading(true);
    try {
      const name = presets.find((p) => p.id === activeConfigId)?.name || 'Unnamed';
      const updates = realtimeConfigToPreset(config, name);
      await updateConfigPreset(activeConfigId, updates);
      await loadPresets();
      await onPresetsRefresh?.();
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('Failed to update preset:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    if (!confirm('Are you sure you want to delete this preset?')) return;
    setIsLoading(true);
    try {
      await deleteConfigPreset(presetId);
      if (activeConfigId === presetId) {
        onActiveConfigChange(null);
      }
      await loadPresets();
      await onPresetsRefresh?.();
    } catch (error) {
      console.error('Failed to delete preset:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetToDefault = () => {
    onConfigChange({ ...config, instructions: DEFAULT_INSTRUCTIONS });
  };

  const characterCount = config.instructions.length;

  const content = (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-white/10 bg-slate-950/60 backdrop-blur flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/50">
            <Sparkles className="w-4 h-4" />
            <span>Agent preset</span>
          </div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-white font-display">{activePreset?.name || 'New agent preset'}</h2>
            {activePreset?.is_default && <Badge variant="secondary">Default</Badge>}
            {hasUnsavedChanges && <Badge variant="warning">Unsaved</Badge>}
          </div>
          <p className="text-sm text-white/60">
            Configure persona, response style, voice, and automations. Changes apply after you save.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {embedded && onBack && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="text-white/70 hover:text-cyan-100 hover:bg-white/5"
            >
              Back to workspace
            </Button>
          )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
              onActiveConfigChange(null);
              onConfigChange(BASE_DEFAULT_CONFIG);
              setShowSaveDialog(true);
              setNewPresetName('');
              setSaveError(null);
              setHasUnsavedChanges(true);
              }}
              disabled={isLoading}
              className="border-white/15 bg-transparent text-white/80 hover:border-cyan-300/60 hover:text-cyan-100 hover:bg-white/5"
            >
              <Plus className="w-3 h-3" />
              New preset
            </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDuplicate}
            disabled={isLoading || !activePreset}
            className="text-white/70 hover:text-cyan-100 hover:bg-white/5"
          >
            <Copy className="w-3 h-3" />
            Duplicate preset
          </Button>
          <Button
            size="sm"
            onClick={handleUpdateCurrentPreset}
            disabled={isLoading || !activeConfigId || !hasUnsavedChanges}
            className="bg-[#90E5E6] text-slate-950 hover:brightness-105 shadow-[0_10px_30px_rgba(144,229,230,0.35)]"
          >
            <Save className="w-3 h-3" />
            Save changes
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {!effectiveProviderKeyId && (
            <Card className="border-amber-400/30 bg-amber-500/5 shadow-[0_12px_40px_rgba(3,6,15,0.4)]">
              <CardHeader className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-200 flex items-center justify-center border border-amber-400/30">
                    <BadgeCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs uppercase text-amber-200/70 tracking-[0.2em]">Required</p>
                    <h3 className="text-lg font-semibold text-white">Add your OpenAI API key</h3>
                    <p className="text-sm text-white/60">
                      Your key is required to create and run agents. Save it once to continue.
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-white/70">Key label</label>
                    <input
                      value={keyAlias}
                      onChange={(e) => setKeyAlias(e.target.value)}
                      placeholder="Primary, Production, etc."
                      className="w-full px-3 py-2 border border-white/10 rounded-lg focus:ring-2 focus:ring-amber-400/60 focus:border-amber-300 bg-slate-900 text-sm text-white"
                      disabled={isSavingKey}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-white/70">OpenAI API key</label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full px-3 py-2 border border-white/10 rounded-lg focus:ring-2 focus:ring-amber-400/60 focus:border-amber-300 bg-slate-900 text-sm text-white font-mono"
                      disabled={isSavingKey}
                      required
                    />
                    <p className="text-xs text-white/50">Stored encrypted (base64) and masked after saving.</p>
                  </div>
                </div>
                {keyError && <p className="text-xs text-rose-300">{keyError}</p>}
                {keySuccessMessage && <p className="text-xs text-emerald-200">{keySuccessMessage}</p>}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={handleSaveProviderKey}
                    disabled={isSavingKey}
                    className="bg-amber-400/90 text-slate-950 hover:bg-amber-300"
                  >
                    {isSavingKey ? 'Saving key...' : 'Save API key'}
                  </Button>
                </div>
              </CardHeader>
            </Card>
          )}
          <Card className="border-white/10 shadow-[0_12px_40px_rgba(3,6,15,0.5)]">
            <CardHeader className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-200 flex items-center justify-center border border-cyan-400/30">
                  <BadgeCheck className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs uppercase text-white/50 tracking-[0.2em]">Invite</p>
                  <h3 className="text-lg font-semibold text-white">Invite teammates</h3>
                  <p className="text-sm text-white/60">
                    Send a VIAANA invite link so teammates can join your workspace.
                  </p>
                </div>
              </div>
              <div className="flex flex-col md:flex-row gap-3">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => {
                    setInviteEmail(e.target.value);
                    if (inviteError) setInviteError(null);
                  }}
                  placeholder="teammate@company.com"
                  className="flex-1 px-3 py-2 border border-white/10 rounded-lg focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-300 bg-slate-900 text-sm text-white"
                  disabled={isInviting}
                />
                <Button
                  size="sm"
                  onClick={handleInvite}
                  disabled={isInviting}
                  className="bg-cyan-500/80 hover:bg-cyan-400 text-white"
                >
                  {isInviting ? 'Sending...' : 'Send invite'}
                </Button>
              </div>
              {inviteError && <p className="text-xs text-rose-300">{inviteError}</p>}
              {inviteSuccessMessage && <p className="text-xs text-emerald-200">{inviteSuccessMessage}</p>}
              <p className="text-xs text-white/40">
                Invite links expire automatically. Ask teammates to accept promptly.
              </p>
            </CardHeader>
          </Card>
          <Card className="border-white/10 shadow-[0_12px_40px_rgba(3,6,15,0.5)]">
            <CardHeader className="flex flex-col gap-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <p className="text-xs uppercase text-white/50 tracking-[0.2em]">Preset lifecycle</p>
                  <h3 className="text-lg font-semibold text-white">Select or manage presets</h3>
                  <p className="text-sm text-white/60">
                    Switch between saved agents or capture the current setup as a new preset.
                  </p>
                </div>
                {activeConfigId && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDeletePreset(activeConfigId)}
                      disabled={isLoading}
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleResetToDefault} className="border-white/15 bg-transparent text-white/80 hover:border-cyan-300/60 hover:text-cyan-100 hover:bg-white/5">
                      <RotateCcw className="w-4 h-4" />
                      Reset instructions
                    </Button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="col-span-2 space-y-2">
                  <label className="text-xs font-semibold text-white/70">Active preset</label>
                  <select
                    value={activeConfigId || ''}
                    onChange={(e) => handlePresetSelect(e.target.value)}
                    className="w-full px-3 py-2 border border-white/10 rounded-lg focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-300 bg-slate-900 text-sm text-white"
                    disabled={isLoading}
                  >
                    <option value="">Select a preset...</option>
                    {presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name} {preset.is_default ? '(Default)' : ''}
                      </option>
                    ))}
                  </select>
                  {showSaveDialog && (
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
                      <label className="text-xs font-semibold text-white/70">Save as new preset</label>
                      <input
                        value={newPresetName}
                        onChange={(e) => setNewPresetName(e.target.value)}
                        placeholder="e.g. Support Agent, Sales Concierge"
                        className="w-full px-3 py-2 border border-white/10 rounded-lg focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-300 bg-slate-900 text-sm text-white"
                        disabled={isLoading}
                      />
                      {saveError && <p className="text-xs text-rose-300">{saveError}</p>}
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowSaveDialog(false);
                            setNewPresetName('');
                            setSaveError(null);
                          }}
                          className="text-white/70 hover:text-white hover:bg-white/5"
                        >
                          Cancel
                        </Button>
                        <Button size="sm" onClick={handleSaveNewPreset} disabled={isLoading} className="bg-cyan-500/80 hover:bg-cyan-400 text-white">
                          Save preset
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="h-full rounded-lg border border-dashed border-white/15 bg-white/5 p-3">
                  <p className="text-xs font-semibold text-white/70 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-300" />
                    Snapshot
                  </p>
                  <p className="text-xs text-white/50 mt-1">
                    Model: <span className="font-medium text-white/80">{config.model}</span>
                  </p>
                  <p className="text-xs text-white/50">
                    Updated: {activePreset?.updated_at ? new Date(activePreset.updated_at).toLocaleString() : '—'}
                  </p>
                  <p className="text-xs text-white/50">Max tokens: {config.max_response_output_tokens}</p>
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card className="border-white/10 shadow-[0_12px_40px_rgba(3,6,15,0.5)]">
            <CardHeader className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-200 flex items-center justify-center border border-indigo-400/30">
                  <Wand2 className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs uppercase text-white/50 tracking-[0.2em]">Behavior</p>
                  <h3 className="text-lg font-semibold text-white">Persona & tone</h3>
                  <p className="text-sm text-white/60">Guide the agent’s reasoning style, role, and safety posture.</p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-white/80">System instructions</label>
                  <div className="flex gap-2">
                    <Badge variant="secondary" className="text-[11px]">
                      Characters: {characterCount}
                    </Badge>
                    <Button variant="ghost" size="sm" onClick={handleResetToDefault} className="text-white/70 hover:text-cyan-100 hover:bg-white/5">
                      <RotateCcw className="w-3 h-3" />
                      Reset
                    </Button>
                  </div>
                </div>
                <textarea
                  value={config.instructions}
                  onChange={(e) => onConfigChange({ ...config, instructions: e.target.value })}
                  rows={8}
                  className="w-full px-3 py-2 border border-white/10 rounded-lg focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-300 bg-slate-900 text-white font-mono text-xs"
                  placeholder="Define the persona, boundaries, and style..."
                />
                <p className="text-xs text-white/50">
                  Use concise directives, add safety rules, and keep language consistent.
                </p>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.a2ui_enabled ?? false}
                    onChange={(event) =>
                      onConfigChange({
                        ...config,
                        a2ui_enabled: event.target.checked
                      })
                    }
                    className="w-4 h-4 text-cyan-400 border-white/20 rounded focus:ring-cyan-400"
                  />
                  <span className="text-sm font-semibold text-white/80">Enable A2UI (agent-generated UI)</span>
                </label>
                <p className="text-xs text-white/50">
                  Let the agent return interactive UI blocks alongside text responses.
                </p>
              </div>
            </CardHeader>
          </Card>

          <Card className="border-white/10 shadow-[0_12px_40px_rgba(3,6,15,0.5)]">
            <CardHeader className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="col-span-1 flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-200 flex items-center justify-center border border-amber-400/30">
                  <SlidersHorizontal className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs uppercase text-white/50 tracking-[0.2em]">Response controls</p>
                  <h3 className="text-lg font-semibold text-white">Model tuning</h3>
                  <p className="text-sm text-white/60">Balance creativity vs. determinism for this agent.</p>
                </div>
              </div>
              <div className="col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-semibold text-white/80 flex items-center justify-between">
                    Temperature
                    <span className="text-xs text-white/50">{config.temperature.toFixed(1)}</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={config.temperature}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        temperature: parseFloat(e.target.value)
                      })
                    }
                    className="w-full accent-cyan-300"
                  />
                  <p className="text-xs text-white/50 mt-1">Higher is more creative; lower is more deterministic.</p>
                </div>
                <div>
                  <label className="text-sm font-semibold text-white/80 flex items-center justify-between">
                    Max response tokens
                    <span className="text-xs text-white/50">{config.max_response_output_tokens}</span>
                  </label>
                  <input
                    type="number"
                    min={256}
                    max={16000}
                    step={128}
                    value={config.max_response_output_tokens}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        max_response_output_tokens: parseInt(e.target.value || '0', 10)
                      })
                    }
                    className="w-full px-3 py-2 border border-white/10 rounded-lg focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-300 bg-slate-900 text-sm text-white"
                  />
                  <p className="text-xs text-white/50 mt-1">Keep within model limits to avoid truncation.</p>
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card className="border-white/10 shadow-[0_12px_40px_rgba(3,6,15,0.5)]">
            <CardHeader className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="col-span-1 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-200 flex items-center justify-center border border-emerald-400/30">
                    <Workflow className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs uppercase text-white/50 tracking-[0.2em]">Voice & pacing</p>
                    <h3 className="text-lg font-semibold text-white">Voice + turn detection</h3>
                    <p className="text-sm text-white/60">Choose the voice provider and how the agent listens and responds.</p>
                  </div>
                </div>
                <div className="col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm font-semibold text-white/80">Voice provider</label>
                    <select
                      value={resolvedProvider}
                      onChange={(e) => {
                        const nextProvider = e.target.value as 'openai_realtime' | 'personaplex';
                        onConfigChange({
                          ...config,
                          voice_provider: nextProvider,
                          voice_sample_rate_hz: nextProvider === 'personaplex'
                            ? (config.voice_sample_rate_hz ?? 24000)
                            : (config.voice_sample_rate_hz ?? null),
                          voice_id: nextProvider === 'personaplex'
                            ? (config.voice_id ?? 'NATF0')
                            : (config.voice_id ?? null)
                        });
                      }}
                      className="w-full px-3 py-2 border border-white/10 rounded-lg focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-300 bg-slate-900 text-sm text-white"
                    >
                      {VOICE_PROVIDERS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} — {option.description}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-white/80">
                      {isPersonaPlex ? 'PersonaPlex voice ID' : 'Voice'}
                    </label>
                    <select
                      value={isPersonaPlex ? (config.voice_id ?? 'NATF0') : config.voice}
                      onChange={(e) => {
                        if (isPersonaPlex) {
                          onConfigChange({ ...config, voice_id: e.target.value });
                        } else {
                          onConfigChange({ ...config, voice: e.target.value });
                        }
                      }}
                      className="w-full px-3 py-2 border border-white/10 rounded-lg focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-300 bg-slate-900 text-sm text-white"
                    >
                      {(isPersonaPlex ? PERSONAPLEX_VOICE_OPTIONS : VOICE_OPTIONS).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} — {option.description}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.turn_detection !== null}
                        onChange={() =>
                          onConfigChange({
                            ...config,
                            turn_detection: config.turn_detection
                              ? null
                              : {
                                  type: 'server_vad',
                                  threshold: 0.5,
                                  prefix_padding_ms: 300,
                                  silence_duration_ms: 500
                                }
                          })
                        }
                        className="w-4 h-4 text-cyan-400 border-white/20 rounded focus:ring-cyan-400"
                      />
                      <span className="text-sm font-semibold text-white/80">Voice activity detection</span>
                    </label>
                    <p className="text-xs text-white/50">Let the agent auto-respond when you pause speaking.</p>
                  </div>
                </div>
              </div>
              {isPersonaPlex && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-semibold text-white/80">Persona / role prompt</label>
                    <textarea
                      value={config.voice_persona_prompt ?? ''}
                      onChange={(e) =>
                        onConfigChange({
                          ...config,
                          voice_persona_prompt: e.target.value
                        })
                      }
                      rows={4}
                      placeholder="Describe the persona, role, and context PersonaPlex should adopt."
                      className="w-full px-3 py-2 border border-white/10 rounded-lg focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-300 bg-slate-900 text-sm text-white resize-none"
                    />
                    <p className="text-xs text-white/50 mt-1">Used as the PersonaPlex text prompt (streaming speech-to-speech).</p>
                  </div>
                  <div className="space-y-3">
                    <div className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white/80">
                      Sample rate: {config.voice_sample_rate_hz ?? 24000} Hz
                    </div>
                    <p className="text-xs text-white/50">
                      PersonaPlex runs at 24kHz mono audio. Your gateway should enforce resampling before streaming.
                    </p>
                  </div>
                </div>
              )}
            </CardHeader>
          </Card>

          <Card className="border-white/10 shadow-[0_12px_40px_rgba(3,6,15,0.5)]">
            <CardHeader className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 text-white flex items-center justify-center border border-white/10">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <p className="text-xs uppercase text-white/50 tracking-[0.2em]">Automations</p>
                  <h3 className="text-lg font-semibold text-white">Tools & n8n workflows</h3>
                  <p className="text-sm text-white/60">
                    Choose which MCP tools and n8n webhooks the agent can call. Changes save immediately to the preset.
                  </p>
                </div>
              </div>
              <ToolSelectionPanel configId={activeConfigId} onToolsChanged={onToolsChanged} />
            </CardHeader>
          </Card>

          <div className="flex items-center justify-between text-xs text-white/50 px-1">
            <span className="flex items-center gap-1">
              <BadgeCheck className="w-4 h-4 text-emerald-300" />
              Provider key: {providerKeyId || 'Not set'}
            </span>
            <span>
              Created: {activePreset?.created_at ? new Date(activePreset.created_at).toLocaleString() : '—'}
            </span>
          </div>
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div className="h-full w-full bg-slate-950/40 text-white">
        {content}
      </div>
    );
  }

  return (
    <RightPanel
      isOpen={isOpen}
      onClose={onClose}
      title="Agent Configuration"
      subtitle={hasUnsavedChanges ? 'Unsaved changes' : activePreset?.name || 'New preset'}
      width="920px"
    >
      {content}
    </RightPanel>
  );
}
