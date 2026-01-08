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

type AgentSetupStepProps = {
  embedded?: boolean;
};

export function AgentSetupStep({ embedded = false }: AgentSetupStepProps) {
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
    <div className={embedded ? 'h-full text-white px-6 py-6' : 'min-h-screen bg-[#05070f] text-white px-6 py-12'}>
      {!embedded && (
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.08),_transparent_45%),radial-gradient(circle_at_20%_80%,_rgba(59,130,246,0.12),_transparent_55%)]" />
      )}
      <div className={embedded ? 'relative z-10 max-w-5xl mx-auto space-y-8' : 'relative z-10 max-w-5xl mx-auto space-y-8'}>
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] text-white/40 uppercase mb-2 tracking-[0.3em]">Create agent</p>
            <h1 className="text-3xl font-semibold mb-2 font-display">Create your first AI Agent</h1>
            <p className="text-white/60 max-w-2xl">
              Choose a preset blueprint and bind it to the OpenAI key you added. This becomes the default agent for your workspace.
            </p>
          </div>
          <button
            onClick={signOut}
            className="text-sm text-white/60 hover:text-white"
          >
            Sign out
          </button>
        </header>

        <div className="space-y-3">
          <label className="text-sm text-white/70">OpenAI key</label>
          <select
            className="w-full bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
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
            <p className="text-white/50 col-span-3">Loading presets...</p>
          )}
          {!isLoading && presets.map((preset) => {
            const isActive = preset.id === selectedPresetId;
            return (
              <Card
                key={preset.id}
                className={`p-4 bg-slate-950/80 border ${isActive ? 'border-cyan-400/60 shadow-[0_0_20px_rgba(34,211,238,0.2)]' : 'border-white/10'} cursor-pointer`}
                onClick={() => setSelectedPresetId(preset.id)}
              >
                <h3 className="font-semibold text-lg text-white">{preset.name}</h3>
                <p className="text-sm text-white/60 mt-2">{preset.description}</p>
                <div className="mt-3 text-xs text-white/50 space-y-1">
                  <p>Voice: {preset.voice}</p>
                  <p>Model: {preset.model}</p>
                  <p>Temperature: {preset.temperature}</p>
                </div>
              </Card>
            );
          })}
        </div>

        {error && (
          <p className="text-sm text-rose-300">{error}</p>
        )}

        <button
          onClick={handleCreate}
          disabled={isCreating || !selectedPresetId || !selectedKeyId}
          className="w-full py-3 rounded-lg bg-gradient-to-r from-blue-600 via-cyan-500 to-blue-600 text-white font-semibold shadow-[0_0_25px_rgba(34,211,238,0.25)] hover:brightness-110 disabled:opacity-60"
        >
          {isCreating ? 'Creating agent...' : 'Create agent and continue'}
        </button>
      </div>
    </div>
  );
}
