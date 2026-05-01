#!/usr/bin/env -S npx tsx
/**
 * Entry point for the init-parent CLI. Parses the subcommand from argv and
 * dispatches to the appropriate handler. Defaults to `init` when no subcommand
 * is given.
 *
 * Usage:
 *   init-parent [subcommand] [options]
 *   init-parent --help
 */

import { argv, exit, stdout } from 'node:process';

import { runInit } from './commands/init.js';
import { runBootstrap } from './commands/bootstrap.js';
import { runMigrate } from './commands/migrate.js';

interface Command {
  name: string;
  summary: string;
  run(args: string[]): Promise<void>;
}

const COMMANDS = new Map<string, Command>([
  ['init',      { name: 'init',      summary: 'Interactive scaffolding for a new parent-repo deployment (default)', run: runInit }],
  ['bootstrap', { name: 'bootstrap', summary: 'git init + optional repo create + submodule add + init',            run: runBootstrap }],
  ['migrate',   { name: 'migrate',   summary: 'In-place rewrite of Makefile and .gitignore',                       run: runMigrate }],
]);

function printHelp(): void {
  stdout.write('\n');
  stdout.write('  game-server-deploy — submodule deployment scaffolder\n');
  stdout.write('\n');
  stdout.write('  Usage: init-parent [subcommand] [options]\n');
  stdout.write('\n');
  stdout.write('  Subcommands:\n');
  for (const cmd of COMMANDS.values()) {
    stdout.write(`    ${cmd.name.padEnd(12)} ${cmd.summary}\n`);
  }
  stdout.write('\n');
  stdout.write('  Options:\n');
  stdout.write('    --help, -h   Show this help message\n');
  stdout.write('    --force      Overwrite existing files (init only)\n');
  stdout.write('\n');
}

/** Maps legacy-style flags to their subcommand equivalents for make update. */
const FLAG_ALIASES: Record<string, string> = {
  '--migrate':   'migrate',
  '--bootstrap': 'bootstrap',
};

async function main(): Promise<void> {
  const [,, rawArg, ...rest] = argv;

  if (rawArg === '--help' || rawArg === '-h') {
    printHelp();
    return;
  }

  // Normalise --migrate / --bootstrap flag aliases to subcommand names.
  const normalized = rawArg ? (FLAG_ALIASES[rawArg] ?? rawArg) : undefined;
  const sub  = normalized && COMMANDS.has(normalized) ? normalized : 'init';
  // If rawArg wasn't a known subcommand or alias, pass it through as an arg
  // so flags like `--force` used without a subcommand still reach `init`.
  const args = normalized && COMMANDS.has(normalized) ? rest : (rawArg ? [rawArg, ...rest] : rest);

  await COMMANDS.get(sub)!.run(args);
}

main().catch((err) => {
  process.stderr.write(`\n  ✗ ${err instanceof Error ? err.message : String(err)}\n`);
  exit(1);
});
