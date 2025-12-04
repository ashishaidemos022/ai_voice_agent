import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ToolCardProps {
  name: string;
  description?: string;
  category?: 'mcp' | 'n8n';
  icon?: LucideIcon;
}

export function ToolCard({ name, description, category = 'mcp', icon: Icon }: ToolCardProps) {
  const categoryStyles: Record<string, string> = {
    mcp: 'border-l-4 border-l-green-500 hover:border-l-green-600',
    n8n: 'border-l-4 border-l-orange-500 hover:border-l-orange-600'
  };

  const categoryColors: Record<string, string> = {
    mcp: 'text-green-600',
    n8n: 'text-orange-500'
  };

  return (
    <motion.div
      whileHover={{ y: -2 }}
      className={cn(
        'bg-white rounded-lg border border-gray-200 p-3 transition-all cursor-default shadow-sm hover:shadow',
        categoryStyles[category] || categoryStyles.mcp
      )}
    >
      <div className="flex items-start gap-3">
        {Icon && (
          <div className={cn('mt-0.5', categoryColors[category] || categoryColors.mcp)}>
            <Icon className="w-4 h-4" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
          {description && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{description}</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
