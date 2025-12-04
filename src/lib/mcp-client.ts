import { mcpApiClient, MCPApiResponse } from './mcp-api-client';
import { normalizeMCPArguments, JSONSchema, resolveSchemaDefinition } from './mcp-normalizer';

export interface MCPConnection {
  id: string;
  name: string;
  server_url: string;
  api_key: string;
  user_id: string;
  is_enabled: boolean;
  status: 'active' | 'error' | 'disconnected' | 'pending' | 'connected' | 'syncing';
  last_health_check?: string;
  metadata: Record<string, any>;
  error_message?: string;
  connection_type?: string;
}

export interface MCPTool {
  id: string;
  connection_id: string;
  tool_name: string;
  description: string;
  parameters_schema: JSONSchema;
  is_enabled: boolean;
  category?: string;
  icon?: string;
  usage_count?: number;
  last_used_at?: string;
  average_execution_ms?: number;
}

export interface MCPToolExecutionRequest {
  tool_name: string;
  parameters: Record<string, any>;
  parameters_schema?: JSONSchema;
  session_context?: Record<string, any>;
}

export interface MCPToolExecutionResponse {
  success: boolean;
  result?: any;
  error?: string;
  execution_time_ms?: number;
}


export class MCPClient {
  private connection: MCPConnection;

  constructor(connection: MCPConnection) {
    this.connection = connection;
  }

  private async callApi(method: 'test' | 'list_tools' | 'execute', additionalData?: any): Promise<MCPApiResponse> {
    try {
      switch (method) {
        case 'test':
          return await mcpApiClient.testConnection({ connection_id: this.connection.id });

        case 'list_tools':
          return await mcpApiClient.listTools({
            connection_id: this.connection.id,
            user_id: this.connection.user_id
          });

        case 'execute':
          if (!additionalData?.tool_name) {
            return {
              success: false,
              error: 'Missing tool_name for execute operation',
              error_type: 'validation'
            };
          }
          return await mcpApiClient.executeTool({
            connection_id: this.connection.id,
            tool_name: additionalData.tool_name,
            parameters: additionalData.parameters || {},
            user_id: this.connection.user_id
          });

        default:
          return {
            success: false,
            error: `Unknown operation: ${method}`,
            error_type: 'validation'
          };
      }
    } catch (error: any) {
      console.error(`MCP API ${method} failed:`, error);
      return {
        success: false,
        error: error.message || 'Unknown error occurred',
        error_type: 'unknown'
      };
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string; tools?: MCPTool[] }> {
    try {
      const testResult = await this.callApi('test');

      if (!testResult.success) {
        return {
          success: false,
          message: testResult.error || 'Connection test failed'
        };
      }

      const toolsResult = await this.callApi('list_tools');

      if (!toolsResult.success) {
        return {
          success: true,
          message: 'Connected but failed to list tools',
          tools: []
        };
      }

      const tools = this.mapToolsFromApi(toolsResult.tools || []);

      return {
        success: true,
        message: `Connected successfully - found ${tools.length} tool(s)`,
        tools
      };
    } catch (error: any) {
      console.error('MCP connection test failed:', error);
      return {
        success: false,
        message: error.message || 'Connection test failed'
      };
    }
  }

  async fetchAvailableTools(): Promise<MCPTool[]> {
    const response = await this.callApi('list_tools');

    if (!response.success) {
      const errorMessage = this.formatErrorMessage(response);
      throw new Error(errorMessage);
    }

    if (!response.tools || !Array.isArray(response.tools)) {
      throw new Error('Invalid response format from API - expected tools array');
    }

    return this.mapToolsFromApi(response.tools);
  }

  private mapToolsFromApi(tools: any[]): MCPTool[] {
    return tools.map((tool: any) => ({
      id: crypto.randomUUID(),
      connection_id: this.connection.id,
      tool_name: tool.name,
      description: tool.description || '',
      parameters_schema: resolveSchemaDefinition(tool.parameters),
      is_enabled: true,
      category: this.inferToolCategory(tool.name, tool.description),
      icon: this.inferToolIcon(tool.name, tool.description)
    }));
  }

  private inferToolCategory(name: string, description: string): string {
    const text = `${name} ${description}`.toLowerCase();

    if (text.includes('database') || text.includes('query') || text.includes('sql')) {
      return 'Database';
    } else if (text.includes('api') || text.includes('http') || text.includes('fetch')) {
      return 'API';
    } else if (text.includes('file') || text.includes('read') || text.includes('write')) {
      return 'File System';
    } else if (text.includes('email') || text.includes('message') || text.includes('notify')) {
      return 'Communication';
    } else if (text.includes('analytics') || text.includes('report') || text.includes('chart')) {
      return 'Analytics';
    }

    return 'Utility';
  }

  private inferToolIcon(name: string, description: string): string {
    const text = `${name} ${description}`.toLowerCase();

    if (text.includes('database') || text.includes('sql')) return 'database';
    if (text.includes('api') || text.includes('cloud')) return 'cloud';
    if (text.includes('file')) return 'folder';
    if (text.includes('email') || text.includes('mail')) return 'mail';
    if (text.includes('chart') || text.includes('analytics')) return 'bar-chart';
    if (text.includes('search')) return 'search';
    if (text.includes('calculate')) return 'calculator';
    if (text.includes('time') || text.includes('date')) return 'clock';

    return 'tool';
  }

  async executeTool(request: MCPToolExecutionRequest): Promise<MCPToolExecutionResponse> {
    const schema = resolveSchemaDefinition(request.parameters_schema);
    console.log('[MCPClient] Executing tool', {
      connectionId: this.connection.id,
      toolName: request.tool_name,
      rawParameters: request.parameters
    });
    const normalizedParameters = normalizeMCPArguments(
      request.tool_name,
      schema,
      request.parameters
    );
    console.log('[MCPClient] Normalized parameters', {
      toolName: request.tool_name,
      normalizedParameters
    });

    const response = await this.callApi('execute', {
      tool_name: request.tool_name,
      parameters: normalizedParameters
    });

    return {
      success: response.success,
      result: response.data || response.result,
      error: response.error,
      execution_time_ms: response.execution_time_ms
    };
  }

  private formatErrorMessage(response: MCPApiResponse): string {
    if (!response.error) {
      return 'Unknown error occurred';
    }

    const error = response.error;
    const errorType = response.error_type;

    if (errorType === 'timeout') {
      return 'Connection timed out. The MCP server is slow or unreachable.';
    }

    if (errorType === 'network') {
      return `Network error - cannot reach MCP server at ${this.connection.server_url}`;
    }

    if (errorType === 'connection') {
      return 'Connection failed. Verify the server URL is correct and the server is accessible.';
    }

    if (error.includes('401') || error.includes('403') || error.includes('Authentication')) {
      return 'Authentication failed. Check your API key.';
    }

    if (error.includes('404')) {
      return 'Server endpoint not found. Verify the server URL is correct.';
    }

    return error;
  }
}

export async function createMCPClient(connection: MCPConnection): Promise<MCPClient> {
  return new MCPClient(connection);
}
