import type { GameStatus } from './types.js';

/**
 * Render a game's status as a Discord-ready message.
 *
 * When `connectMessage` is provided and state is `running`, it is rendered on
 * a second line with host, ip, port, and game placeholders substituted.
 * When absent, falls back to the original single-line address suffix.
 *
 * @param port - First exposed port for the port placeholder (optional).
 */
export function formatGameStatus(status: GameStatus, connectMessage?: string, port?: number): string {
  const emoji =
    status.state === 'running' ? '🟢'
    : status.state === 'starting' ? '🟡'
    : status.state === 'stopped' ? '⚫'
    : '⚠️';
  const host = status.hostname ?? status.publicIp;
  const statusLine = `${emoji} **${status.game}**: ${status.state}`;

  if (connectMessage && status.state === 'running') {
    const rendered = connectMessage
      .replace(/\{host\}/g, host ?? '')
      .replace(/\{ip\}/g, status.publicIp ?? '')
      .replace(/\{port\}/g, port !== undefined ? String(port) : '')
      .replace(/\{game\}/g, status.game);
    return `${statusLine}\n${rendered}`;
  }

  const addr = host ? ` — \`${host}\`` : '';
  return `${statusLine}${addr}`;
}
