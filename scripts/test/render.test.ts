import { describe, it, expect } from 'vitest';
import { renderMakefile } from '../src/render/makefile.ts';
import { renderTfvars } from '../src/render/tfvars.ts';
import { renderEnv } from '../src/render/env.ts';
import { renderGitignore } from '../src/render/gitignore.ts';
import type { Answers } from '../src/types.ts';

/** Minimal answers fixture for tests that don't configure Discord. */
function baseAnswers(overrides?: Partial<Answers>): Answers {
  return {
    parentDir: '/tmp/parent',
    submoduleDir: 'game-server-deploy',
    submoduleName: 'game-server-deploy',
    projectName: 'mygames',
    awsRegion: 'us-west-2',
    hostedZone: 'example.com',
    apiToken: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222',
    configureDiscord: false,
    ...overrides,
  };
}

describe('renderMakefile', () => {
  const mk = renderMakefile(baseAnswers());

  it('should set SUBMODULE from the provided submoduleDir', () => {
    expect(mk).toContain('SUBMODULE   := $(REPO_ROOT)/game-server-deploy');
  });

  it('should load .env via include', () => {
    expect(mk).toContain('include $(REPO_ROOT)/.env');
  });

  it('should delegate plan to submodule tf-plan target', () => {
    expect(mk).toContain('$(MAKE) -C $(SUBMODULE) tf-plan');
  });

  it('should delegate apply to submodule tf-apply target', () => {
    expect(mk).toContain('$(MAKE) -C $(SUBMODULE) tf-apply');
  });

  it('should include terraform state pull in dev target', () => {
    expect(mk).toContain('terraform -chdir=$(TF_DIR) state pull');
  });

  it('should define SETUP_STAMP for idempotent setup', () => {
    expect(mk).toContain('SETUP_STAMP := $(STAMP_DIR)/setup.stamp');
  });

  it('should re-run setup.sh when it changes during update', () => {
    expect(mk).toContain('setup.sh changed');
  });

  it('should use cp in copy-tfvars target', () => {
    expect(mk).toContain('cp $(TFVARS) $(TF_DIR)/terraform.tfvars');
  });

  it('should use bash as shell', () => {
    expect(mk.startsWith('SHELL      := /usr/bin/env bash')).toBe(true);
  });

  it('should never inline the API_TOKEN value', () => {
    expect(/API_TOKEN\s*:?=\s*[a-f0-9]{40,}/.test(mk)).toBe(false);
  });
});

describe('renderTfvars', () => {
  const tfv = renderTfvars(baseAnswers());

  it('should set project_name from answers', () => {
    expect(tfv).toContain('project_name = "mygames"');
  });

  it('should set aws_region from answers', () => {
    expect(tfv).toContain('aws_region   = "us-west-2"');
  });

  it('should set hosted_zone_name from answers', () => {
    expect(tfv).toContain('hosted_zone_name = "example.com"');
  });

  it('should include a game_servers map stub', () => {
    expect(tfv).toContain('game_servers = {');
  });

  it('should leave Discord variables commented when not configured', () => {
    expect(tfv).toContain('# discord_application_id');
  });

  it('should write Discord values when configureDiscord is true', () => {
    const tfvD = renderTfvars(
      baseAnswers({
        configureDiscord: true,
        discordApplicationId: '111',
        discordBotToken: 'btok',
        discordPublicKey: 'pkey',
      }),
    );
    expect(tfvD).toContain('discord_bot_token      = "btok"');
    expect(tfvD).toContain('discord_public_key     = "pkey"');
  });
});

describe('renderEnv', () => {
  it('should contain the API_TOKEN line', () => {
    const a = baseAnswers();
    expect(renderEnv(a)).toContain(`API_TOKEN=${a.apiToken}`);
  });
});

describe('renderGitignore', () => {
  const gi = renderGitignore(baseAnswers());

  it('should ignore .env files', () => {
    expect(gi).toContain('.env\n');
  });

  it('should ignore the .make/ stamp directory', () => {
    expect(gi).toContain('.make/');
  });

  it('should ignore local terraform state files', () => {
    expect(gi).toContain('terraform.tfstate');
  });
});
