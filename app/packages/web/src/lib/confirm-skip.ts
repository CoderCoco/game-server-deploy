// Module-level Set — lives for the JS module lifetime (one browser session,
// resets on hard reload, survives SPA navigation).
const suppressed = new Set<string>();

export function isSuppressed(key: string): boolean {
  return suppressed.has(key);
}

export function suppress(key: string): void {
  suppressed.add(key);
}
