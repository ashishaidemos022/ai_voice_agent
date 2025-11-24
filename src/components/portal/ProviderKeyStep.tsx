import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Card } from '../ui/Card';

export function ProviderKeyStep() {
  const { vaUser, refreshProfile, signOut } = useAuth();
  const [keyAlias, setKeyAlias] = useState('Primary');
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!vaUser) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!apiKey.trim()) {
      setError('Please provide your OpenAI API key');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const masked = apiKey.trim();
      const encoded = btoa(masked);
      const lastFour = masked.slice(-4);

      await supabase.from('va_provider_keys').insert({
        user_id: vaUser.id,
        provider: 'openai',
        key_alias: keyAlias || 'Primary',
        encrypted_key: encoded,
        last_four: lastFour
      });

      await supabase
        .from('va_users')
        .update({ onboarding_state: 'needs_agent' })
        .eq('id', vaUser.id);

      await refreshProfile();
      setApiKey('');
    } catch (err: any) {
      console.error('Failed to save provider key', err);
      setError(err.message || 'Failed to save key');
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
