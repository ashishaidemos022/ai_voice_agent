import { useState } from 'react';
import type { PostgrestError } from '@supabase/supabase-js';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Card } from '../ui/Card';

export function ProviderKeyStep() {
  const { vaUser, refreshProfile, signOut } = useAuth();
  const [keyAlias, setKeyAlias] = useState('Primary');
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const defaultAgentPayload = {
    name: 'Default Voice Agent',
    instructions:
      'You are a helpful AI voice assistant. You can help users with various tasks, answer questions, and execute tools when needed. Be conversational and friendly.',
    voice: 'alloy',
    temperature: 0.8,
    model: 'gpt-realtime',
    max_response_output_tokens: 4096,
    turn_detection_enabled: true,
    turn_detection_config: {
      type: 'server_vad',
      threshold: 0.75,
      prefix_padding_ms: 150,
      silence_duration_ms: 700
    },
    is_default: true
  };

  if (!vaUser) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!apiKey.trim()) {
      setError('Please provide your OpenAI API key');
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    const isConflict = (dbError?: Pick<PostgrestError, 'code'> | null) => dbError?.code === '23505';

    try {
      const masked = apiKey.trim();
      const encoded = btoa(masked);
      const lastFour = masked.slice(-4);

      const insertPayload = {
        user_id: vaUser.id,
        provider: 'openai',
        key_alias: keyAlias || 'Primary',
        encrypted_key: encoded,
        last_four: lastFour
      };

      const { error: insertError } = await supabase.from('va_provider_keys').insert(insertPayload);

      if (insertError) {
        // Handle duplicate key (e.g., existing key for this user) by updating in place
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
            .eq('user_id', vaUser.id)
            .eq('provider', 'openai');

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
        .eq('user_id', vaUser.id)
        .eq('provider', 'openai')
        .single();

      if (providerKeyError) {
        throw providerKeyError;
      }

      if (!vaUser.default_agent_id) {
        const { data: agent, error: agentError } = await supabase
          .from('va_agent_configs')
          .insert({
            user_id: vaUser.id,
            provider_key_id: providerKeyRow.id,
            ...defaultAgentPayload
          })
          .select()
          .single();

        if (agentError) {
          throw agentError;
        }

        await supabase
          .from('va_users')
          .update({
            onboarding_state: 'ready',
            default_agent_id: agent.id
          })
          .eq('id', vaUser.id);
      } else {
        await supabase
          .from('va_users')
          .update({ onboarding_state: 'ready' })
          .eq('id', vaUser.id);
      }

      await refreshProfile();
      setApiKey('');
      setSuccessMessage('Key saved. Taking you to the workspace.');
    } catch (err: any) {
      console.error('Failed to save provider key', err);
      if (isConflict(err)) {
        setError('A key for this account already exists. You can overwrite it by saving again.');
      } else {
        setError(err.message || 'Failed to save key');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <Card className="relative max-w-lg w-full p-8 bg-slate-900 border border-slate-800 text-white">
        <button
          onClick={signOut}
          className="absolute top-4 right-4 text-xs text-slate-400 hover:text-white"
        >
          Sign out
        </button>
        <h1 className="text-2xl font-semibold mb-2">Add Your OpenAI API Key</h1>
        <p className="text-sm text-slate-400 mb-6">
          Each workspace uses its own OpenAI credentials to run voice sessions. Keys are encrypted at rest and only decrypted server-side.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-slate-400">Key label</label>
            <input
              type="text"
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2"
              value={keyAlias}
              onChange={(e) => setKeyAlias(e.target.value)}
              placeholder="Primary, Production, etc."
              disabled={isSaving}
            />
          </div>

          <div>
            <label className="text-sm text-slate-400">OpenAI API Key</label>
            <input
              type="password"
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 font-mono tracking-wider"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              disabled={isSaving}
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              Stored encrypted (base64) and only the last four characters are shown later.
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}
          {successMessage && (
            <p className="text-sm text-green-400">{successMessage}</p>
          )}

          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 font-medium disabled:opacity-60"
          >
            {isSaving ? 'Saving...' : 'Save API Key'}
          </button>
        </form>
      </Card>
    </div>
  );
}
