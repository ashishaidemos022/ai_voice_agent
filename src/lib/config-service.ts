import { supabase } from './supabase';
import { RealtimeConfig } from '../types/voice-agent';

export interface SelectedTool {
  tool_name: string;
  tool_source: 'mcp';
  tool_id?: string;
  connection_id?: string;
}

export interface AgentConfigPreset {
  id: string;
  user_id: string | null;
  name: string;
  instructions: string;
  voice: string;
  temperature: number;
  model: string;
  max_response_output_tokens: number;
  turn_detection_enabled: boolean;
  turn_detection_config: any;
  is_default: boolean;
  selected_tools?: SelectedTool[];
  created_at: string;
  updated_at: string;
}

export function configPresetToRealtimeConfig(preset: AgentConfigPreset): RealtimeConfig {
  const normalizedModel = preset.model && preset.model.startsWith('gpt-4o-realtime')
    ? 'gpt-realtime'
    : preset.model;
  return {
    model: normalizedModel,
    voice: preset.voice,
    instructions: preset.instructions,
    temperature: preset.temperature,
    max_response_output_tokens: preset.max_response_output_tokens,
    turn_detection: preset.turn_detection_enabled ? preset.turn_detection_config : null
  };
}

export function realtimeConfigToPreset(config: RealtimeConfig, name: string): Partial<AgentConfigPreset> {
  return {
    name,
    instructions: config.instructions,
    voice: config.voice,
    temperature: config.temperature,
    model: config.model,
    max_response_output_tokens: config.max_response_output_tokens,
    turn_detection_enabled: config.turn_detection !== null,
    turn_detection_config: config.turn_detection || {
      type: 'server_vad',
      threshold: 0.7,
      prefix_padding_ms: 200,
      silence_duration_ms: 800
    }
  };
}

export async function getAllConfigPresets(): Promise<AgentConfigPreset[]> {
  const { data, error } = await supabase
    .from('va_agent_configs')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch config presets:', error);
    throw error;
  }

  return data || [];
}

export async function getDefaultConfigPreset(): Promise<AgentConfigPreset | null> {
  const { data, error } = await supabase
    .from('va_agent_configs')
    .select('*')
    .eq('is_default', true)
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch default config preset:', error);
    throw error;
  }

  return data;
}

export async function getConfigPresetById(id: string): Promise<AgentConfigPreset | null> {
  const { data, error } = await supabase
    .from('va_agent_configs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch config preset:', error);
    throw error;
  }

  return data;
}

export async function saveConfigPreset(preset: Partial<AgentConfigPreset>): Promise<AgentConfigPreset> {
  const { data, error } = await supabase
    .from('va_agent_configs')
    .insert({
      ...preset,
      updated_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to save config preset:', error);
    throw error;
  }

  return data;
}

export async function updateConfigPreset(id: string, updates: Partial<AgentConfigPreset>): Promise<AgentConfigPreset> {
  const { data, error } = await supabase
    .from('va_agent_configs')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Failed to update config preset:', error);
    throw error;
  }

  return data;
}

export async function deleteConfigPreset(id: string): Promise<void> {
  const { error } = await supabase
    .from('va_agent_configs')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Failed to delete config preset:', error);
    throw error;
  }
}

export async function setDefaultConfigPreset(id: string): Promise<void> {
  await supabase
    .from('va_agent_configs')
    .update({ is_default: false })
    .neq('id', id);

  const { error } = await supabase
    .from('va_agent_configs')
    .update({ is_default: true })
    .eq('id', id);

  if (error) {
    console.error('Failed to set default config preset:', error);
    throw error;
  }
}

export async function getConfigTools(configId: string): Promise<SelectedTool[]> {
  const { data, error } = await supabase
    .from('va_agent_config_tools')
    .select('tool_name, tool_source, tool_id, connection_id')
    .eq('config_id', configId);

  if (error) {
    console.error('Failed to fetch config tools:', error);
    throw error;
  }

  return data || [];
}

export async function updateConfigTools(configId: string, tools: SelectedTool[]): Promise<void> {
  await supabase
    .from('va_agent_config_tools')
    .delete()
    .eq('config_id', configId);

  if (tools.length > 0) {
    const toolsToInsert = tools.map(tool => ({
      config_id: configId,
      tool_name: tool.tool_name,
      tool_source: tool.tool_source,
      tool_id: tool.tool_id || null,
      connection_id: tool.connection_id || null
    }));

    const { error } = await supabase
      .from('va_agent_config_tools')
      .insert(toolsToInsert);

    if (error) {
      console.error('Failed to update config tools:', error);
      throw error;
    }
  }
}

export async function getConfigPresetWithTools(id: string): Promise<AgentConfigPreset | null> {
  const preset = await getConfigPresetById(id);
  if (!preset) return null;

  const tools = await getConfigTools(id);
  return {
    ...preset,
    selected_tools: tools
  };
}
