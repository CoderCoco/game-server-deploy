import type { GameStatus } from './types.js';

/**
 * Render a game's status as a single Discord-ready line:
 * emoji + bold name + state + optional hostname/IP.
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
