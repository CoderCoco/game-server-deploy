import { existsSync, readFileSync, statSync } from 'node:fs';
import { stdout as output, exit } from 'node:process';
import { ParentRepo } from '../parent-repo.ts';
import { ReadlinePrompter, type IPrompter } from '../prompt.ts';
import { renderMakefile } from '../render/makefile.ts';
import { renderGitignore } from '../render/gitignore.ts';
import type { Answers, Command } from '../types.ts';

/**
 * Parse a simple `key = "value"` line from a tfvars file.
 * Returns `undefined` if the key is not present or commented out.
 */
function parseTfvar(contents: string, key: string): string | undefined {
  const m = contents.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return m?.[1];
}

async function runMigrate(argv: string[], scriptsDir: string, prompter?: IPrompter): Promise<void> {
  const force = argv.includes('--force');

  output.write('\n');
  output.write('  game-server-deploy — migrate Makefile + .gitignore\n');
  output.write('  ────────────────────────────────────────────────────\n');
  output.write('\n');
  output.write('  Rewrites Makefile and .gitignore from the current tfvars values.\n');
  output.write('  Does not touch terraform.tfvars or .env.\n');
  output.write('\n');

  const p = prompter ?? new ReadlinePrompter();
  const ownPrompter = !prompter;
  try {
    const { cwd } = await import('node:process');
    const guessedParent = ParentRepo.detectRoot(cwd()) ?? ParentRepo.detectRoot(scriptsDir) ?? cwd();
    const parentDir = await p.ask('Parent repo path', guessedParent);

    if (!existsSync(parentDir) || !statSync(parentDir).isDirectory()) {
      output.write(`\n  ✗ ${parentDir} is not a directory.\n`);
      exit(1);
    }

    const submoduleDir = await p.ask(
      'Submodule path (relative to parent repo)',
      ParentRepo.detectSubmodulePath(parentDir, scriptsDir),
    );
    const repo = new ParentRepo(parentDir, submoduleDir);

    // Parse existing tfvars to pre-fill the answers we need for rendering.
    const tfvarsPath = `${parentDir}/terraform.tfvars`;
    let projectName = '';
    let awsRegion = '';
    let hostedZone = '';

    if (existsSync(tfvarsPath)) {
      const contents = readFileSync(tfvarsPath, 'utf8');
      projectName = parseTfvar(contents, 'project_name') ?? '';
      awsRegion = parseTfvar(contents, 'aws_region') ?? '';
      hostedZone = parseTfvar(contents, 'hosted_zone_name') ?? '';
    }

    projectName = await p.ask('Project name', projectName || 'game-servers');
    awsRegion = await p.ask('AWS region', awsRegion || 'us-east-1');
    hostedZone = await p.ask('Route 53 hosted zone', hostedZone || '');
    if (!hostedZone) {
      output.write('  ✗ hosted_zone_name is required.\n');
      exit(1);
    }

    const answers: Answers = {
      parentDir,
      submoduleDir,
      submoduleName: repo.submoduleName,
      projectName,
      awsRegion,
      hostedZone,
      // Migrate only touches Makefile + .gitignore — these fields aren't used by those renderers.
      apiToken: '',
      configureDiscord: false,
    };

    output.write('\n  Rewriting files…\n');
    const write = (rel: string, contents: string) => {
      const action = repo.writeFile(rel, contents, /* force= */ true);
      repo.reportFile(rel, action);
    };
    write('Makefile', renderMakefile(answers));
    write('.gitignore', renderGitignore(answers));

    if (!force) {
      output.write('\n  ✓ Done. Commit the updated Makefile and .gitignore.\n\n');
    } else {
      output.write('\n  ✓ Done.\n\n');
    }
  } finally {
    if (ownPrompter) p.close();
  }
}

/** Factory that binds `scriptsDir` into the migrate command. */
export function migrateCommand(scriptsDir: string): Command {
  return {
    name: 'migrate',
    summary: 'Rewrite Makefile and .gitignore in-place from current tfvars values',
    run: (argv) => runMigrate(argv, scriptsDir),
  };
}
