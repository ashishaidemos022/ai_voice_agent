import { supabase } from './supabase';
import { RealtimeConfig } from '../types/voice-agent';
import type { RagMode, RagSpace } from '../types/rag';

const RAG_RELATION_SELECT = `
  *,
  knowledge_spaces:va_rag_agent_spaces (
    id,
    agent_config_id,
    space_id,
    created_at,
    rag_space:va_rag_spaces (
      id,
      name,
      description,
      vector_store_id,
      status,
      created_at,
      updated_at
    )
  )
`;

function isRagRelationError(error: any | null) {
  if (!error) return false;
  const message = `${error.message || ''} ${error.details || ''}`.toLowerCase();
  return message.includes('va_rag_agent_spaces') || message.includes('va_rag_spaces');
}

export interface SelectedTool {
  tool_name: string;
  tool_source: 'mcp' | 'n8n';
  tool_id?: string;
  connection_id?: string;
  n8n_integration_id?: string;
  metadata?: Record<string, any>;
}

export interface AgentConfigPreset {
  id: string;
  user_id: string;
  name: string;
  instructions: string;
  summary?: string | null;
  tags?: string[] | null;
  agent_avatar_url?: string | null;
  chat_model?: string | null;
  chat_theme?: Record<string, any> | null;
  voice: string;
  temperature: number;
  model: string;
  max_response_output_tokens: number;
  turn_detection_enabled: boolean;
  turn_detection_config: any;
  is_default: boolean;
  provider_key_id: string | null;
  selected_tools?: SelectedTool[];
  rag_enabled: boolean;
  rag_mode: RagMode;
  rag_default_model?: string | null;
  knowledge_spaces?: AgentKnowledgeSpaceBinding[];
  created_at: string;
  updated_at: string;
}

export interface AgentKnowledgeSpaceBinding {
  id: string;
  agent_config_id: string;
  space_id: string;
  created_at: string;
  rag_space?: RagSpace | null;
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string | null;
  instructions: string;
  voice: string;
  temperature: number;
  model: string;
  turn_detection_config: any;
}

export function configPresetToRealtimeConfig(preset: AgentConfigPreset): RealtimeConfig {
  const normalizedModel = preset.model && preset.model.startsWith('gpt-4o-realtime')
    ? 'gpt-realtime'
    : preset.model;
  const vectorStoreIds = (preset.knowledge_spaces || [])
    .map((binding) => binding.rag_space?.vector_store_id)
    .filter((id): id is string => Boolean(id));
  const knowledgeSpaceIds = (preset.knowledge_spaces || [])
    .map((binding) => binding.space_id)
    .filter((id): id is string => Boolean(id));
  return {
    model: normalizedModel,
    voice: preset.voice,
    instructions: preset.instructions,
    temperature: preset.temperature,
    max_response_output_tokens: preset.max_response_output_tokens,
    turn_detection: preset.turn_detection_enabled ? preset.turn_detection_config : null,
    rag_mode: preset.rag_mode,
    rag_enabled: preset.rag_enabled,
    knowledge_vector_store_ids: vectorStoreIds,
    knowledge_space_ids: knowledgeSpaceIds,
    rag_default_model: preset.rag_default_model || preset.chat_model || preset.model
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
      threshold: 0.75,
      prefix_padding_ms: 150,
      silence_duration_ms: 700
    }
  };
}

export async function getAllConfigPresets(): Promise<AgentConfigPreset[]> {
  let { data, error } = await supabase
    .from('va_agent_configs')
    .select(RAG_RELATION_SELECT)
    .order('created_at', { ascending: false });

  if (error && isRagRelationError(error)) {
    console.warn('[config-service] va_rag_* tables missing, loading presets without knowledge bindings');
    ({ data, error } = await supabase
      .from('va_agent_configs')
      .select('*')
      .order('created_at', { ascending: false }));
  }

  if (error) {
    console.error('Failed to fetch config presets:', error);
    throw error;
  }

  return (data || []).map(transformPresetRow);
}

export async function getDefaultConfigPreset(): Promise<AgentConfigPreset | null> {
  let { data, error } = await supabase
    .from('va_agent_configs')
    .select(RAG_RELATION_SELECT)
    .eq('is_default', true)
    .maybeSingle();

  if (error && isRagRelationError(error)) {
    console.warn('[config-service] Default preset fallback without RAG relations');
    ({ data, error } = await supabase
      .from('va_agent_configs')
      .select('*')
      .eq('is_default', true)
      .maybeSingle());
  }

  if (error) {
    console.error('Failed to fetch default config preset:', error);
    throw error;
  }

  return data ? transformPresetRow(data) : null;
}

export async function getConfigPresetById(id: string): Promise<AgentConfigPreset | null> {
  let { data, error } = await supabase
    .from('va_agent_configs')
    .select(RAG_RELATION_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error && isRagRelationError(error)) {
    console.warn(`[config-service] Preset ${id} fallback without RAG relations`);
    ({ data, error } = await supabase
      .from('va_agent_configs')
      .select('*')
      .eq('id', id)
      .maybeSingle());
  }

  if (error) {
    console.error('Failed to fetch config preset:', error);
    throw error;
  }

  return data ? transformPresetRow(data) : null;
}

export async function saveConfigPreset(
  preset: Partial<AgentConfigPreset>,
  userId: string,
  providerKeyId?: string
): Promise<AgentConfigPreset> {
  const { data, error } = await supabase
    .from('va_agent_configs')
    .insert({
      ...preset,
      user_id: userId,
      provider_key_id: providerKeyId ?? preset.provider_key_id ?? null,
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

export async function updateConfigPreset(
  id: string,
  updates: Partial<AgentConfigPreset>
): Promise<AgentConfigPreset> {
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

export async function setDefaultConfigPreset(id: string, userId: string): Promise<void> {
  await supabase
    .from('va_agent_configs')
    .update({ is_default: false })
    .eq('user_id', userId)
    .neq('id', id);

  const { error } = await supabase
    .from('va_agent_configs')
    .update({ is_default: true })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    console.error('Failed to set default config preset:', error);
    throw error;
  }
}

export async function getAgentTemplates(): Promise<AgentTemplate[]> {
  const { data, error } = await supabase
    .from('va_agent_presets')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to load presets:', error);
    throw error;
  }

  return (data || []) as AgentTemplate[];
}

export async function cloneTemplateToAgent(
  templateId: string,
  userId: string,
  providerKeyId: string,
  overrides?: Partial<AgentConfigPreset>
): Promise<AgentConfigPreset> {
  const { data: template, error: templateError } = await supabase
    .from('va_agent_presets')
    .select('*')
    .eq('id', templateId)
    .maybeSingle();

  if (templateError) {
    throw templateError;
  }
  if (!template) {
    throw new Error('Preset not found');
  }

  const payload = {
    user_id: userId,
    provider_key_id: providerKeyId,
    name: overrides?.name || template.name,
    instructions: overrides?.instructions || template.instructions,
    voice: overrides?.voice || template.voice,
    temperature: overrides?.temperature ?? template.temperature,
    model: overrides?.model || template.model,
    max_response_output_tokens: overrides?.max_response_output_tokens ?? 4096,
    turn_detection_enabled: overrides?.turn_detection_enabled ?? true,
    turn_detection_config: overrides?.turn_detection_config || template.turn_detection_config,
    is_default: overrides?.is_default ?? false
  };

  const { data, error } = await supabase
    .from('va_agent_configs')
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error('Failed to clone template:', error);
    throw error;
  }

  return data;
}

export async function getConfigTools(configId: string): Promise<SelectedTool[]> {
  const { data, error } = await supabase
    .from('va_agent_config_tools')
    .select('tool_name, tool_source, tool_id, connection_id, n8n_integration_id, metadata')
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
      connection_id: tool.connection_id || null,
      n8n_integration_id: tool.n8n_integration_id || null,
      metadata: tool.metadata ?? {}
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

function transformPresetRow(row: any): AgentConfigPreset {
  return {
    ...row,
    rag_enabled: row.rag_enabled ?? false,
    rag_mode: (row.rag_mode as RagMode) || 'assist',
    rag_default_model: row.rag_default_model || row.chat_model || row.model,
    knowledge_spaces: (row.knowledge_spaces || []).map((binding: any) => ({
      id: binding.id,
      agent_config_id: binding.agent_config_id,
      space_id: binding.space_id,
      created_at: binding.created_at,
      rag_space: binding.rag_space || null
    }))
  } as AgentConfigPreset;
}
