import { useState, useEffect } from 'react';
import { Plus, Trash2, Power, Check, AlertCircle, Loader2, RefreshCw, ChevronDown, ChevronRight, Database, Cloud, Folder, Mail, BarChart, Wrench, Sparkles, Hammer } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { MCPClient, MCPConnection, MCPTool } from '../../lib/mcp-client';
import { mcpApiClient } from '../../lib/mcp-api-client';
import { useAuth } from '../../context/AuthContext';
import { RightPanel } from '../layout/RightPanel';
import { Button } from '../ui/Button';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Separator } from '../ui/Separator';

interface MCPPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectionsChanged?: () => void;
}

interface ConnectionWithTools extends MCPConnection {
  tools?: MCPTool[];
  toolCount?: number;
}

const categoryIcons: Record<string, any> = {
  'Database': Database,
  'API': Cloud,
  'File System': Folder,
  'Communication': Mail,
  'Analytics': BarChart,
  'Utility': Wrench,
  'Custom': Sparkles,
  'default': Hammer
};

export function MCPPanel({ isOpen, onClose, onConnectionsChanged }: MCPPanelProps) {
  const { vaUser } = useAuth();
  const [connections, setConnections] = useState<ConnectionWithTools[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [syncingConnectionId, setSyncingConnectionId] = useState<string | null>(null);
  const [expandedConnectionId, setExpandedConnectionId] = useState<string | null>(null);
  const [connectionTools, setConnectionTools] = useState<Record<string, MCPTool[]>>({});

  const [formData, setFormData] = useState({
    name: '',
    server_url: '',
    api_key: ''
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<{ type: 'success' | 'error' | 'testing' | 'warning'; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadConnections();
    }
  }, [isOpen]);

  const fetchConnectionWithRetry = async (connectionId: string, attempts = 3): Promise<MCPConnection> => {
    let lastError: any;
    for (let i = 0; i < attempts; i++) {
      const { data, error } = await supabase
        .from('va_mcp_connections')
        .select('*')
        .eq('id', connectionId)
        .single();

      if (data && !error) return data as MCPConnection;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw lastError || new Error('Connection not found');
  };

  const loadConnections = async () => {
    setIsLoading(true);
    try {
      const { data: connectionsData, error: connError } = await supabase
        .from('va_mcp_connections')
        .select('*')
        .order('created_at', { ascending: false });

      if (connError) throw connError;

      const connectionsWithToolCounts = await Promise.all(
        (connectionsData || []).map(async (conn) => {
          const { count } = await supabase
            .from('va_mcp_tools')
            .select('*', { count: 'exact', head: true })
            .eq('connection_id', conn.id)
            .eq('is_enabled', true);

          return {
            ...conn,
            toolCount: count || 0
          };
        })
      );

      setConnections(connectionsWithToolCounts);
    } catch (error: any) {
      console.error('Failed to load connections:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusVariant = (status?: string) => {
    switch (status) {
      case 'active':
      case 'connected':
        return 'success' as const;
      case 'pending':
      case 'syncing':
        return 'warning' as const;
      case 'error':
        return 'error' as const;
      default:
        return 'secondary' as const;
    }
  };

  const getStatusLabel = (status?: string) => {
    if (!status) return 'unknown';
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const loadConnectionTools = async (connectionId: string) => {
    try {
      const { data: tools, error } = await supabase
        .from('va_mcp_tools')
        .select('*')
        .eq('connection_id', connectionId)
        .order('tool_name');

      if (error) throw error;

      setConnectionTools(prev => ({
        ...prev,
        [connectionId]: tools || []
      }));
    } catch (error) {
      console.error('Failed to load tools:', error);
    }
  };

  const handleTestConnection = async () => {
    setTestStatus({ type: 'testing', message: 'Validating connection details...' });
    setFormError(null);

    if (!formData.name.trim() || !formData.server_url.trim()) {
      setTestStatus({ type: 'error', message: 'Connection name and server URL are required to test' });
      return;
    }

    if (!formData.server_url.startsWith('https://')) {
      setTestStatus({
        type: 'error',
        message: 'Invalid URL. MCP servers must use HTTPS protocol.'
      });
      return;
    }

    if (!vaUser?.id) {
      setTestStatus({
        type: 'error',
        message: 'User profile not loaded yet. Please try again.'
      });
      return;
    }

    try {
      setTestStatus({ type: 'testing', message: 'Creating temporary connection...' });

      const createResult = await mcpApiClient.createConnection({
        name: `${formData.name} (Test)`,
        server_url: formData.server_url,
        api_key: formData.api_key.trim() ? formData.api_key : null,
        user_id: vaUser.id
      });

      if (!createResult.success || !createResult.data?.id) {
        throw new Error(createResult.error || 'Failed to create test connection');
      }

      const tempConnectionId = createResult.data.id;

      try {
        setTestStatus({ type: 'testing', message: 'Testing connection...' });

        const testResult = await mcpApiClient.testConnection({ connection_id: tempConnectionId });

        await supabase
          .from('va_mcp_connections')
          .delete()
          .eq('id', tempConnectionId);

        if (testResult.success) {
          setTestStatus({
            type: 'success',
            message: testResult.message || 'Connection test successful!'
          });
        } else {
          setTestStatus({
            type: 'error',
            message: testResult.error || 'Connection test failed'
          });
        }
      } catch (testError: any) {
        await supabase
          .from('va_mcp_connections')
          .delete()
          .eq('id', tempConnectionId);
        throw testError;
      }
    } catch (error: any) {
      setTestStatus({
        type: 'error',
        message: error.message || 'Connection test failed'
      });
    }
  };

  const handleAddConnection = async () => {
    setFormError(null);
    setTestStatus(null);

    if (!formData.name.trim() || !formData.server_url.trim()) {
      setFormError('Connection name and server URL are required');
      return;
    }

    if (!formData.server_url.startsWith('https://')) {
      setFormError('Invalid URL. MCP servers must use HTTPS protocol.');
      return;
    }

    if (!vaUser?.id) {
      setFormError('User profile not loaded yet. Please try again.');
      return;
    }

    let shouldClearStatus = true;
    let createdStatus: string | undefined;
    try {
      setTestStatus({ type: 'testing', message: 'Creating connection...' });
      const createResult = await mcpApiClient.createConnection({
        name: formData.name,
        server_url: formData.server_url,
        api_key: formData.api_key.trim() ? formData.api_key : null,
        user_id: vaUser.id
      });

      if (!createResult.success || !createResult.data?.id) {
        const message = createResult.error || 'Failed to create connection';
        setTestStatus({ type: 'error', message });
        setFormError(message);
        return;
      }

      createdStatus = createResult.data.status;
      const isPending = createdStatus === 'pending';

      if (isPending) {
        setTestStatus({
          type: 'warning',
          message: 'Connection saved and awaiting verification. Once your MCP server is reachable, click Refresh Connection to rerun the health check and sync tools.'
        });
        shouldClearStatus = false;
      } else {
        setTestStatus({ type: 'testing', message: 'Connection created. Syncing tools...' });
        const syncOk = await testAndSyncConnection(createResult.data.id);
        if (syncOk) {
          setTestStatus({ type: 'success', message: 'Connection verified and tools synced.' });
        } else {
          setTestStatus({
            type: 'warning',
            message: 'Connection created, but the MCP server did not finish syncing. Use Refresh Connection once it is ready.'
          });
          shouldClearStatus = false;
        }
      }

      setFormData({ name: '', server_url: '', api_key: '' });
      if (!isPending) {
        setShowAddForm(false);
      }
      await loadConnections();
      onConnectionsChanged?.();
      if (shouldClearStatus) {
        setTestStatus(null);
      }
    } catch (error: any) {
      console.error('Failed to add connection:', error);
      setFormError(error.message || 'Failed to add connection');
      setTestStatus({ type: 'error', message: error.message || 'Failed to add connection' });
    }
  };

  const testAndSyncConnection = async (connectionId: string) => {
    setSyncingConnectionId(connectionId);
    let success = false;

    try {
      const connectionData = await fetchConnectionWithRetry(connectionId);

      const client = new MCPClient(connectionData);
      const testResult = await client.testConnection();

      if (testResult.success && testResult.tools) {
        await supabase
          .from('va_mcp_connections')
          .update({
            status: 'active',
            last_health_check: new Date().toISOString(),
            error_message: null
          })
          .eq('id', connectionId);

        await supabase
          .from('va_mcp_tools')
          .delete()
          .eq('connection_id', connectionId);

        const toolsToInsert = testResult.tools.map(tool => ({
          connection_id: connectionId,
          tool_name: tool.tool_name,
          description: tool.description,
          parameters_schema: tool.parameters_schema,
          is_enabled: true,
          category: tool.category,
          icon: tool.icon
        }));

        if (toolsToInsert.length > 0) {
          await supabase.from('va_mcp_tools').insert(toolsToInsert);
        }
        success = true;
      } else {
        await supabase
          .from('va_mcp_connections')
          .update({
            status: 'error',
            error_message: testResult.message
          })
          .eq('id', connectionId);
      }
    } catch (error: any) {
      await supabase
        .from('va_mcp_connections')
        .update({
          status: 'error',
          error_message: error.message || 'Connection test failed'
        })
        .eq('id', connectionId);
    } finally {
      setSyncingConnectionId(null);
    }
    return success;
  };

  const handleSyncTools = async (connectionId: string) => {
    setSyncingConnectionId(connectionId);
    try {
      await testAndSyncConnection(connectionId);
      await loadConnections();
      if (expandedConnectionId === connectionId) {
        await loadConnectionTools(connectionId);
      }
      onConnectionsChanged?.();
    } finally {
      setSyncingConnectionId(null);
    }
  };

  const handleToggleConnection = async (connection: ConnectionWithTools) => {
    try {
      await supabase
        .from('va_mcp_connections')
        .update({ is_enabled: !connection.is_enabled })
        .eq('id', connection.id);

      await loadConnections();
      onConnectionsChanged?.();
    } catch (error) {
      console.error('Failed to toggle connection:', error);
    }
  };

  const handleToggleExpand = async (connectionId: string) => {
    if (expandedConnectionId === connectionId) {
      setExpandedConnectionId(null);
    } else {
      setExpandedConnectionId(connectionId);
      if (!connectionTools[connectionId]) {
        await loadConnectionTools(connectionId);
      }
    }
  };

  const handleDeleteConnection = async (connectionId: string) => {
    if (!confirm('Are you sure you want to delete this connection?')) {
      return;
    }

    try {
      await supabase
        .from('va_mcp_connections')
        .delete()
        .eq('id', connectionId);

      await loadConnections();
      onConnectionsChanged?.();
    } catch (error) {
      console.error('Failed to delete connection:', error);
    }
  };

  const getCategoryIcon = (category?: string) => {
    const IconComponent = categoryIcons[category || 'default'] || Hammer;
    return IconComponent;
  };

  return (
    <RightPanel
      isOpen={isOpen}
      onClose={onClose}
      title="MCP Connections"
      subtitle="Manage external tool servers"
      width="640px"
    >
      <div className="p-6 space-y-6">
        {showAddForm ? (
          <Card className="bg-slate-950/80 border border-white/10">
            <CardHeader>
              <h3 className="text-lg font-semibold text-white">Add New Connection</h3>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  Connection Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-white/15 rounded-lg bg-slate-900/70 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-300 text-sm"
                  placeholder="e.g., Production Database Tools"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  Server HTTPS URL <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  value={formData.server_url}
                  onChange={(e) => setFormData({ ...formData, server_url: e.target.value })}
                  className="w-full px-3 py-2 border border-white/15 rounded-lg bg-slate-900/70 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-300 text-sm"
                  placeholder="https://your-mcp-server.com/api/mcp"
                />
                <p className="text-xs text-white/50 mt-1">
                  Must start with <code className="bg-white/10 px-1 rounded">https://</code>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  API Key <span className="text-white/50">(optional)</span>
                </label>
                <input
                  type="password"
                  value={formData.api_key}
                  onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                  className="w-full px-3 py-2 border border-white/15 rounded-lg bg-slate-900/70 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-300 text-sm"
                  placeholder="Enter API key if required"
                />
              </div>

              {testStatus && (
                <div className={`px-4 py-3 rounded-lg text-sm flex items-center gap-2 ${
                  testStatus.type === 'success'
                    ? 'bg-emerald-500/10 border border-emerald-400/30 text-emerald-200'
                    : testStatus.type === 'error'
                      ? 'bg-rose-500/10 border border-rose-400/30 text-rose-200'
                      : testStatus.type === 'warning'
                        ? 'bg-amber-500/10 border border-amber-400/30 text-amber-200'
                        : 'bg-cyan-500/10 border border-cyan-400/30 text-cyan-200'
                }`}>
                  {testStatus.type === 'testing' && <Loader2 className="w-4 h-4 animate-spin" />}
                  {testStatus.type === 'success' && <Check className="w-4 h-4" />}
                  {testStatus.type === 'error' && <AlertCircle className="w-4 h-4" />}
                  {testStatus.type === 'warning' && <AlertCircle className="w-4 h-4" />}
                  {testStatus.message}
                </div>
              )}

              {formError && (
                <div className="px-4 py-3 bg-rose-500/10 border border-rose-400/30 rounded-lg text-rose-200 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {formError}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={testStatus?.type === 'testing'}
                  loading={testStatus?.type === 'testing'}
                >
                  Test Connection
                </Button>
                <Button
                  onClick={handleAddConnection}
                  disabled={testStatus?.type === 'testing'}
                  className="flex-1"
                >
                  Add Connection
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddForm(false);
                    setFormError(null);
                    setTestStatus(null);
                    setFormData({ name: '', server_url: '', api_key: '' });
                  }}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full px-4 py-6 border-2 border-dashed border-white/15 rounded-xl hover:border-cyan-400/60 hover:bg-cyan-500/10 transition-all flex items-center justify-center gap-2 text-white/70 hover:text-white group"
          >
            <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
            <span className="font-medium">Add New MCP Connection</span>
          </button>
        )}

        <Card className="bg-slate-900/60 border border-white/10">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-cyan-300 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-slate-200">
                <p className="font-semibold mb-1 text-white">About MCP Connections</p>
                <p className="text-xs text-white/60">
                  MCP servers expose tools via HTTPS APIs. Your API keys are encrypted and handled securely.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : connections.length === 0 ? (
          <div className="text-center py-12">
            <Hammer className="w-12 h-12 text-white/40 mx-auto mb-3" />
            <p className="text-white/70 font-medium">No MCP connections configured</p>
            <p className="text-sm text-white/50 mt-1">
              Add your first connection to enable external tools
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {connections.map((connection) => (
              <Card key={connection.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <button
                          onClick={() => handleToggleExpand(connection.id)}
                          className="p-1 hover:bg-white/10 rounded transition-colors"
                        >
                          {expandedConnectionId === connection.id ? (
                            <ChevronDown className="w-4 h-4 text-white/70" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-white/70" />
                          )}
                        </button>
                        <h3 className="text-base font-semibold text-white">{connection.name}</h3>
                        <Badge variant={getStatusVariant(connection.status)}>
                          {getStatusLabel(connection.status)}
                        </Badge>
                        {!connection.is_enabled && (
                          <Badge variant="warning">Disabled</Badge>
                        )}
                      </div>

                      <p className="text-xs text-white/60 mb-2 ml-9 font-mono">{connection.server_url}</p>

                      {connection.status === 'error' && connection.error_message && (
                        <div className="px-3 py-2 bg-rose-500/10 border border-rose-400/30 rounded text-xs text-rose-200 mb-2 ml-9">
                          {connection.error_message}
                        </div>
                      )}
                      {connection.status === 'pending' && (
                        <div className="px-3 py-2 bg-amber-500/10 border border-amber-400/30 rounded text-xs text-amber-200 mb-2 ml-9">
                          Connection is waiting for the MCP server to come online. Click <strong>Refresh Connection</strong> once your endpoint responds to finish syncing tools.
                        </div>
                      )}

                      <div className="flex items-center gap-4 text-xs text-white/50 ml-9">
                        <span className="font-medium text-white/70">{connection.toolCount || 0} tool(s)</span>
                        {connection.last_health_check && (
                          <span>
                            Last checked: {new Date(connection.last_health_check).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSyncTools(connection.id)}
                        disabled={syncingConnectionId === connection.id}
                        loading={syncingConnectionId === connection.id}
                        title="Sync tools"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleConnection(connection)}
                        className={connection.is_enabled ? 'text-emerald-300' : 'text-white/40'}
                        title={connection.is_enabled ? 'Disable' : 'Enable'}
                      >
                        <Power className="w-4 h-4" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteConnection(connection.id)}
                        className="text-rose-300 hover:bg-rose-500/10"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {expandedConnectionId === connection.id && connectionTools[connection.id] && (
                    <>
                      <Separator className="my-3" />
                      <div>
                        <h4 className="text-sm font-semibold text-white/80 mb-3">Available Tools</h4>
                        {connectionTools[connection.id].length === 0 ? (
                          <p className="text-sm text-white/50">No tools found</p>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            {connectionTools[connection.id].map((tool) => {
                              const IconComponent = getCategoryIcon(tool.category);
                              return (
                                <div
                                  key={tool.id}
                                  className="px-3 py-2 bg-white/5 rounded-lg border border-white/10"
                                >
                                  <div className="flex items-start gap-2">
                                    <IconComponent className="w-4 h-4 text-cyan-300 mt-0.5 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-white truncate">{tool.tool_name}</p>
                                      <p className="text-xs text-white/50 truncate">{tool.description}</p>
                                      {tool.category && (
                                        <Badge variant="default" className="mt-1">
                                          {tool.category}
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </RightPanel>
  );
}
