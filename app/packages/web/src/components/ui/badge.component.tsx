import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils.utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-[var(--radius-sm)] border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[var(--color-primary)] text-white',
        secondary:
          'border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-foreground)]',
        destructive:
          'border-transparent bg-[var(--color-red)] text-white',
        outline:
          'border-[var(--color-border)] text-[var(--color-foreground)]',
        success:
          'border-transparent bg-[var(--color-green)] text-black',
        warning:
          'border-transparent bg-[var(--color-amber)] text-black',
        cyan:
          'border-transparent bg-[var(--color-cyan)] text-black',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

/** Props for the Badge component. */
export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

/** Small status label with configurable color variants. */
function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
