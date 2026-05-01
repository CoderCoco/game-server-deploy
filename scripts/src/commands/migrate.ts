import { stdout } from 'node:process';

/** Planned in #47: in-place rewrite of Makefile and .gitignore. */
export async function runMigrate(_args: string[]): Promise<void> {
  stdout.write('\n  migrate: not yet implemented (tracked in #47)\n\n');
}
