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
  handleSave: (updates: { allowedOrigins: string[]; isEnabled: boolean }) => Promise<void>;
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
    async (updates: { allowedOrigins: string[]; isEnabled: boolean }) => {
      if (!normalizedAgentId || !embed) return;
      setIsSaving(true);
      setError(null);
      try {
        const record = await updateAgentEmbed(normalizedAgentId, {
          allowed_origins: updates.allowedOrigins,
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
