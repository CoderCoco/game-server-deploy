import * as React from 'react';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/** Sonner toast container pre-styled for the ops dashboard theme. */
function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-[var(--color-surface)] group-[.toaster]:text-[var(--color-foreground)] group-[.toaster]:border-[var(--color-border)] group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-[var(--color-muted-foreground)]',
          actionButton: 'group-[.toast]:bg-[var(--color-primary)] group-[.toast]:text-white',
          cancelButton: 'group-[.toast]:bg-[var(--color-surface-2)] group-[.toast]:text-[var(--color-muted-foreground)]',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
