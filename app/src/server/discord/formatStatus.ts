import type { GameStatus } from '../services/EcsService.js';

/**
 * Render a game's status as a single Discord-ready line:
 * emoji + bold name + state + optional hostname/IP.
 *
 * Kept as a plain function (not a method) because it's stateless and is
 * reused by both `ServerStatusCommand` (single game) and `ServerListCommand`
 * (multi-game).
 */
export function formatGameStatus(status: GameStatus): string {
  const emoji =
    status.state === 'running' ? '🟢'
    : status.state === 'starting' ? '🟡'
    : status.state === 'stopped' ? '⚫'
    : '⚠️';
  const host = status.hostname ?? status.publicIp;
  const addr = host ? ` — \`${host}\`` : '';
  return `${emoji} **${status.game}**: ${status.state}${addr}`;
}
