import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils.utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] hover:text-[var(--color-bg)]',
        destructive:
          'bg-[var(--color-red)] text-white hover:brightness-110',
        outline:
          'border border-[var(--color-border)] bg-transparent text-[var(--color-foreground)] hover:bg-[var(--color-surface-2)]',
        secondary:
          'bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] hover:bg-[var(--color-border)]',
        ghost:
          'text-[var(--color-foreground)] hover:bg-[var(--color-surface-2)]',
        link:
          'text-[var(--color-primary-light)] underline-offset-4 hover:underline',
        start:
          'bg-[var(--color-green)] text-black font-semibold hover:brightness-110',
        stop:
          'bg-[var(--color-red)] text-white hover:brightness-110',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm:      'h-7 px-3 py-1 text-xs',
        lg:      'h-10 px-6',
        icon:    'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

/** Props for the Button component, including CVA variant props and asChild forwarding. */
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
