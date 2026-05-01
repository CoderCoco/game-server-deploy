import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cwd, stdout } from 'node:process';

import { findParentRepoRoot } from '../parent-repo.js';
import { Prompter } from '../prompt.js';
import { renderMakefile } from '../render/makefile.js';
import { renderGitignore } from '../render/gitignore.js';
import type { Answers } from '../types.js';

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseSubmoduleDir(makefileContent: string): string {
  return makefileContent.match(/SUBMODULE\s*:=\s*\$\(REPO_ROOT\)\/(.+)/)?.[1]?.trim()
    ?? 'game-server-deploy';
}

function parseTfvarsField(content: string, key: string): string {
  return content.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'))?.[1] ?? '';
}

function parseEnvField(content: string, key: string): string {
  return content.match(new RegExp(`^${key}=(.+)`, 'm'))?.[1]?.trim() ?? '';
}

// ── Diff helper ───────────────────────────────────────────────────────────────

/** Prints a unified diff of old vs new content. Returns true if changed. */
function printDiff(label: string, oldContent: string, newContent: string): boolean {
  if (oldContent === newContent) {
    stdout.write(`  · ${label}  (unchanged)\n`);
    return false;
  }
  const id = randomBytes(4).toString('hex');
  const tmpOld = join(tmpdir(), `gsd-migrate-old-${id}`);
  const tmpNew = join(tmpdir(), `gsd-migrate-new-${id}`);
  writeFileSync(tmpOld, oldContent);
  writeFileSync(tmpNew, newContent);
  const result = spawnSync(
    'diff',
    ['-u', `--label=a/${label}`, `--label=b/${label}`, tmpOld, tmpNew],
    { encoding: 'utf8' },
  );
  stdout.write(result.stdout || '  (diff tool unavailable)\n');
  // Clean up temp files — best-effort; don't fail the migration if this errors
  try { spawnSync('rm', ['-f', tmpOld, tmpNew]); } catch { /* ignore */ }
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Reads the existing Makefile/tfvars/.env to recover the current answers, then
 * re-renders Makefile and .gitignore against the latest templates. Shows a diff
 * preview and asks for confirmation before writing.
 *
 * Does NOT touch terraform.tfvars or .env — those contain user-edited values.
 */
export async function runMigrate(args: string[]): Promise<void> {
  const force = args.includes('--force');
  const parentDir = findParentRepoRoot(cwd()) ?? cwd();

  const makefilePath   = join(parentDir, 'Makefile');
  const tfvarsPath     = join(parentDir, 'terraform.tfvars');
  const envPath        = join(parentDir, '.env');
  const gitignorePath  = join(parentDir, '.gitignore');

  if (!existsSync(makefilePath)) {
    stdout.write('\n  Nothing to migrate — no Makefile found in:\n');
    stdout.write(`    ${parentDir}\n\n`);
    stdout.write('  Run `init-parent init` instead to scaffold a new deployment.\n\n');
    return;
  }

  const makefileContent  = readFileSync(makefilePath, 'utf8');
  const tfvarsContent    = existsSync(tfvarsPath) ? readFileSync(tfvarsPath, 'utf8') : '';
  const envContent       = existsSync(envPath)    ? readFileSync(envPath, 'utf8')    : '';
  const gitignoreContent = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';

  // Recover current values from existing files
  const submoduleDir  = parseSubmoduleDir(makefileContent);
  const projectName   = parseTfvarsField(tfvarsContent, 'project_name') || 'game-servers';
  const awsRegion     = parseTfvarsField(tfvarsContent, 'aws_region')   || 'us-east-1';
  const hostedZone    = parseTfvarsField(tfvarsContent, 'hosted_zone_name') || 'example.com';
  const apiToken      = parseEnvField(envContent, 'API_TOKEN');

  const answers: Answers = {
    parentDir,
    submoduleDir,
    submoduleName: submoduleDir.split('/').pop() ?? 'game-server-deploy',
    projectName,
    awsRegion,
    hostedZone,
    apiToken,
    configureDiscord: false,
  };

  stdout.write('\n');
  stdout.write('  game-server-deploy — migrate wrapper files to latest templates\n');
  stdout.write('  ──────────────────────────────────────────────────────────────\n');
  stdout.write('\n');
  stdout.write(`  Parent repo:   ${parentDir}\n`);
  stdout.write(`  Submodule:     ${submoduleDir}\n`);
  stdout.write(`  Project name:  ${projectName}\n`);
  stdout.write('\n');
  stdout.write('  Previewing changes (terraform.tfvars and .env are left untouched):\n\n');

  const newMakefile  = renderMakefile(answers);
  const newGitignore = renderGitignore(answers);

  const makefileChanged  = printDiff('Makefile',   makefileContent,  newMakefile);
  const gitignoreChanged = printDiff('.gitignore', gitignoreContent, newGitignore);

  if (!makefileChanged && !gitignoreChanged) {
    stdout.write('\n  ✓ Wrapper files are already up to date.\n\n');
    return;
  }

  stdout.write('\n');

  if (!force) {
    const prompter = new Prompter();
    let confirmed: boolean;
    try {
      confirmed = await prompter.askBool('Apply these changes?', true);
    } finally {
      prompter.close();
    }
    if (!confirmed) {
      stdout.write('\n  Aborted — no files written.\n\n');
      return;
    }
  }

  if (makefileChanged)  writeFileSync(makefilePath,  newMakefile);
  if (gitignoreChanged) writeFileSync(gitignorePath, newGitignore);

  stdout.write('\n  ✓ Done.\n\n');

  if (existsSync(tfvarsPath)) {
    stdout.write(`  Note: terraform.tfvars was not modified. Compare it against\n`);
    stdout.write(`    ${relative(parentDir, join(parentDir, submoduleDir))}/terraform/terraform.tfvars.example\n`);
    stdout.write(`  to pick up any new variables added in this release.\n\n`);
  }
}
