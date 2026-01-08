import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'secondary' | 'outline';
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    const variants = {
      default: 'bg-cyan-500/15 text-cyan-200 border border-cyan-400/30',
      success: 'bg-emerald-500/15 text-emerald-200 border border-emerald-400/30',
      warning: 'bg-amber-500/15 text-amber-200 border border-amber-400/30',
      error: 'bg-rose-500/15 text-rose-200 border border-rose-400/30',
      secondary: 'bg-white/10 text-white/70 border border-white/10',
      outline: 'border border-white/20 text-white/70'
    };

    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
          variants[variant],
          className
        )}
        {...props}
      />
    );
  }
);

Badge.displayName = 'Badge';
