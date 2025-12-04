import { useState, useEffect } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Plus, Trash2, Wrench } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getConfigTools, updateConfigTools, SelectedTool } from '../../lib/config-service';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useAgentState } from '../../state/agentState';
import { buildN8NToolName } from '../../lib/tool-utils';

interface ToolSelectionPanelProps {
  configId: string | null;
  onToolsChanged?: () => void;
}

interface MCPToolInfo {
  id: string;
  tool_name: string;
  description: string;
  connection_id: string;
  connection_name: string;
  category?: string;
}

interface N8NIntegrationInfo {
  id: string;
  name: string;
  description?: string | null;
  toolName: string;
}

type PayloadParamType = 'string' | 'number' | 'integer' | 'boolean';

interface PayloadParameterRow {
  id: string;
  key: string;
  type: PayloadParamType;
  description: string;
  required: boolean;
  example: string;
}

export function ToolSelectionPanel({ configId, onToolsChanged }: ToolSelectionPanelProps) {
  const persistedSelection = useAgentState((state) =>
    configId ? state.toolSelections[configId] : undefined
  );
  const storedMcpSelection = persistedSelection?.mcp ?? [];
  const storedN8nSelection = persistedSelection?.n8n ?? [];
  const setToolsForConfig = useAgentState((state) => state.setToolsForConfig);
  const [selectedMcpTools, setSelectedMcpTools] = useState<Set<string>>(new Set(storedMcpSelection));
  const [selectedN8nTools, setSelectedN8nTools] = useState<Set<string>>(new Set(storedN8nSelection));
  const [mcpTools, setMcpTools] = useState<MCPToolInfo[]>([]);
  const [n8nIntegrations, setN8nIntegrations] = useState<N8NIntegrationInfo[]>([]);
  const [n8nParameters, setN8nParameters] = useState<Record<string, PayloadParameterRow[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isN8NExpanded, setIsN8NExpanded] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);
  const createParameterRow = (): PayloadParameterRow => ({
    id: crypto.randomUUID(),
    key: '',
    type: 'string',
    description: '',
    required: false,
    example: ''
  });
  const persistSelections = (
    nextMcp = selectedMcpTools,
    nextN8n = selectedN8nTools
  ) => {
    if (!configId) return;
    setToolsForConfig(configId, {
      mcp: Array.from(nextMcp),
      n8n: Array.from(nextN8n)
    });
  };

  const fetchMcpTools = async (): Promise<MCPToolInfo[]> => {
    const { data: connections } = await supabase
      .from('va_mcp_connections')
      .select('id, name')
      .eq('is_enabled', true)
      .eq('status', 'active');

    if (!connections || connections.length === 0) {
      return [];
    }

    const { data: tools } = await supabase
      .from('va_mcp_tools')
      .select('id, tool_name, description, connection_id, category')
      .eq('is_enabled', true)
      .in('connection_id', connections.map(c => c.id));

    if (!tools) {
      return [];
    }

    return tools.map(tool => ({
      ...tool,
      connection_name: connections.find(c => c.id === tool.connection_id)?.name || 'Unknown'
    }));
  };

  const fetchN8nIntegrations = async (cfgId: string): Promise<N8NIntegrationInfo[]> => {
    const { data } = await supabase
      .from('va_n8n_integrations')
      .select('id, name, description, enabled')
      .eq('config_id', cfgId)
      .eq('enabled', true);

    if (!data || data.length === 0) {
      return [];
    }

    return data.map(integration => ({
      id: integration.id,
      name: integration.name,
      description: integration.description,
      toolName: buildN8NToolName(integration.name, integration.id)
    }));
  };

  useEffect(() => {
    setSelectedMcpTools(new Set(storedMcpSelection));
    setSelectedN8nTools(new Set(storedN8nSelection));
  }, [storedMcpSelection, storedN8nSelection, configId]);

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      if (!configId) {
        setSelectedMcpTools(new Set());
        setSelectedN8nTools(new Set());
        setN8nParameters({});
        setMcpTools([]);
        setN8nIntegrations([]);
        setHasChanges(false);
        return;
      }

      setIsLoading(true);
      try {
        const [availableMcpTools, availableN8n, toolsFromConfig] = await Promise.all([
          fetchMcpTools(),
          fetchN8nIntegrations(configId),
          getConfigTools(configId)
        ]);

        if (!isMounted) return;

        setMcpTools(availableMcpTools);
        setN8nIntegrations(availableN8n);

        const storeState = useAgentState.getState();
        const storedSelection = storeState.toolSelections[configId];
        const storedMcp = storedSelection?.mcp ?? [];
        const storedN8n = storedSelection?.n8n ?? [];

        const savedMcp = toolsFromConfig.filter(t => t.tool_source === 'mcp').map(t => t.tool_name);
        const savedN8n = toolsFromConfig.filter(t => t.tool_source === 'n8n').map(t => t.tool_name);

        const defaultMcp = savedMcp.length === 0
          ? availableMcpTools.map(t => t.tool_name)
          : savedMcp;
        const defaultN8n = savedN8n.length === 0
          ? availableN8n.map(t => t.toolName)
          : savedN8n;

        const nextMcpSelection = storedMcp.length ? storedMcp : defaultMcp;
        const nextN8nSelection = storedN8n.length ? storedN8n : defaultN8n;

        setSelectedMcpTools(new Set(nextMcpSelection));
        setSelectedN8nTools(new Set(nextN8nSelection));

        const params: Record<string, PayloadParameterRow[]> = {};
        toolsFromConfig
          .filter(tool => tool.tool_source === 'n8n' && tool.n8n_integration_id)
          .forEach(tool => {
            const payloadParameters = Array.isArray(tool.metadata?.payloadParameters)
              ? tool.metadata.payloadParameters as Partial<PayloadParameterRow>[]
              : [];
            params[tool.n8n_integration_id as string] = payloadParameters.map((param) => ({
              id: crypto.randomUUID(),
              key: param.key ?? '',
              type: (param.type as PayloadParamType) || 'string',
              description: param.description ?? '',
              required: Boolean(param.required),
              example: param.example ?? ''
            }));
          });
        setN8nParameters(params);

        if (!storedSelection) {
          setToolsForConfig(configId, {
            mcp: nextMcpSelection,
            n8n: nextN8nSelection
          });
        }
        setHasChanges(false);
      } catch (error) {
        console.error('Failed to load MCP tools or selection:', error);
        if (isMounted) {
          setSelectedMcpTools(new Set());
          setSelectedN8nTools(new Set());
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [configId]);

  const syncMcpSelection = (nextSet: Set<string>) => {
    setSelectedMcpTools(nextSet);
    persistSelections(nextSet, selectedN8nTools);
  };

  const syncN8nSelection = (nextSet: Set<string>) => {
    setSelectedN8nTools(nextSet);
    persistSelections(selectedMcpTools, nextSet);
  };

  const handleToggleTool = (toolName: string) => {
    const newSelected = new Set(selectedMcpTools);
    if (newSelected.has(toolName)) {
      newSelected.delete(toolName);
    } else {
      newSelected.add(toolName);
    }
    syncMcpSelection(newSelected);
    setHasChanges(true);
  };

  const handleSelectAll = () => {
    syncMcpSelection(new Set(mcpTools.map(t => t.tool_name)));
    setHasChanges(true);
  };

  const handleDeselectAll = () => {
    syncMcpSelection(new Set());
    setHasChanges(true);
  };

  const handleToggleN8n = (toolName: string) => {
    const updated = new Set(selectedN8nTools);
    if (updated.has(toolName)) {
      updated.delete(toolName);
    } else {
      updated.add(toolName);
    }
    syncN8nSelection(updated);
    setHasChanges(true);
  };

  const handleSelectAllN8n = () => {
    syncN8nSelection(new Set(n8nIntegrations.map(integration => integration.toolName)));
    setHasChanges(true);
  };

  const handleDeselectAllN8n = () => {
    syncN8nSelection(new Set());
    setHasChanges(true);
  };

  const handleAddPayloadParam = (integrationId: string) => {
    setN8nParameters((current) => {
      const existing = current[integrationId] || [];
      return {
        ...current,
        [integrationId]: [...existing, createParameterRow()]
      };
    });
    setHasChanges(true);
  };

  const handlePayloadParamChange = (
    integrationId: string,
    paramId: string,
    field: keyof PayloadParameterRow,
    value: string | boolean
  ) => {
    setN8nParameters((current) => ({
      ...current,
      [integrationId]: (current[integrationId] || []).map((param) =>
        param.id === paramId ? { ...param, [field]: value } : param
      )
    }));
    setHasChanges(true);
  };

  const handleRemovePayloadParam = (integrationId: string, paramId: string) => {
    setN8nParameters((current) => ({
      ...current,
      [integrationId]: (current[integrationId] || []).filter((param) => param.id !== paramId)
    }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!configId) return;

    setIsSaving(true);
    try {
      const toolsToSave: SelectedTool[] = [];

      mcpTools.forEach(tool => {
        if (selectedMcpTools.has(tool.tool_name)) {
          toolsToSave.push({
            tool_name: tool.tool_name,
            tool_source: 'mcp',
            tool_id: tool.id,
            connection_id: tool.connection_id
          });
        }
      });

      n8nIntegrations.forEach(integration => {
        if (selectedN8nTools.has(integration.toolName)) {
          const payloadRows = n8nParameters[integration.id] || [];
          toolsToSave.push({
            tool_name: integration.toolName,
            tool_source: 'n8n',
            n8n_integration_id: integration.id,
            metadata: {
              payloadParameters: payloadRows.map(row => ({
                key: row.key,
                type: row.type,
                description: row.description,
                required: row.required,
                example: row.example
              }))
            }
          });
        }
      });

      await updateConfigTools(configId, toolsToSave);
      setHasChanges(false);
      onToolsChanged?.();
    } catch (error) {
      console.error('Failed to save tool selection:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!configId) {
    return (
      <div className="px-4 py-8 text-center text-gray-500">
        <Wrench className="w-10 h-10 mx-auto mb-2 text-gray-300" />
        <p className="text-sm">Select a configuration to manage tools</p>
      </div>
    );
  }

  const mcpSelectedCount = mcpTools.filter(t => selectedMcpTools.has(t.tool_name)).length;
  const n8nSelectedCount = n8nIntegrations.filter(integration => selectedN8nTools.has(integration.toolName)).length;
  const totalSelected = mcpSelectedCount + n8nSelectedCount;
  const totalAvailable = mcpTools.length + n8nIntegrations.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Tool Selection</h3>
          <p className="text-xs text-gray-500 mt-1">
            {totalSelected} of {totalAvailable} tools selected
          </p>
        </div>
        {hasChanges && (
          <Button
            size="sm"
            onClick={handleSave}
            loading={isSaving}
            disabled={isSaving}
          >
            Save Changes
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          <Card>
            <CardContent className="p-0">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-600" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-600" />
                  )}
                  <Wrench className="w-4 h-4 text-purple-600" />
                  <span className="text-sm font-medium text-gray-800">MCP Tools</span>
                  <Badge variant="secondary">{mcpSelectedCount}/{mcpTools.length}</Badge>
                </div>
                <div className="flex gap-1">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); handleSelectAll(); }}
                    className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
                  >
                    All
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); handleDeselectAll(); }}
                    className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
                  >
                    None
                  </span>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-gray-200 p-3 space-y-2">
                  {mcpTools.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      No MCP tools available. Enable an MCP connection to select tools.
                    </p>
                  ) : (
                    mcpTools.map(tool => (
                      <label
                        key={tool.id}
                        className="flex items-start gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedMcpTools.has(tool.tool_name)}
                          onChange={() => handleToggleTool(tool.tool_name)}
                          className="mt-0.5 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-gray-800">{tool.tool_name}</div>
                            {tool.category && (
                              <Badge variant="default" className="text-xs">{tool.category}</Badge>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 line-clamp-2">{tool.description}</div>
                          <div className="text-xs text-gray-400 mt-1">
                            from {tool.connection_name}
                          </div>
                        </div>
                        {selectedMcpTools.has(tool.tool_name) && (
                          <Check className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                        )}
                      </label>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setIsN8NExpanded(!isN8NExpanded)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {isN8NExpanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-600" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-600" />
                  )}
                  <Wrench className="w-4 h-4 text-orange-500" />
                  <span className="text-sm font-medium text-gray-800">n8n Automations</span>
                  <Badge variant="secondary">{n8nSelectedCount}/{n8nIntegrations.length}</Badge>
                </div>
                <div className="flex gap-1">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); handleSelectAllN8n(); }}
                    className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
                  >
                    All
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); handleDeselectAllN8n(); }}
                    className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
                  >
                    None
                  </span>
                </div>
              </div>

              {isN8NExpanded && (
                <div className="border-t border-gray-200 p-3 space-y-3">
                  {n8nIntegrations.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      No n8n webhooks are connected to this agent. Use the n8n panel to register one.
                    </p>
                  ) : (
                    n8nIntegrations.map(integration => {
                      const isSelected = selectedN8nTools.has(integration.toolName);
                      const paramRows = n8nParameters[integration.id] || [];
                      return (
                        <div key={integration.id} className="space-y-2">
                          <label
                            className="flex items-start gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleN8n(integration.toolName)}
                              className="mt-0.5 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-medium text-gray-800">{integration.name}</div>
                                <Badge variant="outline" className="text-xs">{integration.toolName}</Badge>
                              </div>
                              {integration.description && (
                                <div className="text-xs text-gray-500">{integration.description}</div>
                              )}
                              <div className="text-xs text-gray-400 mt-1">
                                Tool name: <code className="text-[10px]">{integration.toolName}</code>
                              </div>
                            </div>
                            {isSelected && (
                              <Check className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                            )}
                          </label>
                          {isSelected && (
                            <div className="ml-7 border border-orange-200 rounded-lg bg-orange-50/30 p-3 space-y-3">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-xs font-semibold text-orange-900 uppercase tracking-wide">Payload parameters</p>
                                  <p className="text-[11px] text-orange-700">
                                    These keys become part of the webhook request body.
                                  </p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  onClick={() => handleAddPayloadParam(integration.id)}
                                >
                                  <Plus className="w-3 h-3 mr-1" />
                                  Add key
                                </Button>
                              </div>
                              {paramRows.length === 0 ? (
                                <p className="text-[11px] text-gray-600">
                                  Requests will send an empty payload. Add keys if your workflow expects structured data.
                                </p>
                              ) : (
                                paramRows.map(row => (
                                  <div key={row.id} className="border border-gray-200 rounded-lg bg-white p-3 space-y-2">
                                    <div className="flex items-center gap-2">
                                      <input
                                        className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
                                        placeholder="field_key"
                                        value={row.key}
                                        onChange={(e) => handlePayloadParamChange(integration.id, row.id, 'key', e.target.value)}
                                      />
                                      <select
                                        className="rounded border border-gray-300 px-2 py-1 text-xs"
                                        value={row.type}
                                        onChange={(e) => handlePayloadParamChange(integration.id, row.id, 'type', e.target.value as PayloadParamType)}
                                      >
                                        <option value="string">string</option>
                                        <option value="number">number</option>
                                        <option value="integer">integer</option>
                                        <option value="boolean">boolean</option>
                                      </select>
                                      <label className="flex items-center gap-1 text-[11px] text-gray-600">
                                        <input
                                          type="checkbox"
                                          checked={row.required}
                                          onChange={(e) => handlePayloadParamChange(integration.id, row.id, 'required', e.target.checked)}
                                          className="w-3 h-3 rounded border-gray-300 text-primary focus:ring-primary"
                                        />
                                        Required
                                      </label>
                                      <button
                                        type="button"
                                        className="text-gray-400 hover:text-red-500 transition-colors"
                                        onClick={() => handleRemovePayloadParam(integration.id, row.id)}
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <input
                                        className="rounded border border-gray-300 px-2 py-1 text-xs"
                                        placeholder="Example value"
                                        value={row.example}
                                        onChange={(e) => handlePayloadParamChange(integration.id, row.id, 'example', e.target.value)}
                                      />
                                      <input
                                        className="rounded border border-gray-300 px-2 py-1 text-xs"
                                        placeholder="Description (optional)"
                                        value={row.description}
                                        onChange={(e) => handlePayloadParamChange(integration.id, row.id, 'description', e.target.value)}
                                      />
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {hasChanges && (
        <Card className="border-2 border-orange-300 bg-orange-50">
          <CardContent className="p-3">
            <p className="text-xs text-orange-800">
              You have unsaved tool selection changes. Click "Save Changes" to apply them.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
