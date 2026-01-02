import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentEmbed } from '../types/embed';
import { createAgentEmbed, fetchAgentEmbed, updateAgentEmbed } from '../lib/embed-service';

interface UseAgentEmbedResult {
  embed: AgentEmbed | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  regenerateError: string | null;
  refresh: () => Promise<void>;
  handleCreate: () => Promise<void>;
  handleSave: (updates: {
    allowedOrigins?: string[];
    isEnabled?: boolean;
    logoUrl?: string | null;
    brandName?: string | null;
    accentColor?: string | null;
    backgroundColor?: string | null;
    surfaceColor?: string | null;
    textColor?: string | null;
    buttonColor?: string | null;
    buttonTextColor?: string | null;
    helperTextColor?: string | null;
    cornerRadius?: number | null;
    fontFamily?: string | null;
    waveColor?: string | null;
    bubbleColor?: string | null;
    logoBackgroundColor?: string | null;
    widgetWidth?: number | null;
    widgetHeight?: number | null;
    buttonImageUrl?: string | null;
  }) => Promise<void>;
  handleRotate: () => Promise<void>;
}

export function useAgentEmbed(agentConfigId: string | null | undefined): UseAgentEmbedResult {
  const [embed, setEmbed] = useState<AgentEmbed | null>(null);
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
      const record = await fetchAgentEmbed(normalizedAgentId);
      setEmbed(record);
    } catch (err: any) {
      setError(err?.message || 'Failed to load embed');
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
      const record = await createAgentEmbed(normalizedAgentId);
      setEmbed(record);
    } catch (err: any) {
      setError(err?.message || 'Failed to create embed');
    } finally {
      setIsSaving(false);
    }
  }, [normalizedAgentId]);

  const handleSave = useCallback(
    async (updates: {
      allowedOrigins?: string[];
      isEnabled?: boolean;
      logoUrl?: string | null;
      brandName?: string | null;
      accentColor?: string | null;
      backgroundColor?: string | null;
      surfaceColor?: string | null;
      textColor?: string | null;
      buttonColor?: string | null;
      buttonTextColor?: string | null;
      helperTextColor?: string | null;
      cornerRadius?: number | null;
      fontFamily?: string | null;
      waveColor?: string | null;
      bubbleColor?: string | null;
      logoBackgroundColor?: string | null;
      widgetWidth?: number | null;
      widgetHeight?: number | null;
      buttonImageUrl?: string | null;
    }) => {
      if (!normalizedAgentId || !embed) return;
      setIsSaving(true);
      setError(null);
      try {
        const record = await updateAgentEmbed(normalizedAgentId, {
          allowed_origins: updates.allowedOrigins,
          logo_url: updates.logoUrl,
          brand_name: updates.brandName,
          accent_color: updates.accentColor,
          background_color: updates.backgroundColor,
          surface_color: updates.surfaceColor,
          text_color: updates.textColor,
          button_color: updates.buttonColor,
          button_text_color: updates.buttonTextColor,
          helper_text_color: updates.helperTextColor,
          corner_radius: updates.cornerRadius,
          font_family: updates.fontFamily,
          wave_color: updates.waveColor,
          bubble_color: updates.bubbleColor,
          logo_background_color: updates.logoBackgroundColor,
          widget_width: updates.widgetWidth,
          widget_height: updates.widgetHeight,
          button_image_url: updates.buttonImageUrl,
          is_enabled: updates.isEnabled
        });
        setEmbed(record);
      } catch (err: any) {
        setError(err?.message || 'Failed to update embed');
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
      const record = await updateAgentEmbed(normalizedAgentId, { rotate_public_id: true });
      setEmbed(record);
    } catch (err: any) {
      setRegenerateError(err?.message || 'Failed to rotate embed id');
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
