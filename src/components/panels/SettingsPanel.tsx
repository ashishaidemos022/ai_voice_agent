import { useState, useEffect } from 'react';
import { Save, Trash2, RotateCcw, Plus } from 'lucide-react';
import { RealtimeConfig } from '../../types/voice-agent';
import {
  getAllConfigPresets,
  saveConfigPreset,
  updateConfigPreset,
  deleteConfigPreset,
  realtimeConfigToPreset,
  configPresetToRealtimeConfig,
  AgentConfigPreset
} from '../../lib/config-service';
import { RightPanel } from '../layout/RightPanel';
import { Button } from '../ui/Button';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Separator } from '../ui/Separator';
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
}

const DEFAULT_INSTRUCTIONS = 'You are a helpful AI voice assistant. You can help users with various tasks, answer questions, and execute tools when needed. Be conversational and friendly.';

// Latest GPT Realtime voices
const VOICE_OPTIONS = [
  { value: 'alloy', label: 'Alloy', description: 'Balanced, default choice' },
  { value: 'verse', label: 'Verse', description: 'Expressive and dynamic' },
  { value: 'shimmer', label: 'Shimmer', description: 'Warm and gentle' },
  { value: 'echo', label: 'Echo', description: 'Clear and energetic' }
];

export function SettingsPanel({
  isOpen,
  onClose,
  config,
  onConfigChange,
  activeConfigId,
  onActiveConfigChange,
  userId,
  providerKeyId,
  onPresetsRefresh
}: SettingsPanelProps) {
  const [presets, setPresets] = useState<AgentConfigPreset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadPresets();
    }
  }, [isOpen]);

  useEffect(() => {
    if (activeConfigId) {
      const activePreset = presets.find(p => p.id === activeConfigId);
      if (activePreset) {
        const presetConfig = configPresetToRealtimeConfig(activePreset);
        const hasChanges = JSON.stringify(presetConfig) !== JSON.stringify(config);
        setHasUnsavedChanges(hasChanges);
      }
    } else {
      setHasUnsavedChanges(false);
    }
  }, [config, activeConfigId, presets]);

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
    const preset = presets.find(p => p.id === presetId);
    if (preset) {
      const newConfig = configPresetToRealtimeConfig(preset);
      onConfigChange(newConfig);
      onActiveConfigChange(presetId);
      setHasUnsavedChanges(false);
    }
  };

  const handleSaveNewPreset = async () => {
    if (!newPresetName.trim()) {
      setSaveError('Please enter a preset name');
      return;
    }
    if (!providerKeyId) {
      setSaveError('Add an OpenAI API key before saving presets.');
      return;
    }

    setIsLoading(true);
    setSaveError(null);
    try {
      const presetData = realtimeConfigToPreset(config, newPresetName.trim());
      const savedPreset = await saveConfigPreset(presetData, userId, providerKeyId);
      await loadPresets();
      if (onPresetsRefresh) {
        await onPresetsRefresh();
      }
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

  const handleUpdateCurrentPreset = async () => {
    if (!activeConfigId) return;

    setIsLoading(true);
    try {
      const updates = realtimeConfigToPreset(config, presets.find(p => p.id === activeConfigId)?.name || 'Unnamed');
      await updateConfigPreset(activeConfigId, updates);
      await loadPresets();
      if (onPresetsRefresh) {
        await onPresetsRefresh();
      }
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
      if (onPresetsRefresh) {
        await onPresetsRefresh();
      }
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

  return (
    <RightPanel
      isOpen={isOpen}
      onClose={onClose}
      title="Agent Configuration"
      subtitle={hasUnsavedChanges ? "You have unsaved changes" : undefined}
    >
      <div className="p-6 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">Configuration Presets</h3>
              <Button
                size="sm"
                onClick={() => setShowSaveDialog(true)}
                disabled={isLoading}
              >
                <Plus className="w-3 h-3" />
                Save as New
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <select
              value={activeConfigId || ''}
              onChange={(e) => handlePresetSelect(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary bg-white text-sm"
              disabled={isLoading}
            >
              <option value="">Select a preset...</option>
              {presets.map(preset => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} {preset.is_default ? '(Default)' : ''}
                </option>
              ))}
            </select>

            {activeConfigId && (
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleUpdateCurrentPreset}
                  disabled={isLoading || !hasUnsavedChanges}
                  className="flex-1"
                >
                  <Save className="w-3 h-3" />
                  Update
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleDeletePreset(activeConfigId)}
                  disabled={isLoading}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {showSaveDialog && (
          <Card className="border-2 border-blue-500">
            <CardHeader>
              <h4 className="text-sm font-semibold text-gray-800">Save Configuration Preset</h4>
            </CardHeader>
            <CardContent>
              <input
                type="text"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="Enter preset name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary mb-3 text-sm"
                autoFocus
              />
              {saveError && (
                <p className="text-xs text-red-600 mb-3">{saveError}</p>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSaveNewPreset}
                  disabled={isLoading}
                  className="flex-1"
                >
                  Save Preset
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowSaveDialog(false);
                    setNewPresetName('');
                    setSaveError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Separator />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Voice
          </label>
          <select
            value={config.voice}
            onChange={(e) => onConfigChange({ ...config, voice: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary text-sm"
          >
            {VOICE_OPTIONS.map(voice => (
              <option key={voice.value} value={voice.value}>
                {voice.label} - {voice.description}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              System Instructions
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetToDefault}
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </Button>
          </div>
          <textarea
            value={config.instructions}
            onChange={(e) => onConfigChange({ ...config, instructions: e.target.value })}
            rows={8}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary font-mono text-xs"
            placeholder="Enter custom instructions..."
          />
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs text-gray-500">
              Customize how the AI behaves and responds
            </p>
            <p className="text-xs text-gray-500">
              {characterCount} characters
            </p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Temperature: {config.temperature.toFixed(1)}
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={config.temperature}
            onChange={(e) => onConfigChange({ ...config, temperature: parseFloat(e.target.value) })}
            className="w-full"
          />
          <p className="mt-1 text-xs text-gray-500">
            Higher values make responses more creative
          </p>
        </div>

        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config.turn_detection !== null}
              onChange={() => onConfigChange({
                ...config,
                turn_detection: config.turn_detection
                  ? null
                  : {
                      type: 'server_vad',
                      threshold: 0.5,
                      prefix_padding_ms: 300,
                      silence_duration_ms: 500
                    }
              })}
              className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
            />
            <span className="text-sm font-medium text-gray-700">
              Voice Activity Detection
            </span>
          </label>
          <p className="mt-1 text-xs text-gray-500 ml-6">
            AI will automatically respond when you finish speaking
          </p>
        </div>

        <Separator />

        <ToolSelectionPanel
          configId={activeConfigId}
          onToolsChanged={() => {
            console.log('Tool selection updated');
          }}
        />

        <Separator />

        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">Model Information</h3>
          <div className="space-y-1 text-xs text-gray-600">
            <div className="flex justify-between">
              <span className="font-medium">Model:</span>
              <Badge variant="secondary">{config.model}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Max Tokens:</span>
              <Badge variant="secondary">{config.max_response_output_tokens}</Badge>
            </div>
          </div>
        </div>
      </div>
    </RightPanel>
  );
}
