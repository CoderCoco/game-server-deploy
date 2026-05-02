import { useState } from 'react';
import { Copy, RefreshCw, FolderOpen } from 'lucide-react';
import { api, type GameStatus, type GameEstimate } from '../api.js';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Props {
  status: GameStatus;
  estimate?: GameEstimate;
  onRefresh: (game: string) => void;
  onOpenFiles: (game: string) => void;
}

const STATE_LABELS: Record<string, string> = {
  running:      'Online',
  starting:     'Starting…',
  stopped:      'Offline',
  not_deployed: 'Not Deployed',
  error:        'Error',
};

/** Returns the badge variant that maps to the server state. */
function stateBadgeVariant(state: string): 'success' | 'warning' | 'destructive' | 'secondary' {
  switch (state) {
    case 'running':      return 'success';
    case 'starting':
    case 'not_deployed': return 'warning';
    case 'stopped':
    case 'error':        return 'destructive';
    default:             return 'secondary';
  }
}

/** Returns a Tailwind color class for the status indicator dot. */
function dotColorClass(state: string): string {
  switch (state) {
    case 'running':      return 'bg-[var(--color-green)] shadow-[0_0_6px_var(--color-green)]';
    case 'starting':
    case 'not_deployed': return 'bg-[var(--color-amber)]';
    case 'stopped':
    case 'error':        return 'bg-[var(--color-red)]';
    default:             return 'bg-[var(--color-muted-foreground)]';
  }
}

/**
 * Card for a single game in the dashboard grid: status dot, connect string,
 * cost estimate, and Start/Stop/Files/Refresh buttons. After a start/stop the
 * card schedules a `onRefresh` call 3s later so the backend has time to pick
 * up the ECS state change before we poll `/api/status/:game`.
 */
export function GameCard({ status, estimate, onRefresh, onOpenFiles }: Props) {
  const { game, state } = status;
  const [busy, setBusy] = useState(false);

  const canStart = state === 'stopped' || state === 'not_deployed';
  const canStop  = state === 'running'  || state === 'starting';

  async function handleStart() {
    setBusy(true);
    await api.start(game);
    setTimeout(() => { void onRefresh(game); setBusy(false); }, 3000);
  }

  async function handleStop() {
    setBusy(true);
    await api.stop(game);
    setTimeout(() => { void onRefresh(game); setBusy(false); }, 3000);
  }

  const connectStr = status.hostname ?? status.publicIp ?? null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2.5">
          <span className={cn('size-2.5 rounded-full shrink-0', dotColorClass(state))} />
          <CardTitle className="capitalize">{game}</CardTitle>
          <Badge variant={stateBadgeVariant(state)} className="ml-auto text-[0.65rem]">
            {STATE_LABELS[state] ?? state}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="font-[var(--font-mono)] text-xs text-[var(--color-green)] min-h-[1.2rem] flex items-center gap-1.5">
          {connectStr && (
            <>
              <span>{connectStr}</span>
              <Button
                variant="secondary"
                size="sm"
                className="h-5 px-1.5 py-0 text-[0.6rem]"
                onClick={() => void navigator.clipboard.writeText(connectStr)}
              >
                <Copy className="size-3" />
                copy
              </Button>
              {status.publicIp && status.hostname && (
                <span className="text-[var(--color-muted-foreground)]">({status.publicIp})</span>
              )}
            </>
          )}
        </div>

        {estimate && (
          <p className="text-xs text-[var(--color-muted-foreground)]">
            <span className="text-[var(--color-primary-light)] font-medium">${estimate.costPerHour}/hr</span>
            {' · '}~${estimate.costPerMonth4hpd}/mo at 4 hrs/day
          </p>
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2">
        <Button variant="start" size="sm" onClick={() => void handleStart()} disabled={!canStart || busy}>
          Start
        </Button>
        <Button variant="stop" size="sm" onClick={() => void handleStop()} disabled={!canStop || busy}>
          Stop
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onOpenFiles(game)}>
          <FolderOpen className="size-3.5" />
          Files
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onRefresh(game)} aria-label="Refresh">
          <RefreshCw className="size-3.5" />
        </Button>
      </CardFooter>
    </Card>
  );
}
