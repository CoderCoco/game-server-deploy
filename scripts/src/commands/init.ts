import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stdout as output, exit } from 'node:process';
import { randomBytes } from 'node:crypto';
import { ParentRepo } from '../parent-repo.ts';
import { ReadlinePrompter, type IPrompter } from '../prompt.ts';
import { isValidProjectName, isValidRegion, isValidDomain } from '../validate.ts';
import { renderMakefile } from '../render/makefile.ts';
import { renderTfvars } from '../render/tfvars.ts';
import { renderEnv } from '../render/env.ts';
import { renderGitignore } from '../render/gitignore.ts';
import type { Answers, Command } from '../types.ts';

async function runInit(argv: string[], scriptsDir: string, prompter?: IPrompter): Promise<void> {
  const force = argv.includes('--force');
  const { cwd } = await import('node:process');
  const guessedParent = ParentRepo.detectRoot(cwd()) ?? ParentRepo.detectRoot(scriptsDir) ?? cwd();

  output.write('\n');
  output.write('  game-server-deploy — submodule deployment scaffolder\n');
  output.write('  ────────────────────────────────────────────────────\n');
  output.write('\n');
  output.write(`  Parent repo:  ${guessedParent}\n`);
  output.write('\n');
  output.write('  This will write Makefile, terraform.tfvars, .env, and .gitignore in\n');
  output.write('  the parent repo. Existing files are skipped unless you pass --force.\n');
  output.write('\n');

  const p = prompter ?? new ReadlinePrompter();
  const ownPrompter = !prompter;
  try {
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

    let projectName = '';
    while (!isValidProjectName(projectName)) {
      projectName = await p.askRequired(
        'Project name (S3 bucket prefix; lowercase, dashes ok)',
        'game-servers',
      );
      if (!isValidProjectName(projectName))
        output.write('  ↳ must be 3–32 chars, lowercase letters/numbers/dashes.\n');
    }

    let awsRegion = '';
    while (!isValidRegion(awsRegion)) {
      awsRegion = await p.askRequired('AWS region', 'us-east-1');
      if (!isValidRegion(awsRegion)) output.write('  ↳ must look like "us-east-1".\n');
    }

    let hostedZone = '';
    while (!isValidDomain(hostedZone)) {
      hostedZone = await p.askRequired('Route 53 hosted zone (e.g. example.com)');
      if (!isValidDomain(hostedZone)) output.write('  ↳ must be a valid domain.\n');
    }

    const generated = randomBytes(32).toString('hex');
    const apiTokenChoice = await p.ask(
      'API_TOKEN for the management app (press Enter to generate)',
      generated,
    );
    const apiToken = apiTokenChoice || generated;

    const configureDiscord = await p.askBool('Seed Discord credentials in tfvars now?', false);

    let discordApplicationId: string | undefined;
    let discordBotToken: string | undefined;
    let discordPublicKey: string | undefined;
    if (configureDiscord) {
      discordApplicationId = await p.askRequired('  Discord Application ID');
      discordBotToken = await p.askRequired('  Discord Bot Token');
      discordPublicKey = await p.askRequired('  Discord Public Key');
    }

    const answers: Answers = {
      parentDir,
      submoduleDir,
      submoduleName: repo.submoduleName,
      projectName,
      awsRegion,
      hostedZone,
      apiToken,
      configureDiscord,
      discordApplicationId,
      discordBotToken,
      discordPublicKey,
    };

    output.write('\n  Writing files…\n');
    const write = (rel: string, contents: string) => {
      const action = repo.writeFile(rel, contents, force);
      repo.reportFile(rel, action);
    };
    write('Makefile', renderMakefile(answers));
    write('terraform.tfvars', renderTfvars(answers));
    write('.env', renderEnv(answers));
    write('.gitignore', renderGitignore(answers));

    output.write('\n  ✓ Done.\n\n');
    output.write('  Next steps:\n');
    output.write(`    1. Review terraform.tfvars and add at least one entry under game_servers.\n`);
    output.write(`    2. Run \`make setup\` to bootstrap the submodule and Terraform.\n`);
    output.write(`    3. Run \`make plan\` then \`make apply\`.\n`);
    output.write(`    4. \`make dev\` to launch the management app on :5173.\n\n`);

    if (existsSync(join(parentDir, '.gitmodules'))) {
      const gm = readFileSync(join(parentDir, '.gitmodules'), 'utf8');
      if (!gm.includes(submoduleDir)) {
        output.write(`  Note: ${submoduleDir} is not in .gitmodules. Add it with:\n`);
        output.write(
          `    git submodule add https://github.com/CoderCoco/game-server-deploy.git ${submoduleDir}\n\n`,
        );
      }
    } else {
      output.write(`  Note: no .gitmodules found. Add the submodule with:\n`);
      output.write(
        `    git submodule add https://github.com/CoderCoco/game-server-deploy.git ${submoduleDir}\n\n`,
      );
    }
  } finally {
    if (ownPrompter) p.close();
  }
}

/** Factory that binds `scriptsDir` into the init command. */
export function initCommand(scriptsDir: string): Command {
  return {
    name: 'init',
    summary: 'Interactive scaffolder: write Makefile, tfvars, .env, and .gitignore',
    args: '[--force]',
    run: (argv) => runInit(argv, scriptsDir),
  };
}
