import { stdout } from 'node:process';

/** Planned in #47: git init + optional gh repo create + submodule add + init. */
export async function runBootstrap(_args: string[]): Promise<void> {
  stdout.write('\n  bootstrap: not yet implemented (tracked in #47)\n\n');
}
