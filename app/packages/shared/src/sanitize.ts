import type { DiscordAction, DiscordGamePermission } from './types.js';

/**
 * Keys that would pollute `Object.prototype` or otherwise clash with built-in
 * properties when used as a plain-object index. Caller-supplied game names are
 * rejected if they match so `cfg.gamePermissions[game] = ...` is safe.
 */
export const UNSAFE_GAME_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Guard against prototype pollution when using a caller-supplied string as an object key. */
export function isSafeGameKey(game: string): boolean {
  return typeof game === 'string' && game.length > 0 && !UNSAFE_GAME_KEYS.has(game);
}

/** Return `v` only if it's a string; anything else (including null/number/object) becomes `undefined`. */
export function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Return a string[] built from only the string entries of `v`; non-arrays and non-string entries are dropped. */
export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Coerce a stored game-permission object into a well-typed one; unknown fields / bad types are dropped. */
export function sanitizeGamePermission(v: unknown): DiscordGamePermission {
  const obj = (v ?? {}) as Record<string, unknown>;
  return {
    userIds: asStringArray(obj['userIds']),
    roleIds: asStringArray(obj['roleIds']),
    actions: asStringArray(obj['actions']).filter(
      (a): a is DiscordAction => a === 'start' || a === 'stop' || a === 'status',
    ),
  };
}
