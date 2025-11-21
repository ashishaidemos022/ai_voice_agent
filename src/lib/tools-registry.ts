import { supabase } from './supabase';
import { mcpApiClient } from './mcp-api-client';

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  execute: (params: any) => Promise<any>;
  executionType: 'mcp';
  connectionId?: string;
}

export let mcpTools: Tool[] = [];
export let selectedToolNames: string[] | null = null;

export function getToolByName(name: string): Tool | undefined {
  return mcpTools.find(tool => tool.name === name);
}

export function getToolSchemas() {
  const availableTools = selectedToolNames === null
    ? mcpTools
    : mcpTools.filter(tool => selectedToolNames!.includes(tool.name));

  // If a stored selection points to tools that no longer exist, fall back to all available
  if (selectedToolNames !== null && availableTools.length === 0) {
    console.warn('No matching tools for selection; defaulting to all available MCP tools');
  }

  const toolsToReturn = selectedToolNames === null || availableTools.length > 0 ? availableTools : mcpTools;

  return toolsToReturn.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }));
}

export function setSelectedTools(toolNames: string[] | null) {
  selectedToolNames = toolNames;
  console.log(`🔧 Tool selection updated: ${toolNames === null ? 'All MCP tools' : `${toolNames.length} MCP tools selected`}`);
}

export async function loadMCPTools(configId?: string): Promise<void> {
  try {
    const { data: connections, error: connError } = await supabase
      .from('va_mcp_connections')
      .select('id')
      .eq('is_enabled', true)
      .eq('status', 'active');

    if (connError) {
      console.error('Failed to load MCP connections:', connError);
      return;
    }

    if (!connections || connections.length === 0) {
      console.log('No active MCP connections found');
      mcpTools = [];
      return;
    }

    const { data: tools, error: toolsError } = await supabase
      .from('va_mcp_tools')
      .select('*')
      .eq('is_enabled', true)
      .in('connection_id', connections.map(c => c.id));

    if (toolsError) {
      console.error('Failed to load MCP tools:', toolsError);
      return;
    }

    mcpTools = (tools || []).map((mcpTool: any) => ({
      name: mcpTool.tool_name,
      description: mcpTool.description,
      parameters: mcpTool.parameters_schema,
      executionType: 'mcp',
      connectionId: mcpTool.connection_id,
      execute: async (params: any) => {
        try {
          const result = await mcpApiClient.executeTool({
            connection_id: mcpTool.connection_id,
            tool_name: mcpTool.tool_name,
            parameters: params
          });

          if (!result.success) {
            throw new Error(result.error || 'MCP tool execution failed');
          }

          return result.data || result.result;
        } catch (error: any) {
          throw error;
        }
      }
    }));

    console.log(`✅ Loaded ${mcpTools.length} MCP tool(s) from ${connections.length} connection(s)`);

    if (configId) {
      await loadToolSelectionForConfig(configId);
    }
  } catch (error) {
    console.error('Error loading MCP tools:', error);
    mcpTools = [];
  }
}

export async function loadToolSelectionForConfig(configId: string): Promise<void> {
  try {
    const { data: selectedTools, error } = await supabase
      .from('va_agent_config_tools')
      .select('tool_name')
      .eq('config_id', configId);

    if (error) {
      console.error('Failed to load tool selection:', error);
      selectedToolNames = null;
      return;
    }

    if (!selectedTools || selectedTools.length === 0) {
      selectedToolNames = null;
      console.log('🔧 No tool selection found, using all available tools');
    } else {
      selectedToolNames = selectedTools.map(t => t.tool_name);
      console.log(`🔧 Loaded tool selection: ${selectedToolNames.length} tools selected`);
    }
  } catch (error) {
    console.error('Error loading tool selection:', error);
    selectedToolNames = null;
  }
}

export async function executeTool(
  toolName: string,
  params: any,
  sessionId: string,
  messageId?: string
): Promise<any> {
  const tool = getToolByName(toolName);
  if (!tool) {
    throw new Error(`Tool not found: ${toolName}`);
  }

  const startTime = Date.now();
  let result: any;
  let status: 'success' | 'error' = 'success';
  let errorMessage: string | undefined;

  try {
    // Enforce execute_sql shape: always { query: string }
    if (toolName === 'execute_sql') {
      const raw = typeof params === 'string' ? params : (params?.query ?? params?.statement ?? params?.sql ?? '');
      params = { query: String(raw || '') };
    }

    result = await tool.execute(params);
  } catch (error: any) {
    status = 'error';
    errorMessage = error.message;
    result = { error: error.message };
  }

  const executionTimeMs = Date.now() - startTime;

  await supabase.from('va_tool_executions').insert({
    message_id: messageId || null,
    session_id: sessionId,
    tool_name: toolName,
    input_params: params,
    output_result: result,
    execution_time_ms: executionTimeMs,
    status,
    error_message: errorMessage,
    execution_type: tool.executionType
  });

  return result;
}

export function getAllTools(): Tool[] {
  return mcpTools;
}
