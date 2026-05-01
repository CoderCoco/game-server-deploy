#!/usr/bin/env node
/**
 * Entry point for the init-parent CLI.
 *
 * Usage:
 *   init-parent [init]   [--force]   — interactive scaffolder (default)
 *   init-parent bootstrap [--force]  — git init + submodule add + init
 *   init-parent migrate              — rewrite Makefile + .gitignore in-place
 *   init-parent --help               — list commands
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, stdout as output, stderr, exit } from 'node:process';
import { initCommand } from './commands/init.ts';
import { bootstrapCommand } from './commands/bootstrap.ts';
import { migrateCommand } from './commands/migrate.ts';
import type { Command } from './types.ts';

// dirname(import.meta.url) is src/ when running from source, dist/ when bundled.
// One level up is always the scripts/ package root — used by path detection.
const scriptsDir = dirname(dirname(fileURLToPath(import.meta.url)));

const commands: Command[] = [
  initCommand(scriptsDir),
  bootstrapCommand(scriptsDir),
  migrateCommand(scriptsDir),
];

function printHelp(): void {
  output.write('\nUsage: init-parent <command> [options]\n\n');
  output.write('Commands:\n');
  const width = Math.max(...commands.map((c) => c.name.length)) + 2;
  for (const cmd of commands) {
    const args = cmd.args ? `  ${cmd.args}` : '';
    output.write(`  ${cmd.name.padEnd(width)}${cmd.summary}${args}\n`);
  }
  output.write('\nRun with no command (or "init") to start the interactive scaffolder.\n\n');
}

async function main(): Promise<void> {
  const args = argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  // Default to 'init' when no subcommand is given or the first arg is a flag.
  const [first, ...rest] = args;
  const isFlag = (s: string) => s.startsWith('-');
  const commandName = !first || isFlag(first) ? 'init' : first;
  const commandArgs = commandName === first ? rest : args;

  const cmd = commands.find((c) => c.name === commandName);
  if (!cmd) {
    stderr.write(`\n  ✗ Unknown command: "${commandName}". Run --help to see available commands.\n\n`);
    exit(1);
  }

  await cmd.run(commandArgs);
}

main().catch((err) => {
  stderr.write(`\n  ✗ ${err instanceof Error ? err.message : String(err)}\n`);
  exit(1);
});
