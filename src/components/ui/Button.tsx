import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost' | 'outline' | 'destructive';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', loading, disabled, children, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#90E5E6]/60 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-50 disabled:cursor-not-allowed';

    const variants = {
      default: 'bg-[#90E5E6] text-slate-950 hover:brightness-105 shadow-[0_10px_30px_rgba(144,229,230,0.35)] active:scale-[0.98]',
      ghost: 'text-[#90E5E6] hover:text-[#90E5E6] hover:bg-[#90E5E6]/10 active:scale-[0.98]',
      outline: 'border border-[#90E5E6] bg-transparent text-[#90E5E6] hover:bg-[#90E5E6]/10 active:scale-[0.98]',
      destructive: 'bg-[#90E5E6] text-slate-950 hover:brightness-105 shadow-[0_10px_30px_rgba(144,229,230,0.35)] active:scale-[0.98]',
    };

    const sizes = {
      xs: 'px-2 py-1 text-xs',
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2 text-base',
      lg: 'px-6 py-3 text-lg',
    } as const;

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
