import { useCallback, useEffect, useMemo, useState } from 'react';
import type { VoiceEmbed } from '../types/voice-embed';
import { createVoiceEmbed, fetchVoiceEmbedConfig, updateVoiceEmbed } from '../lib/voice-embed-service';

interface VoiceEmbedUpdates {
  allowedOrigins?: string[];
  isEnabled?: boolean;
  rtcEnabled?: boolean;
  ttsVoice?: string | null;
  rotatePublicId?: boolean;
}

interface UseVoiceEmbedConfigResult {
  embed: VoiceEmbed | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  regenerateError: string | null;
  refresh: () => Promise<void>;
  handleCreate: () => Promise<void>;
  handleSave: (updates: VoiceEmbedUpdates) => Promise<void>;
  handleRotate: () => Promise<void>;
}

export function useVoiceEmbedConfig(agentConfigId: string | null | undefined): UseVoiceEmbedConfigResult {
  const [embed, setEmbed] = useState<VoiceEmbed | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  const normalizedAgentId = useMemo(() => agentConfigId || null, [agentConfigId]);

  const refresh = useCallback(async () => {
    if (!normalizedAgentId) {
      setEmbed(null);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const record = await fetchVoiceEmbedConfig(normalizedAgentId);
      setEmbed(record);
    } catch (err: any) {
      setError(err?.message || 'Failed to load voice embed');
      setEmbed(null);
    } finally {
      setIsLoading(false);
    }
  }, [normalizedAgentId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = useCallback(async () => {
    if (!normalizedAgentId) return;
    setIsSaving(true);
    setError(null);
    try {
      const record = await createVoiceEmbed(normalizedAgentId);
      setEmbed(record);
    } catch (err: any) {
      setError(err?.message || 'Failed to create voice embed');
    } finally {
      setIsSaving(false);
    }
  }, [normalizedAgentId]);

  const handleSave = useCallback(
    async (updates: VoiceEmbedUpdates) => {
      if (!normalizedAgentId || !embed) return;
      setIsSaving(true);
      setError(null);
      try {
        const record = await updateVoiceEmbed(normalizedAgentId, {
          allowed_origins: updates.allowedOrigins,
          is_enabled: updates.isEnabled,
          rtc_enabled: updates.rtcEnabled,
          tts_voice: updates.ttsVoice
        });
        setEmbed(record);
      } catch (err: any) {
        setError(err?.message || 'Failed to update voice embed');
      } finally {
        setIsSaving(false);
      }
    },
    [embed, normalizedAgentId]
  );

  const handleRotate = useCallback(async () => {
    if (!normalizedAgentId || !embed) return;
    setIsSaving(true);
    setRegenerateError(null);
    try {
      const record = await updateVoiceEmbed(normalizedAgentId, { rotate_public_id: true });
      setEmbed(record);
    } catch (err: any) {
      setRegenerateError(err?.message || 'Failed to rotate voice embed id');
    } finally {
      setIsSaving(false);
    }
  }, [embed, normalizedAgentId]);

  return {
    embed,
    isLoading,
    isSaving,
    error,
    regenerateError,
    refresh,
    handleCreate,
    handleSave,
    handleRotate
  };
}
