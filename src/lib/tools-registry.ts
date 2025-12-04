import { supabase } from './supabase';
import { mcpApiClient } from './mcp-api-client';
import { normalizeMCPArguments, JSONSchema, resolveSchemaDefinition } from './mcp-normalizer';
import { triggerN8NWebhook } from './n8n-service';

export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: any) => Promise<any>;
  executionType: 'mcp' | 'webhook';
  connectionId?: string;
  source?: 'mcp' | 'n8n';
  metadata?: Record<string, any>;
}

export let mcpTools: Tool[] = [];
export let selectedToolNames: string[] | null = null;

function normalizeIdentifier(value: string | undefined | null): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findToolSchemaBySlug(slug?: string): Tool | undefined {
  if (!slug) return undefined;
  const normalizedSlug = normalizeIdentifier(slug);
  return mcpTools.find(tool => normalizeIdentifier(tool.name) === normalizedSlug);
}

function getFallbackSchemaForSlug(slug: string): JSONSchema | undefined {
  const lower = slug.toLowerCase();
  const isEmailTool = lower.includes('email') || lower.includes('mail');
  const isSendLike = /send|compose|draft|reply|forward/.test(lower);
  const isFetchLike = /fetch|list|get/.test(lower);

  if (isEmailTool && isSendLike && !isFetchLike) {
    return {
      type: 'object',
      properties: {
        recipient_email: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        cc: { type: 'string' },
        bcc: { type: 'string' }
      },
      required: ['recipient_email', 'body']
    };
  }
  return undefined;
}

function getSchemaForChildTool(slug: string): JSONSchema | undefined {
  const matchingTool = findToolSchemaBySlug(slug);
  if (matchingTool) return matchingTool.parameters;
  const fallback = getFallbackSchemaForSlug(slug);
  if (fallback) {
    console.log('[MCP] Using fallback schema for nested tool', { slug });
  }
  return fallback;
}

function getChildToolArrayKey(params: Record<string, any>): { key: 'tools' | 'tool_calls'; list: any[] } | null {
  if (Array.isArray(params.tools)) {
    return { key: 'tools', list: params.tools };
  }
  if (Array.isArray(params.tool_calls)) {
    return { key: 'tool_calls', list: params.tool_calls };
  }
  return null;
}

function pickArgumentsPayload(toolCall: Record<string, any>): { key: string; value: any } | null {
  if (toolCall.parameters !== undefined) {
    return { key: 'parameters', value: toolCall.parameters };
  }
  if (toolCall.arguments !== undefined) {
    return { key: 'arguments', value: toolCall.arguments };
  }
  if (toolCall.args !== undefined) {
    return { key: 'args', value: toolCall.args };
  }
  return null;
}

function normalizeNestedToolCalls(
  parentToolName: string,
  params: Record<string, any>
): Record<string, any> {
  if (!params || typeof params !== 'object') return params;

  const toolArrayInfo = getChildToolArrayKey(params);
  if (!toolArrayInfo) return params;

  const normalizedTools = toolArrayInfo.list.map((toolCall: any, index: number) => {
    if (!toolCall || typeof toolCall !== 'object') return toolCall;
    const slug: string | undefined =
      toolCall.tool_slug || toolCall.toolName || toolCall.tool_name || toolCall.slug;
    const argsInfo = pickArgumentsPayload(toolCall);
    const rawArgs = argsInfo?.value;

    if (!slug || rawArgs === undefined || !argsInfo) {
      return toolCall;
    }

    const schema = getSchemaForChildTool(slug);

    if (!schema) {
      console.warn('[MCP] Nested tool schema not found', { parentTool: parentToolName, childTool: slug });
      return toolCall;
    }

    console.log('[MCP] Normalizing nested tool call', {
      parentTool: parentToolName,
      childTool: slug,
      index,
      schemaKeys: schema?.properties ? Object.keys(schema.properties) : []
    });

    const normalizedArgs = normalizeMCPArguments(slug, schema, rawArgs);

    const updatedCall: Record<string, any> = {
      ...toolCall,
      [argsInfo.key]: normalizedArgs
    };

    if (argsInfo.key !== 'parameters' && toolCall.parameters !== undefined) {
      updatedCall.parameters = normalizedArgs;
    }
    if (argsInfo.key !== 'arguments' && toolCall.arguments !== undefined) {
      updatedCall.arguments = normalizedArgs;
    }
    if (argsInfo.key !== 'args' && toolCall.args !== undefined) {
      updatedCall.args = normalizedArgs;
    }

    return updatedCall;
  });

  return { ...params, [toolArrayInfo.key]: normalizedTools };
}

export function getToolByName(name: string): Tool | undefined {
  const directMatch = mcpTools.find(tool => tool.name === name);
  if (directMatch) return directMatch;

  const normalizedName = normalizeIdentifier(name);
  return mcpTools.find(tool => normalizeIdentifier(tool.name) === normalizedName);
}

export function getToolSchemas() {
  const availableTools = selectedToolNames === null
    ? mcpTools
    : mcpTools.filter(tool => {
        if (tool.executionType !== 'mcp') {
          return true;
        }
        return selectedToolNames!.includes(tool.name);
      });

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

    let registeredTools: Tool[] = [];

    if (connections && connections.length > 0) {
      const { data: tools, error: toolsError } = await supabase
        .from('va_mcp_tools')
        .select('*')
        .eq('is_enabled', true)
        .in('connection_id', connections.map(c => c.id));

      if (toolsError) {
        console.error('Failed to load MCP tools:', toolsError);
        return;
      }

      registeredTools = (tools || []).map((mcpTool: any) => ({
        name: mcpTool.tool_name,
        description: mcpTool.description,
        parameters: resolveSchemaDefinition(mcpTool.parameters_schema),
        executionType: 'mcp',
        connectionId: mcpTool.connection_id,
        source: 'mcp',
        execute: async (params: any) => {
          try {
            const result = await mcpApiClient.executeTool({
              connection_id: mcpTool.connection_id,
              tool_name: mcpTool.tool_name,
              parameters: params,
              user_id: mcpTool.user_id
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

      console.log(`✅ Loaded ${registeredTools.length} MCP tool(s) from ${connections.length} connection(s)`);
    } else {
      console.log('No active MCP connections found');
    }

    if (configId) {
      const n8nTools = await loadN8NWebhookTools(configId);
      registeredTools = [...registeredTools, ...n8nTools];
    }

    mcpTools = registeredTools;

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
  let normalizedParams: Record<string, any> = {};

  try {
    // Enforce execute_sql shape: always { query: string }
    if (toolName === 'execute_sql') {
      const raw = typeof params === 'string' ? params : (params?.query ?? params?.statement ?? params?.sql ?? '');
      params = { query: String(raw || '') };
    }

    console.log('[MCP] Normalizing tool arguments', {
      tool: tool.name,
      connectionId: tool.connectionId,
      rawParams: params
    });
    normalizedParams = normalizeMCPArguments(tool.name, tool.parameters, params);
    const nestedInfo = normalizedParams && typeof normalizedParams === 'object'
      ? getChildToolArrayKey(normalizedParams)
      : null;
    if (nestedInfo) {
      normalizedParams = normalizeNestedToolCalls(tool.name, normalizedParams);
    }
    console.log('[MCP] Normalized tool arguments', {
      tool: tool.name,
      normalizedParams
    });
    if (tool.executionType === 'webhook') {
      const integrationId = tool.metadata?.integrationId;
      if (!integrationId) {
        throw new Error('Missing integration metadata for webhook tool');
      }
      result = await triggerN8NWebhook({
        integrationId,
        payload: normalizedParams.payload ?? normalizedParams,
        summary: normalizedParams.summary,
        severity: normalizedParams.severity,
        metadata: normalizedParams.metadata,
        sessionId
      });
    } else {
      result = await tool.execute(normalizedParams);
    }
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
    input_params: normalizedParams,
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

async function loadN8NWebhookTools(configId: string): Promise<Tool[]> {
  try {
    const { data, error } = await supabase
      .from('va_n8n_integrations')
      .select('id, name, description, enabled')
      .eq('config_id', configId)
      .eq('enabled', true);

    if (error) {
      console.error('Failed to load n8n integrations', error);
      return [];
    }

    return (data || []).map((integration: any) => {
      const toolName = buildN8NToolName(integration.name, integration.id);
      return {
        name: toolName,
        description: integration.description || `Trigger n8n workflow "${integration.name}" via webhook`,
        executionType: 'webhook',
        source: 'n8n',
        metadata: {
          integrationId: integration.id
        },
        parameters: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'Short description of what needs to happen so n8n can branch correctly'
            },
            severity: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
              description: 'How urgent or important the trigger is'
            },
            payload: {
              type: 'object',
              description: 'Structured data to pass directly into the n8n workflow entry node'
            },
            metadata: {
              type: 'object',
              description: 'Optional metadata such as related ticket IDs or human-friendly notes'
            }
          },
          required: ['payload']
        },
        execute: async () => {
          return {};
        }
      };
    });
  } catch (error) {
    console.error('Unexpected error fetching n8n integrations', error);
    return [];
  }
}

function buildN8NToolName(name: string, id: string): string {
  const normalized = normalizeIdentifier(name) || 'n8n';
  const suffix = id.replace(/-/g, '').slice(-8);
  const truncated = normalized.slice(0, 30);
  return `trigger_n8n_${truncated}_${suffix}`;
}
