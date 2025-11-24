import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Card } from '../ui/Card';

type AgentPresetTemplate = {
  id: string;
  name: string;
  description: string | null;
  instructions: string;
  model: string;
  temperature: number;
  voice: string;
  turn_detection_config: any;
};

export function AgentSetupStep() {
  const { vaUser, providerKeys, refreshProfile, signOut } = useAuth();
  const [presets, setPresets] = useState<AgentPresetTemplate[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedKeyId(providerKeys[0]?.id || null);
  }, [providerKeys]);

  useEffect(() => {
    let isMounted = true;
    supabase
      .from('va_agent_presets')
      .select('*')
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          console.error('Failed to load presets', error);
          setError(error.message);
        } else {
          setPresets(data || []);
          if (!selectedPresetId && data && data.length > 0) {
            setSelectedPresetId(data[0].id);
          }
        }
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!vaUser) return null;

  const handleCreate = async () => {
    if (!selectedPresetId || !selectedKeyId) {
      setError('Please select a preset and API key');
      return;
    }

    const preset = presets.find((p) => p.id === selectedPresetId);
    if (!preset) {
      setError('Preset not found');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const { data: agent, error: insertError } = await supabase
        .from('va_agent_configs')
        .insert({
          user_id: vaUser.id,
          provider_key_id: selectedKeyId,
          name: preset.name,
          instructions: preset.instructions,
          voice: preset.voice,
          temperature: preset.temperature,
          model: preset.model,
          max_response_output_tokens: 4096,
          turn_detection_enabled: true,
          turn_detection_config: preset.turn_detection_config,
          is_default: true
        })
        .select()
        .single();

      if (insertError) {
        throw insertError;
      }

      await supabase
        .from('va_users')
        .update({
          onboarding_state: 'ready',
          default_agent_id: agent.id
        })
        .eq('id', vaUser.id);

      await refreshProfile();
    } catch (err: any) {
      console.error('Failed to create agent', err);
      setError(err.message || 'Failed to create agent');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-12">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-400 uppercase mb-2 tracking-widest">Step 2</p>
            <h1 className="text-3xl font-semibold mb-2">Create your first AI Agent</h1>
            <p className="text-slate-400 max-w-2xl">
              Choose a preset blueprint and bind it to the OpenAI key you added. This becomes the default agent for your workspace.
            </p>
          </div>
          <button
            onClick={signOut}
            className="text-sm text-slate-400 hover:text-white"
          >
            Sign out
          </button>
        </header>

        <div className="space-y-3">
          <label className="text-sm text-slate-300">OpenAI key</label>
          <select
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2"
            value={selectedKeyId || ''}
            onChange={(e) => setSelectedKeyId(e.target.value)}
          >
            {providerKeys.map((key) => (
              <option key={key.id} value={key.id}>
                {key.key_alias} ••••{key.last_four || ''}
              </option>
            ))}
          </select>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {isLoading && (
            <p className="text-slate-500 col-span-3">Loading presets...</p>
          )}
          {!isLoading && presets.map((preset) => {
            const isActive = preset.id === selectedPresetId;
            return (
              <Card
                key={preset.id}
                className={`p-4 bg-slate-900 border ${isActive ? 'border-blue-500' : 'border-slate-800'} cursor-pointer`}
                onClick={() => setSelectedPresetId(preset.id)}
              >
                <h3 className="font-semibold text-lg">{preset.name}</h3>
                <p className="text-sm text-slate-400 mt-2">{preset.description}</p>
                <div className="mt-3 text-xs text-slate-500 space-y-1">
                  <p>Voice: {preset.voice}</p>
                  <p>Model: {preset.model}</p>
                  <p>Temperature: {preset.temperature}</p>
                </div>
              </Card>
            );
          })}
        </div>

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        <button
          onClick={handleCreate}
          disabled={isCreating || !selectedPresetId || !selectedKeyId}
          className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 font-semibold disabled:opacity-60"
        >
          {isCreating ? 'Creating agent...' : 'Create agent and continue'}
        </button>
      </div>
    </div>
  );
}
