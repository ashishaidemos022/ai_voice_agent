import { supabase } from './supabase';

const MCP_API_BASE_URL = import.meta.env.VITE_MCP_API_BASE_URL || 'https://voiceaiagent.vercel.app';
const MCP_REFERRER = import.meta.env.VITE_MCP_REFERRER || 'https://ai-voice-agent-sage.vercel.app/';

export interface MCPConnectionCreateRequest {
  name: string;
  server_url: string;
  api_key: string;
  user_id: string;
}

export interface MCPConnectionTestRequest {
  connection_id: string;
}

export interface MCPListToolsRequest {
  connection_id: string;
  user_id: string;
}

export interface MCPExecuteToolRequest {
  connection_id: string;
  tool_name: string;
  parameters: Record<string, any>;
  user_id: string;
}

export interface MCPApiResponse<T = any> {
  success: boolean;
  data?: T;
  result?: any;
  error?: string;
  error_type?: string;
  message?: string;
  execution_time_ms?: number;
  tools?: any[];
  count?: number;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  parameters?: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export class MCPApiClient {
  private baseUrl: string;
  private sessionCache: Map<string, string> = new Map();
  private fallbackSessionId: string | null = null;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || MCP_API_BASE_URL;
  }

  private getSessionId(connectionId?: string) {
    if (connectionId) {
      if (!this.sessionCache.has(connectionId)) {
        this.sessionCache.set(connectionId, connectionId);
      }
      return this.sessionCache.get(connectionId)!;
    }
    if (!this.fallbackSessionId) {
      this.fallbackSessionId = crypto.randomUUID();
    }
    return this.fallbackSessionId;
  }

  private buildHeaders(connectionId?: string) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Referer: MCP_REFERRER,
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    };
    const sessionId = this.getSessionId(connectionId);
    headers['Mcp-Session-Id'] = sessionId;
    return headers;
  }

  private async getAuthHeaders(connectionId?: string) {
    const headers = this.buildHeaders(connectionId);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.warn('Failed to load Supabase session for MCP request', error);
    }
    return headers;
  }

  async createConnection(data: MCPConnectionCreateRequest): Promise<MCPApiResponse> {
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${this.baseUrl}/api/mcp/connections`, {
        method: 'POST',
        headers,
        referrer: MCP_REFERRER,
        referrerPolicy: 'strict-origin-when-cross-origin',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error('MCP API createConnection failed:', error);
      return {
        success: false,
        error: error.message || 'Failed to create connection',
        error_type: this.categorizeError(error),
      };
    }
  }

  async testConnection(data: MCPConnectionTestRequest): Promise<MCPApiResponse> {
    try {
      const headers = await this.getAuthHeaders(data.connection_id);
      const response = await fetch(`${this.baseUrl}/api/mcp/test`, {
        method: 'POST',
        headers,
        referrer: MCP_REFERRER,
        referrerPolicy: 'strict-origin-when-cross-origin',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error('MCP API testConnection failed:', error);
      return {
        success: false,
        error: error.message || 'Connection test failed',
        error_type: this.categorizeError(error),
      };
    }
  }

  async listTools(data: MCPListToolsRequest): Promise<MCPApiResponse<MCPToolDefinition[]>> {
    try {
      const headers = await this.getAuthHeaders(data.connection_id);
      const response = await fetch(`${this.baseUrl}/api/mcp/tools`, {
        method: 'POST',
        headers,
        referrer: MCP_REFERRER,
        referrerPolicy: 'strict-origin-when-cross-origin',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error('MCP API listTools failed:', error);
      return {
        success: false,
        error: error.message || 'Failed to list tools',
        error_type: this.categorizeError(error),
      };
    }
  }

  async executeTool(data: MCPExecuteToolRequest): Promise<MCPApiResponse> {
    try {
      const headers = await this.getAuthHeaders(data.connection_id);
      const response = await fetch(`${this.baseUrl}/api/mcp/execute`, {
        method: 'POST',
        headers,
        referrer: MCP_REFERRER,
        referrerPolicy: 'strict-origin-when-cross-origin',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error('MCP API executeTool failed:', error);
      return {
        success: false,
        error: error.message || 'Tool execution failed',
        error_type: this.categorizeError(error),
      };
    }
  }

  private categorizeError(error: any): string {
    const message = error.message?.toLowerCase() || '';

    if (message.includes('failed to fetch') || message.includes('networkerror')) {
      return 'network';
    }

    if (message.includes('timeout') || message.includes('timed out')) {
      return 'timeout';
    }

    if (message.includes('401') || message.includes('403') || message.includes('authentication')) {
      return 'auth';
    }

    if (message.includes('websocket') || message.includes('connection')) {
      return 'connection';
    }

    return 'unknown';
  }
}

export const mcpApiClient = new MCPApiClient();
