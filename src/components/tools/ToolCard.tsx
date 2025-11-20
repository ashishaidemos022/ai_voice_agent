import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ToolCardProps {
  name: string;
  description?: string;
  category?: 'client' | 'server' | 'mcp';
  icon?: LucideIcon;
}

export function ToolCard({ name, description, category = 'client', icon: Icon }: ToolCardProps) {
  const categoryStyles = {
    client: 'border-l-4 border-l-blue-500 hover:border-l-blue-600',
    server: 'border-l-4 border-l-amber-500 hover:border-l-amber-600',
    mcp: 'border-l-4 border-l-green-500 hover:border-l-green-600',
  };

  const categoryColors = {
    client: 'text-blue-600',
    server: 'text-amber-600',
    mcp: 'text-green-600',
  };

  return (
    <motion.div
      whileHover={{ y: -2 }}
      className={cn(
        'bg-white rounded-lg border border-gray-200 p-3 transition-all cursor-default shadow-sm hover:shadow',
        categoryStyles[category]
      )}
    >
      <div className="flex items-start gap-3">
        {Icon && (
          <div className={cn('mt-0.5', categoryColors[category])}>
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
