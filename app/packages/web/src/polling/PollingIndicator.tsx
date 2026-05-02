import { RefreshCw } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { isStale, usePollingContext, type PollerState } from './PollingProvider.js';

interface Props {
  /** Name of the poller in the registry to surface. Defaults to "status". */
  name?: string;
  className?: string;
}

/**
 * "Updated 3s ago" label with a rotating refresh icon that spins while the
 * poller is in-flight. On hover, shows the next-poll countdown. After 2× the
 * interval without a success, switches to a red "Stale" pill that auto-clears
 * on the next successful poll.
 */
export function PollingIndicator({ name = 'status', className }: Props) {
  const ctx = usePollingContext();
  const state = ctx.pollers[name];

  // Tracking ctx.tick keeps the relative-time labels updating once a second
  // without each indicator instance running its own setInterval.
  const now = Date.now();
  void ctx.tick;

  if (!state) {
    return (
      <div className={cn('text-xs text-[var(--color-muted-foreground)]', className)}>
        <span>Not polling</span>
      </div>
    );
  }

  const stale = isStale(state, now);

  if (stale) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-red)]/40 bg-[var(--color-red)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-red)]',
          className,
        )}
      >
        <span className="size-1.5 rounded-full bg-[var(--color-red)]" />
        Stale · last updated {formatAgo(state.lastSuccessAt, now)}
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'inline-flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]',
              className,
            )}
          >
            <RefreshCw
              className={cn(
                'size-3 text-[var(--color-cyan)]',
                state.loading && 'animate-spin',
              )}
            />
            <span>Updated {formatAgo(state.lastSuccessAt, now)}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {nextRefreshLabel(state, now)}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Format an absolute timestamp as "Xs ago" / "Xm ago" / "—" (when unset).
 * We keep this sub-minute resolution since the poll interval is 20s.
 */
function formatAgo(ts: number | null, now: number): string {
  if (ts === null) return '—';
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  return `${min}m ago`;
}

/** Build the "next refresh in X" tooltip body, falling back to "scheduled" while we wait for the first attempt. */
function nextRefreshLabel(state: PollerState, now: number): string {
  if (state.lastAttemptAt === null) return 'next refresh scheduled';
  const elapsed = now - state.lastAttemptAt;
  const remaining = Math.max(0, state.intervalMs - elapsed);
  const sec = Math.round(remaining / 1000);
  return `next refresh in ${sec}s`;
}
