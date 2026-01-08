import { useState, useEffect } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Plus, Trash2, Wrench } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getConfigTools, updateConfigTools, SelectedTool } from '../../lib/config-service';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useAgentState } from '../../state/agentState';
import { buildN8NToolName } from '../../lib/tool-utils';
import { useAuth } from '../../context/AuthContext';

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
  enabled?: boolean;
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
  const { vaUser } = useAuth();
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
    const { data, error } = await supabase
      .from('va_n8n_integrations')
      .select('id, name, description, enabled, webhook_url')
      .eq('config_id', cfgId);

    if (error) {
      console.error('Failed to load n8n integrations:', error);
      return [];
    }

    const integrations = (data || []).map(integration => ({
      id: integration.id,
      name: integration.name,
      description: integration.description,
      enabled: integration.enabled,
      toolName: buildN8NToolName(integration.name, integration.id)
    }));

    return integrations;
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
        console.log('[ToolSelectionPanel] Loaded tool context', {
          configId,
          availableMcp: availableMcpTools.length,
          availableN8n: availableN8n.length,
          fromConfig: toolsFromConfig.length
        });

        const storeState = useAgentState.getState();
        const storedSelection = storeState.toolSelections[configId];
        const storedMcp = storedSelection?.mcp ?? [];
        const storedN8n = storedSelection?.n8n ?? [];

        const selectionCleared = toolsFromConfig.some(
          tool => tool.tool_name === '__none__' || (tool.metadata as any)?.selectionCleared
        );
        const filteredTools = toolsFromConfig.filter(
          tool => tool.tool_source === 'mcp' || tool.tool_source === 'n8n'
        );

        const savedMcp = filteredTools.filter(t => t.tool_source === 'mcp').map(t => t.tool_name);
        const savedN8n = filteredTools.filter(t => t.tool_source === 'n8n').map(t => t.tool_name);

        const hasDbSelection = filteredTools.length > 0 || selectionCleared;

        const nextMcpSelection = selectionCleared
          ? []
          : hasDbSelection
            ? savedMcp
            : availableMcpTools.map(t => t.tool_name);
        const nextN8nSelection = selectionCleared
          ? []
          : hasDbSelection
            ? savedN8n
            : availableN8n.map(t => t.toolName);

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

        // Sync the persisted UI state to the DB-backed selection only when it differs to avoid loops.
        const mcpChanged = nextMcpSelection.length !== storedMcp.length || nextMcpSelection.some(name => !storedMcp.includes(name));
        const n8nChanged = nextN8nSelection.length !== storedN8n.length || nextN8nSelection.some(name => !storedN8n.includes(name));
        if (mcpChanged || n8nChanged) {
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
    if (!vaUser?.id) {
      console.error('Cannot save tool selection without an authenticated user');
      return;
    }

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

      console.log('[ToolSelectionPanel] Saving selection', {
        configId,
        mcpCount: toolsToSave.filter(t => t.tool_source === 'mcp').length,
        n8nCount: toolsToSave.filter(t => t.tool_source === 'n8n').length,
        mcpNames: toolsToSave.filter(t => t.tool_source === 'mcp').map(t => t.tool_name),
        n8nNames: toolsToSave.filter(t => t.tool_source === 'n8n').map(t => t.tool_name)
      });

      await updateConfigTools(configId, toolsToSave, vaUser.id);
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
      <div className="px-4 py-8 text-center text-white/50">
        <Wrench className="w-10 h-10 mx-auto mb-2 text-white/25" />
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
          <h3 className="text-sm font-semibold text-white">Tool Selection</h3>
          <p className="text-xs text-white/50 mt-1">
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
          <Loader2 className="w-6 h-6 text-cyan-300 animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          <Card className="bg-slate-900/40 border-white/10">
            <CardContent className="p-0">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-white/50" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-white/50" />
                  )}
                  <Wrench className="w-4 h-4 text-cyan-300" />
                  <span className="text-sm font-medium text-white">MCP Tools</span>
                  <Badge variant="secondary" className="bg-white/10 text-white/70 border border-white/10">
                    {mcpSelectedCount}/{mcpTools.length}
                  </Badge>
                </div>
                <div className="flex gap-1">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); handleSelectAll(); }}
                    className="px-2 py-1 text-xs text-cyan-200 hover:bg-white/5 rounded"
                  >
                    All
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); handleDeselectAll(); }}
                    className="px-2 py-1 text-xs text-white/50 hover:bg-white/5 rounded"
                  >
                    None
                  </span>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-white/10 p-3 space-y-2">
                  {mcpTools.length === 0 ? (
                    <p className="text-xs text-white/50">
                      No MCP tools available. Enable an MCP connection to select tools.
                    </p>
                  ) : (
                    mcpTools.map(tool => (
                      <label
                        key={tool.id}
                        className="flex items-start gap-3 p-2 hover:bg-white/5 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedMcpTools.has(tool.tool_name)}
                          onChange={() => handleToggleTool(tool.tool_name)}
                          className="mt-0.5 w-4 h-4 text-cyan-400 border-white/20 rounded focus:ring-cyan-400"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-white">{tool.tool_name}</div>
                            {tool.category && (
                              <Badge variant="default" className="text-xs bg-white/10 text-white/70 border border-white/10">
                                {tool.category}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-white/50 line-clamp-2">{tool.description}</div>
                          <div className="text-xs text-white/40 mt-1">
                            from {tool.connection_name}
                          </div>
                        </div>
                        {selectedMcpTools.has(tool.tool_name) && (
                          <Check className="w-4 h-4 text-emerald-300 flex-shrink-0 mt-0.5" />
                        )}
                      </label>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-slate-900/40 border-white/10">
            <CardContent className="p-0">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setIsN8NExpanded(!isN8NExpanded)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {isN8NExpanded ? (
                    <ChevronDown className="w-4 h-4 text-white/50" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-white/50" />
                  )}
                  <Wrench className="w-4 h-4 text-amber-300" />
                  <span className="text-sm font-medium text-white">n8n Automations</span>
                  <Badge variant="secondary" className="bg-white/10 text-white/70 border border-white/10">
                    {n8nSelectedCount}/{n8nIntegrations.length}
                  </Badge>
                </div>
                <div className="flex gap-1">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); handleSelectAllN8n(); }}
                    className="px-2 py-1 text-xs text-cyan-200 hover:bg-white/5 rounded"
                  >
                    All
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); handleDeselectAllN8n(); }}
                    className="px-2 py-1 text-xs text-white/50 hover:bg-white/5 rounded"
                  >
                    None
                  </span>
                </div>
              </div>

              {isN8NExpanded && (
                <div className="border-t border-white/10 p-3 space-y-3">
                  {n8nIntegrations.length === 0 ? (
                    <p className="text-xs text-white/50">
                      No n8n webhooks are connected to this agent. Use the n8n panel to register one.
                    </p>
                  ) : (
                    n8nIntegrations.map(integration => {
                      const isSelected = selectedN8nTools.has(integration.toolName);
                      const paramRows = n8nParameters[integration.id] || [];
                      return (
                        <div key={integration.id} className="space-y-2">
                          <label
                            className="flex items-start gap-3 p-2 hover:bg-white/5 rounded cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleN8n(integration.toolName)}
                              className="mt-0.5 w-4 h-4 text-cyan-400 border-white/20 rounded focus:ring-cyan-400"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-medium text-white">{integration.name}</div>
                                <Badge variant="outline" className="text-xs border-white/20 text-white/70">
                                  {integration.toolName}
                                </Badge>
                              </div>
                              {integration.description && (
                                <div className="text-xs text-white/50">{integration.description}</div>
                              )}
                              <div className="text-xs text-white/40 mt-1">
                                Tool name: <code className="text-[10px] text-white/60">{integration.toolName}</code>
                              </div>
                            </div>
                            {isSelected && (
                              <Check className="w-4 h-4 text-emerald-300 flex-shrink-0 mt-0.5" />
                            )}
                          </label>
                          {isSelected && (
                            <div className="ml-7 border border-amber-400/30 rounded-lg bg-amber-500/10 p-3 space-y-3">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-xs font-semibold text-amber-200 uppercase tracking-wide">Payload parameters</p>
                                  <p className="text-[11px] text-amber-200/80">
                                    These keys become part of the webhook request body.
                                  </p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  onClick={() => handleAddPayloadParam(integration.id)}
                                  className="text-amber-100 hover:text-white hover:bg-white/10"
                                >
                                  <Plus className="w-3 h-3 mr-1" />
                                  Add key
                                </Button>
                              </div>
                              {paramRows.length === 0 ? (
                                <p className="text-[11px] text-white/60">
                                  Requests will send an empty payload. Add keys if your workflow expects structured data.
                                </p>
                              ) : (
                                paramRows.map(row => (
                                  <div key={row.id} className="border border-white/10 rounded-lg bg-slate-900/70 p-3 space-y-2">
                                    <div className="flex items-center gap-2">
                                      <input
                                        className="flex-1 rounded border border-white/10 bg-slate-950 px-2 py-1 text-xs text-white placeholder:text-white/40"
                                        placeholder="field_key"
                                        value={row.key}
                                        onChange={(e) => handlePayloadParamChange(integration.id, row.id, 'key', e.target.value)}
                                      />
                                      <select
                                        className="rounded border border-white/10 bg-slate-950 px-2 py-1 text-xs text-white"
                                        value={row.type}
                                        onChange={(e) => handlePayloadParamChange(integration.id, row.id, 'type', e.target.value as PayloadParamType)}
                                      >
                                        <option value="string">string</option>
                                        <option value="number">number</option>
                                        <option value="integer">integer</option>
                                        <option value="boolean">boolean</option>
                                      </select>
                                      <label className="flex items-center gap-1 text-[11px] text-white/60">
                                        <input
                                          type="checkbox"
                                          checked={row.required}
                                          onChange={(e) => handlePayloadParamChange(integration.id, row.id, 'required', e.target.checked)}
                                          className="w-3 h-3 rounded border-white/20 text-cyan-400 focus:ring-cyan-400"
                                        />
                                        Required
                                      </label>
                                      <button
                                        type="button"
                                        className="text-white/40 hover:text-rose-300 transition-colors"
                                        onClick={() => handleRemovePayloadParam(integration.id, row.id)}
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <input
                                        className="rounded border border-white/10 bg-slate-950 px-2 py-1 text-xs text-white placeholder:text-white/40"
                                        placeholder="Example value"
                                        value={row.example}
                                        onChange={(e) => handlePayloadParamChange(integration.id, row.id, 'example', e.target.value)}
                                      />
                                      <input
                                        className="rounded border border-white/10 bg-slate-950 px-2 py-1 text-xs text-white placeholder:text-white/40"
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
        <Card className="border border-amber-400/50 bg-amber-500/10">
          <CardContent className="p-3">
            <p className="text-xs text-amber-100">
              You have unsaved tool selection changes. Click "Save Changes" to apply them.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
