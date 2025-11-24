import { useState, useEffect } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Wrench } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getConfigTools, updateConfigTools, SelectedTool } from '../../lib/config-service';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useAgentState } from '../../state/agentState';

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

export function ToolSelectionPanel({ configId, onToolsChanged }: ToolSelectionPanelProps) {
  const persistedSelection = useAgentState((state) =>
    configId ? state.toolSelections[configId] ?? [] : []
  );
  const setToolsForConfig = useAgentState((state) => state.setToolsForConfig);
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set(persistedSelection));
  const [mcpTools, setMcpTools] = useState<MCPToolInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);

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

  useEffect(() => {
    setSelectedTools(new Set(persistedSelection));
  }, [persistedSelection, configId]);

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      if (!configId) {
        setSelectedTools(new Set());
        setMcpTools([]);
        setHasChanges(false);
        return;
      }

      setIsLoading(true);
      try {
        const [availableMcpTools, toolsFromConfig] = await Promise.all([
          fetchMcpTools(),
          getConfigTools(configId)
        ]);

        if (!isMounted) return;

        setMcpTools(availableMcpTools);

        const storeState = useAgentState.getState();
        const storedSelection = storeState.toolSelections[configId] ?? [];

        const savedToolNames = toolsFromConfig.map(t => t.tool_name);
        const defaultSelection = toolsFromConfig.length === 0
          ? availableMcpTools.map(t => t.tool_name)
          : savedToolNames;
        const nextSelection = storedSelection.length ? storedSelection : defaultSelection;

        setSelectedTools(new Set(nextSelection));
        if (!storedSelection.length) {
          setToolsForConfig(configId, nextSelection);
        }
        setHasChanges(false);
      } catch (error) {
        console.error('Failed to load MCP tools or selection:', error);
        if (isMounted) {
          setSelectedTools(new Set());
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

  const syncSelection = (nextSet: Set<string>) => {
    setSelectedTools(nextSet);
    if (configId) {
      setToolsForConfig(configId, Array.from(nextSet));
    }
  };

  const handleToggleTool = (toolName: string) => {
    const newSelected = new Set(selectedTools);
    if (newSelected.has(toolName)) {
      newSelected.delete(toolName);
    } else {
      newSelected.add(toolName);
    }
    syncSelection(newSelected);
    setHasChanges(true);
  };

  const handleSelectAll = () => {
    syncSelection(new Set(mcpTools.map(t => t.tool_name)));
    setHasChanges(true);
  };

  const handleDeselectAll = () => {
    syncSelection(new Set());
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!configId) return;

    setIsSaving(true);
    try {
      const toolsToSave: SelectedTool[] = [];

      mcpTools.forEach(tool => {
        if (selectedTools.has(tool.tool_name)) {
          toolsToSave.push({
            tool_name: tool.tool_name,
            tool_source: 'mcp',
            tool_id: tool.id,
            connection_id: tool.connection_id
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

  const mcpSelectedCount = mcpTools.filter(t => selectedTools.has(t.tool_name)).length;
  const totalSelected = mcpSelectedCount;
  const totalAvailable = mcpTools.length;

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
                          checked={selectedTools.has(tool.tool_name)}
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
                        {selectedTools.has(tool.tool_name) && (
                          <Check className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                        )}
                      </label>
                    ))
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
