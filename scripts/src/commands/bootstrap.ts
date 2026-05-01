import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stdout as output, exit } from 'node:process';
import { spawnSync } from 'node:child_process';
import { ReadlinePrompter, type IPrompter } from '../prompt.ts';
import { initCommand } from './init.ts';
import type { Command } from '../types.ts';

const GSD_REPO = 'https://github.com/CoderCoco/game-server-deploy.git';

function run(cmd: string, args: string[], cwd: string): boolean {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  return result.status === 0;
}

function commandExists(cmd: string): boolean {
  const result = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

async function runBootstrap(argv: string[], scriptsDir: string, prompter?: IPrompter): Promise<void> {
  output.write('\n');
  output.write('  game-server-deploy — bootstrap a new parent repo\n');
  output.write('  ──────────────────────────────────────────────────\n');
  output.write('\n');

  const p = prompter ?? new ReadlinePrompter();
  const ownPrompter = !prompter;
  try {
    const targetDir = resolve(await p.ask('Target directory (will be created if absent)', '.'));

    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
      output.write(`  + created ${targetDir}\n`);
    }

    const isGitRepo = existsSync(join(targetDir, '.git'));
    if (!isGitRepo) {
      const initGit = await p.askBool('Initialize a git repo here?', true);
      if (initGit) {
        if (!run('git', ['init'], targetDir)) {
          output.write('  ✗ git init failed.\n');
          exit(1);
        }
        output.write('  + git init\n');
      }
    }

    const submoduleName = await p.ask('Submodule directory name', 'game-server-deploy');

    if (commandExists('gh')) {
      const createRemote = await p.askBool('Create a GitHub repo with `gh repo create`?', false);
      if (createRemote) {
        const repoName = await p.askRequired('GitHub repo name (e.g. my-org/game-servers)');
        const visibility = (await p.ask('Visibility (public/private)', 'private')).toLowerCase();
        const visFlag = visibility === 'public' ? '--public' : '--private';
        if (!run('gh', ['repo', 'create', repoName, visFlag, '--source', '.', '--push'], targetDir)) {
          output.write('  ✗ gh repo create failed — continuing without remote.\n');
        }
      }
    }

    const submodulePath = join(targetDir, submoduleName);
    if (!existsSync(submodulePath)) {
      output.write(`\n  Adding submodule ${submoduleName}…\n`);
      if (!run('git', ['submodule', 'add', GSD_REPO, submoduleName], targetDir)) {
        output.write('  ✗ git submodule add failed.\n');
        exit(1);
      }
    } else {
      output.write(`  · ${submoduleName} already exists — skipping submodule add.\n`);
    }

    output.write('\n  Installing script dependencies…\n');
    const scriptsPackageDir = join(submodulePath, 'scripts');
    if (!run('npm', ['install', '--prefix', scriptsPackageDir], targetDir)) {
      output.write('  ✗ npm install failed.\n');
      exit(1);
    }

    output.write('\n  Running init…\n');
    await initCommand(scriptsDir).run(argv);
  } finally {
    if (ownPrompter) p.close();
  }
}

/** Factory that binds `scriptsDir` into the bootstrap command. */
export function bootstrapCommand(scriptsDir: string): Command {
  return {
    name: 'bootstrap',
    summary: 'Set up a new parent repo: git init, optional gh repo create, submodule add, then init',
    args: '[--force]',
    run: (argv) => runBootstrap(argv, scriptsDir),
  };
}
