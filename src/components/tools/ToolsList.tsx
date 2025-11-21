import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ToolCard } from './ToolCard';
import { Badge } from '../ui/Badge';
import { Separator } from '../ui/Separator';

interface Tool {
  name: string;
  description?: string;
}

interface ToolsListProps {
  mcpTools: Tool[];
}

export function ToolsList({ mcpTools }: ToolsListProps) {
  const [isExpanded, setIsExpanded] = useState(true);

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
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center justify-between px-2 py-2 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <div className="flex items-center gap-2">
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              )}
              <span className="text-sm font-medium text-gray-700">MCP Tools</span>
            </div>
            <Badge variant="success">{mcpTools.length}</Badge>
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
                  {mcpTools.map((tool) => (
                    <ToolCard
                      key={tool.name}
                      name={tool.name}
                      description={tool.description}
                      category="mcp"
                    />
                  ))}
                  {mcpTools.length === 0 && (
                    <p className="text-xs text-gray-500 px-2 py-4 text-center">
                      No tools available
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <Separator className="my-2" />
        </div>
      </div>
    </div>
  );
}
