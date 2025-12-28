import { supabase } from './supabase';
import { mcpApiClient } from './mcp-api-client';
import { normalizeMCPArguments, JSONSchema, resolveSchemaDefinition } from './mcp-normalizer';
import { triggerN8NWebhook } from './n8n-service';
import { buildN8NToolName, normalizeIdentifier } from './tool-utils';

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
let selectedMcpToolNames: string[] | null = null;
let selectedWebhookToolNames: string[] | null = null;

export type SerializedToolDefinition = {
  name: string;
  description?: string | null;
  parameters?: JSONSchema | null;
  execution_type: 'mcp' | 'webhook';
  connection_id?: string | null;
  metadata?: Record<string, any> | null;
  source?: 'mcp' | 'n8n' | null;
  owner_user_id?: string | null;
};

type WebhookParameterDefinition = {
  key: string;
  label?: string;
  description?: string;
  type?: 'string' | 'number' | 'integer' | 'boolean';
  required?: boolean;
  example?: string;
};

interface N8NSelectionInfo {
  integrationId: string;
  metadata?: Record<string, any>;
}

interface ToolSelectionState {
  mcpToolNames: string[] | null;
  n8nToolNames: string[] | null;
  n8nSelections: N8NSelectionInfo[];
}

export interface ToolExecutionContext {
  sessionId?: string;
  chatSessionId?: string;
  messageId?: string;
  chatMessageId?: string;
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

function filterToolsBySelection(tools: Tool[]): { tools: Tool[]; fellBack: boolean } {
  const filtered = tools.filter(tool => {
    if (tool.executionType === 'mcp') {
      if (selectedMcpToolNames === null) return true;
      return selectedMcpToolNames.includes(tool.name);
    }
    if (tool.executionType === 'webhook') {
      if (selectedWebhookToolNames === null) return true;
      return selectedWebhookToolNames.includes(tool.name);
    }
    return true;
  });

  const hasMcpSelection = Array.isArray(selectedMcpToolNames) && (selectedMcpToolNames?.length ?? 0) > 0;
  const hasWebhookSelection = Array.isArray(selectedWebhookToolNames) && (selectedWebhookToolNames?.length ?? 0) > 0;
  const hasMcpMatch = filtered.some(tool => tool.executionType === 'mcp');
  const hasWebhookMatch = filtered.some(tool => tool.executionType === 'webhook');

  const fellBack = (hasMcpSelection && !hasMcpMatch) || (hasWebhookSelection && !hasWebhookMatch);
  return {
    tools: fellBack ? tools : filtered,
    fellBack
  };
}

export function getToolSchemas() {
  const { tools: filteredTools, fellBack } = filterToolsBySelection(mcpTools);

  if (fellBack) {
    console.warn('No matching tools for stored selection; defaulting to all available tools');
  }

  return filteredTools.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }));
}

export async function loadMCPTools(configId?: string, userId?: string): Promise<void> {
  try {
    let selectionState: ToolSelectionState | null = null;

    if (configId) {
      selectionState = await loadToolSelectionForConfig(configId, userId);
    } else {
      selectedMcpToolNames = null;
      selectedWebhookToolNames = null;
    }

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
      const n8nTools = await loadN8NWebhookTools(configId, selectionState);
      registeredTools = [...registeredTools, ...n8nTools];
      applyWebhookSelection(selectionState, n8nTools);
    } else {
      selectedWebhookToolNames = null;
    }

    mcpTools = registeredTools;
  } catch (error) {
    console.error('Error loading MCP tools:', error);
    mcpTools = [];
    selectedMcpToolNames = null;
    selectedWebhookToolNames = null;
  }
}

export function registerToolsFromServer(serialized: SerializedToolDefinition[] | null | undefined) {
  if (!Array.isArray(serialized) || serialized.length === 0) {
    console.warn('[MCP] No serialized tools provided from server payload');
    mcpTools = [];
    selectedMcpToolNames = null;
    selectedWebhookToolNames = null;
    return;
  }

  const fallbackSchema: JSONSchema = {
    type: 'object',
    properties: {},
    additionalProperties: true
  };

  mcpTools = serialized.map((tool) => {
    const executionType = tool.execution_type;
    const resolvedSchema =
      tool.parameters && typeof tool.parameters === 'object'
        ? tool.parameters
        : fallbackSchema;
    const connectionId = tool.connection_id || undefined;
    const ownerUserId = tool.owner_user_id || undefined;
    const metadata = tool.metadata || undefined;
    return {
      name: tool.name,
      description: tool.description || '',
      parameters: resolvedSchema,
      executionType,
      connectionId,
      source: tool.source || undefined,
      metadata,
      execute:
        executionType === 'mcp'
          ? async (params: any) => {
              if (!connectionId) {
                throw new Error('MCP tool is missing connection information');
              }
              const userId = ownerUserId || (metadata as any)?.userId || (metadata as any)?.user_id || '';
              const result = await mcpApiClient.executeTool({
                connection_id: connectionId,
                tool_name: tool.name,
                parameters: params,
                user_id: userId
              });

              if (!result.success) {
                throw new Error(result.error || 'MCP tool execution failed');
              }

              return result.data || result.result;
            }
          : async () => {
              return {};
            }
    };
  });

  selectedMcpToolNames = mcpTools.filter((tool) => tool.executionType === 'mcp').map((tool) => tool.name);
  selectedWebhookToolNames = mcpTools
    .filter((tool) => tool.executionType === 'webhook')
    .map((tool) => tool.name);
}

const SELECTION_SENTINEL = '__none__';

export async function loadToolSelectionForConfig(
  configId: string,
  userId?: string
): Promise<ToolSelectionState | null> {
  try {
    const { data: selectedTools, error } = await supabase
      .from('va_agent_config_tools')
      .select('tool_name, tool_source, n8n_integration_id, metadata, user_id')
      .eq('config_id', configId);

    if (error) {
      console.error('Failed to load tool selection:', error);
      selectedMcpToolNames = null;
      selectedWebhookToolNames = null;
      return null;
    }

    const ownedTools =
      userId && selectedTools.some(tool => tool.user_id === userId)
        ? selectedTools.filter(tool => tool.user_id === userId)
        : selectedTools;

    console.log('[tools] Loaded tool selections', {
      configId,
      requestedUserId: userId,
      rowCount: selectedTools.length,
      ownedCount: ownedTools.length
    });

    const nonSentinel = ownedTools.filter(tool => tool.tool_name !== SELECTION_SENTINEL);
    const hasSentinel = ownedTools.some(tool => tool.tool_name === SELECTION_SENTINEL);

    if (nonSentinel.length === 0) {
      selectedMcpToolNames = [];
      selectedWebhookToolNames = [];
      console.log('🔧 Tool selection explicitly cleared; no tools enabled', {
        configId,
        sentinel: hasSentinel
      });
      return {
        mcpToolNames: [],
        n8nToolNames: [],
        n8nSelections: []
      };
    }

    const mcpRows = nonSentinel.filter(tool => tool.tool_source === 'mcp');
    const n8nRows = nonSentinel.filter(tool => tool.tool_source === 'n8n');

    selectedMcpToolNames = mcpRows.map(tool => tool.tool_name);
    selectedWebhookToolNames = n8nRows.map(tool => tool.tool_name);

    console.log('🔧 Loaded tool selections', {
      mcp: selectedMcpToolNames.length,
      n8n: selectedWebhookToolNames.length
    });

    return {
      mcpToolNames: selectedMcpToolNames,
      n8nToolNames: selectedWebhookToolNames,
      n8nSelections: n8nRows
        .filter(tool => !!tool.n8n_integration_id)
        .map(tool => ({
          integrationId: tool.n8n_integration_id as string,
          metadata: tool.metadata || {}
        }))
    };
  } catch (error) {
    console.error('Error loading tool selection:', error);
    selectedMcpToolNames = null;
    selectedWebhookToolNames = null;
    return null;
  }
}

export async function executeTool(
  toolName: string,
  params: any,
  context: ToolExecutionContext
): Promise<any> {
  if (!context.sessionId && !context.chatSessionId) {
    throw new Error('Tool execution requires a voice session or chat session context');
  }
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
        sessionId: context.chatSessionId || context.sessionId || null
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
    message_id: context.messageId || null,
    chat_message_id: context.chatMessageId || null,
    session_id: context.sessionId || null,
    chat_session_id: context.chatSessionId || null,
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
  return filterToolsBySelection(mcpTools).tools;
}

function applyWebhookSelection(selection: ToolSelectionState | null, webhookTools: Tool[]) {
  if (!selection || !selection.n8nToolNames) {
    selectedWebhookToolNames = null;
    return;
  }

  const allowedIds = new Set(
    (selection.n8nSelections || [])
      .map(sel => sel.integrationId)
      .filter(Boolean)
  );

  if (!allowedIds.size) {
    selectedWebhookToolNames = null;
    return;
  }

  const matchingNames = webhookTools
    .filter(tool => tool.executionType === 'webhook' && tool.metadata?.integrationId)
    .filter(tool => allowedIds.has(tool.metadata!.integrationId as string))
    .map(tool => tool.name);

  if (matchingNames.length === 0) {
    console.warn('Stored n8n selection did not match any active integrations; defaulting to all webhook tools');
    selectedWebhookToolNames = null;
    return;
  }

  selectedWebhookToolNames = matchingNames;
}

async function loadN8NWebhookTools(configId: string, selection?: ToolSelectionState | null): Promise<Tool[]> {
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

    const restrictToSelection = Boolean(selection?.n8nToolNames);
    const allowedIds = restrictToSelection
      ? new Set((selection?.n8nSelections || []).map(sel => sel.integrationId).filter(Boolean))
      : null;
    const metadataByIntegration = new Map(
      (selection?.n8nSelections || []).map(sel => [sel.integrationId, sel.metadata || {}])
    );

    let integrations = (data || []).filter((integration: any) => integration.enabled);

    if (restrictToSelection) {
      integrations = integrations.filter((integration: any) => allowedIds?.has(integration.id));
    }

    return integrations.map((integration: any) => {
      const toolName = buildN8NToolName(integration.name, integration.id);
      const selectionMetadata = metadataByIntegration.get(integration.id);
      const payloadParams = selectionMetadata?.payloadParameters as WebhookParameterDefinition[] | undefined;

      return {
        name: toolName,
        description: integration.description || `Trigger n8n workflow "${integration.name}" via webhook`,
        executionType: 'webhook',
        source: 'n8n',
        metadata: {
          integrationId: integration.id
        },
        parameters: buildWebhookSchema(payloadParams),
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

function buildWebhookSchema(customParams?: WebhookParameterDefinition[]): JSONSchema {
  const payloadSchema: JSONSchema = {
    type: 'object',
    properties: {},
    additionalProperties: true
  };

  if (Array.isArray(customParams) && customParams.length > 0) {
    const properties: Record<string, JSONSchema> = {};
    const requiredFields: string[] = [];

    customParams.forEach(param => {
      if (!param.key) return;
      properties[param.key] = {
        type: param.type || 'string',
        description: param.description || param.label,
        examples: param.example ? [param.example] : undefined
      };
      if (param.required) {
        requiredFields.push(param.key);
      }
    });

    payloadSchema.properties = properties;
    if (requiredFields.length > 0) {
      payloadSchema.required = requiredFields;
    }
  }

  return {
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
      payload: payloadSchema,
      metadata: {
        type: 'object',
        description: 'Optional metadata such as related ticket IDs or human-friendly notes'
      }
    },
    required: ['payload']
  };
}
