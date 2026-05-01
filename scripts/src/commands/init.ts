import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, cwd, exit, stdout } from 'node:process';
import { randomBytes } from 'node:crypto';

import { findParentRepoRoot, ParentRepo } from '../parent-repo.js';
import { Prompter } from '../prompt.js';
import { renderMakefile } from '../render/makefile.js';
import { renderTfvars } from '../render/tfvars.js';
import { renderEnv } from '../render/env.js';
import { renderGitignore } from '../render/gitignore.js';
import { isValidProjectName, isValidRegion, isValidDomain } from '../validate.js';
import type { Answers } from '../types.js';

function writeIfSafe(path: string, contents: string, force: boolean): 'wrote' | 'skipped' | 'overwrote' {
  if (existsSync(path) && !force) return 'skipped';
  const existed = existsSync(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return existed ? 'overwrote' : 'wrote';
}

function logStatus(path: string, action: 'wrote' | 'skipped' | 'overwrote', parentDir: string): void {
  const rel = relative(parentDir, path) || path;
  const tag = action === 'wrote' ? '  +' : action === 'overwrote' ? '  ~' : '  ·';
  const note = action === 'skipped' ? '  (exists — use --force to overwrite)' : '';
  stdout.write(`${tag} ${rel}${note}\n`);
}

export async function runInit(args: string[]): Promise<void> {
  const force = args.includes('--force');
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const guessedParent = findParentRepoRoot(cwd()) ?? findParentRepoRoot(scriptDir) ?? cwd();

  stdout.write('\n');
  stdout.write('  game-server-deploy — submodule deployment scaffolder\n');
  stdout.write('  ────────────────────────────────────────────────────\n');
  stdout.write('\n');
  stdout.write(`  Parent repo:  ${guessedParent}\n`);
  stdout.write(`  Script:       ${relative(guessedParent, fileURLToPath(import.meta.url)) || fileURLToPath(import.meta.url)}\n`);
  stdout.write('\n');
  stdout.write('  This will write Makefile, terraform.tfvars, .env, and .gitignore in\n');
  stdout.write('  the parent repo. Existing files are skipped unless you pass --force.\n');
  stdout.write('\n');

  const prompter = new Prompter();
  try {
    const parentDir = await prompter.ask('Parent repo path', guessedParent);
    const repo = new ParentRepo(parentDir);

    if (!repo.exists()) {
      stdout.write(`\n  ✗ ${parentDir} is not a directory.\n`);
      exit(1);
    }

    const submoduleDir = await prompter.ask(
      'Submodule path (relative to parent repo)',
      repo.detectSubmodulePath(scriptDir),
    );
    const submoduleName = submoduleDir.split('/').pop() || 'game-server-deploy';

    let projectName = '';
    while (!isValidProjectName(projectName)) {
      projectName = await prompter.askRequired('Project name (S3 bucket prefix; lowercase, dashes ok)', 'game-servers');
      if (!isValidProjectName(projectName)) stdout.write('  ↳ must be 3–32 chars, lowercase letters/numbers/dashes.\n');
    }

    let awsRegion = '';
    while (!isValidRegion(awsRegion)) {
      awsRegion = await prompter.askRequired('AWS region', 'us-east-1');
      if (!isValidRegion(awsRegion)) stdout.write('  ↳ must look like "us-east-1".\n');
    }

    let hostedZone = '';
    while (!isValidDomain(hostedZone)) {
      hostedZone = await prompter.askRequired('Route 53 hosted zone (e.g. example.com)');
      if (!isValidDomain(hostedZone)) stdout.write('  ↳ must be a valid domain.\n');
    }

    const generated = randomBytes(32).toString('hex');
    const apiTokenChoice = await prompter.ask('API_TOKEN for the management app (press Enter to generate)', generated);
    const apiToken = apiTokenChoice || generated;

    const configureDiscord = await prompter.askBool('Seed Discord credentials in tfvars now?', false);

    let discordApplicationId: string | undefined;
    let discordBotToken: string | undefined;
    let discordPublicKey: string | undefined;
    if (configureDiscord) {
      discordApplicationId = await prompter.askRequired('  Discord Application ID');
      discordBotToken = await prompter.askRequired('  Discord Bot Token');
      discordPublicKey = await prompter.askRequired('  Discord Public Key');
    }

    const answers: Answers = {
      parentDir,
      submoduleDir,
      submoduleName,
      projectName,
      awsRegion,
      hostedZone,
      apiToken,
      configureDiscord,
      discordApplicationId,
      discordBotToken,
      discordPublicKey,
    };

    stdout.write('\n  Writing files…\n');
    logStatus(join(parentDir, 'Makefile'),           writeIfSafe(join(parentDir, 'Makefile'),           renderMakefile(answers), force), parentDir);
    logStatus(join(parentDir, 'terraform.tfvars'),   writeIfSafe(join(parentDir, 'terraform.tfvars'),   renderTfvars(answers),   force), parentDir);
    logStatus(join(parentDir, '.env'),               writeIfSafe(join(parentDir, '.env'),               renderEnv(answers),      force), parentDir);
    logStatus(join(parentDir, '.gitignore'),         writeIfSafe(join(parentDir, '.gitignore'),         renderGitignore(answers), force), parentDir);

    stdout.write('\n  ✓ Done.\n\n');
    stdout.write('  Next steps:\n');
    stdout.write('    1. Review terraform.tfvars and add at least one entry under game_servers.\n');
    stdout.write('    2. Run `make setup` to bootstrap the submodule and Terraform.\n');
    stdout.write('    3. Run `make plan` then `make apply`.\n');
    stdout.write('    4. `make dev` to launch the management app on :5173.\n\n');

    if (!repo.hasSubmodule(submoduleDir)) {
      stdout.write(`  Note: ${submoduleDir} is not in .gitmodules. Add it with:\n`);
      stdout.write(`    git submodule add https://github.com/CoderCoco/game-server-deploy.git ${submoduleDir}\n\n`);
    }
  } finally {
    prompter.close();
  }
}
