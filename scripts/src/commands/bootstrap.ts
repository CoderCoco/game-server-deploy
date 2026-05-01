import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd, exit, stdout } from 'node:process';

import { Prompter } from '../prompt.js';
import { runInit } from './init.js';

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore', shell: '/bin/bash' });
    return true;
  } catch {
    return false;
  }
}

function hasSubmoduleEntry(dir: string): boolean {
  const gm = join(dir, '.gitmodules');
  if (!existsSync(gm)) return false;
  return readFileSync(gm, 'utf8').includes('game-server-deploy');
}

/**
 * Walks through git repo initialisation, optional GitHub repo creation, and
 * submodule add — then hands off to the interactive init flow.
 *
 * Designed for the "fresh empty directory" case where no .git or .gitmodules
 * exists yet.
 */
export async function runBootstrap(args: string[]): Promise<void> {
  const dir = cwd();
  const prompter = new Prompter();

  stdout.write('\n');
  stdout.write('  game-server-deploy — bootstrap a new parent-repo deployment\n');
  stdout.write('  ─────────────────────────────────────────────────────────────\n');
  stdout.write('\n');
  stdout.write(`  Working directory: ${dir}\n`);
  stdout.write('\n');

  try {
    // ── Step 1: git init ──────────────────────────────────────────────────────
    const hasGit = existsSync(join(dir, '.git'));
    if (!hasGit) {
      stdout.write('  No git repository found in this directory.\n\n');
      const doInit = await prompter.askBool('Initialise a new git repo here?', true);
      if (!doInit) {
        stdout.write('\n  Aborting — a git repository is required.\n\n');
        exit(1);
      }
      execSync('git init', { stdio: 'inherit', cwd: dir });
      stdout.write('\n');

      // ── Step 2: optional GitHub repo creation ─────────────────────────────
      if (commandExists('gh')) {
        const createRepo = await prompter.askBool(
          'Create a private GitHub repo with `gh repo create`?',
          false,
        );
        if (createRepo) {
          const repoName = await prompter.askRequired(
            '  Repository name (e.g. your-private-games)',
          );
          try {
            execSync(
              `gh repo create ${repoName} --private --source=. --remote=origin`,
              { stdio: 'inherit', cwd: dir },
            );
            stdout.write('\n');
          } catch {
            stdout.write(
              '\n  Note: `gh repo create` failed — create the GitHub repo manually and add the remote.\n\n',
            );
          }
        }
      } else {
        stdout.write(
          '  Note: `gh` not found — create the GitHub repo manually and add the remote.\n\n',
        );
      }
    }

    // ── Step 3: git submodule add ─────────────────────────────────────────────
    if (!hasSubmoduleEntry(dir)) {
      stdout.write('  game-server-deploy submodule not found.\n\n');
      const doSubmodule = await prompter.askBool(
        'Add game-server-deploy as a git submodule?',
        true,
      );
      if (doSubmodule) {
        const subPath = await prompter.ask('  Submodule path', 'game-server-deploy');
        execSync(
          `git submodule add https://github.com/CoderCoco/game-server-deploy.git ${subPath}`,
          { stdio: 'inherit', cwd: dir },
        );
        stdout.write('\n');
      } else {
        stdout.write(
          '\n  Note: add the submodule manually before running `make setup`:\n' +
          '    git submodule add https://github.com/CoderCoco/game-server-deploy.git\n\n',
        );
      }
    }
  } finally {
    prompter.close();
  }

  // Hand off to the interactive scaffolding flow.
  await runInit(args);
}
