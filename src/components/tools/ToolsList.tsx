import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ToolCard } from './ToolCard';
import { Badge } from '../ui/Badge';
import { Separator } from '../ui/Separator';

interface Tool {
  name: string;
  description?: string;
  source?: 'mcp' | 'n8n';
}

interface ToolsListProps {
  mcpTools: Tool[];
}

export function ToolsList({ mcpTools }: ToolsListProps) {
  const [expandedSections, setExpandedSections] = useState<{ [key: string]: boolean }>({
    mcp: true,
    n8n: true
  });
  const mcpOnly = mcpTools.filter(tool => tool.source !== 'n8n');
  const n8nTools = mcpTools.filter(tool => tool.source === 'n8n');

  const handleToggle = (section: 'mcp' | 'n8n') => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 mb-4 px-2">
        <Wrench className="w-4 h-4 text-gray-600" />
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Available Tools
        </h3>
      </div>

      <div className="space-y-2">
        <div>
          {renderToolSection({
            label: 'MCP Tools',
            count: mcpOnly.length,
            isExpanded: expandedSections.mcp,
            onToggle: () => handleToggle('mcp'),
            emptyLabel: 'No MCP tools connected',
            tools: mcpOnly,
            category: 'mcp'
          })}

          {n8nTools.length > 0 && (
            <>
              <Separator className="my-2" />
              {renderToolSection({
                label: 'n8n Automations',
                count: n8nTools.length,
                isExpanded: expandedSections.n8n,
                onToggle: () => handleToggle('n8n'),
                emptyLabel: 'No n8n webhooks configured',
                tools: n8nTools,
                category: 'n8n'
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function renderToolSection({
  label,
  count,
  isExpanded,
  onToggle,
  emptyLabel,
  tools,
  category
}: {
  label: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  emptyLabel: string;
  tools: Tool[];
  category: 'mcp' | 'n8n';
}) {
  return (
    <>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-2 py-2 hover:bg-gray-50 rounded-lg transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
          <span className="text-sm font-medium text-gray-700">{label}</span>
        </div>
        <Badge variant="success">{count}</Badge>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-2 pb-1 space-y-2">
              {tools.map(tool => (
                <ToolCard
                  key={tool.name}
                  name={tool.name}
                  description={tool.description}
                  category={category}
                />
              ))}
              {tools.length === 0 && (
                <p className="text-xs text-gray-500 px-2 py-4 text-center">
                  {emptyLabel}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
