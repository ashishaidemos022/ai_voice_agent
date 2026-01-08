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
    mcp: 'border-l-4 border-l-emerald-400 hover:border-l-emerald-300',
    n8n: 'border-l-4 border-l-amber-400 hover:border-l-amber-300'
  };

  const categoryColors: Record<string, string> = {
    mcp: 'text-emerald-200',
    n8n: 'text-amber-200'
  };

  return (
    <motion.div
      whileHover={{ y: -2 }}
      className={cn(
        'bg-slate-950/70 rounded-lg border border-white/10 p-4 min-h-[44px] transition-all cursor-default shadow-sm hover:shadow-lg hover:border-white/20',
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
          <p className="text-sm font-medium text-white/90 truncate">{name}</p>
          {description && (
            <p className="text-xs text-white/50 mt-0.5 line-clamp-2">{description}</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
