import { describe, it, expect } from 'vitest';
import { renderMakefile } from '../src/render/makefile.js';
import { renderTfvars } from '../src/render/tfvars.js';
import { renderEnv } from '../src/render/env.js';
import { renderGitignore } from '../src/render/gitignore.js';
import type { Answers } from '../src/types.js';

/** Minimal Answers fixture with Discord disabled. */
function makeAnswers(overrides: Partial<Answers> = {}): Answers {
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
  it('should set SUBMODULE to the provided submodule directory', () => {
    const mk = renderMakefile(makeAnswers());
    expect(mk).toContain('SUBMODULE   := $(REPO_ROOT)/game-server-deploy');
  });

  it('should include .env loading block', () => {
    const mk = renderMakefile(makeAnswers());
    expect(mk).toContain('include $(REPO_ROOT)/.env');
  });

  it('should delegate plan to the submodule make target', () => {
    const mk = renderMakefile(makeAnswers());
    expect(mk).toContain('$(MAKE) -C $(SUBMODULE) tf-plan');
  });

  it('should delegate apply to the submodule make target', () => {
    const mk = renderMakefile(makeAnswers());
    expect(mk).toContain('$(MAKE) -C $(SUBMODULE) tf-apply');
  });

  it('should include the dev target with tfstate pull', () => {
    const mk = renderMakefile(makeAnswers());
    expect(mk).toContain('terraform -chdir=$(TF_DIR) state pull');
  });

  it('should include the setup stamp variable', () => {
    const mk = renderMakefile(makeAnswers());
    expect(mk).toContain('SETUP_STAMP := $(STAMP_DIR)/setup.stamp');
  });

  it('should detect setup.sh changes in the update target', () => {
    const mk = renderMakefile(makeAnswers());
    expect(mk).toContain('setup.sh changed');
  });

  it('should copy tfvars with cp in the copy-tfvars target', () => {
    const mk = renderMakefile(makeAnswers());
    expect(mk).toContain('cp $(TFVARS) $(TF_DIR)/terraform.tfvars');
  });

  it('should use bash as the shell', () => {
    const mk = renderMakefile(makeAnswers());
    expect(mk.startsWith('SHELL      := /usr/bin/env bash')).toBe(true);
  });

  it('should not inline the API_TOKEN value', () => {
    const mk = renderMakefile(makeAnswers());
    expect(/API_TOKEN\s*:?=\s*[a-f0-9]{40,}/.test(mk)).toBe(false);
  });
});

describe('renderTfvars', () => {
  it('should write the project_name variable', () => {
    const tfv = renderTfvars(makeAnswers());
    expect(tfv).toContain('project_name = "mygames"');
  });

  it('should write the aws_region variable', () => {
    const tfv = renderTfvars(makeAnswers());
    expect(tfv).toContain('aws_region   = "us-west-2"');
  });

  it('should write the hosted_zone_name variable', () => {
    const tfv = renderTfvars(makeAnswers());
    expect(tfv).toContain('hosted_zone_name = "example.com"');
  });

  it('should include the game_servers map', () => {
    const tfv = renderTfvars(makeAnswers());
    expect(tfv).toContain('game_servers = {');
  });

  it('should leave Discord variables commented out when not configured', () => {
    const tfv = renderTfvars(makeAnswers());
    expect(tfv).toContain('# discord_application_id');
  });

  it('should write Discord values when configureDiscord is true', () => {
    const tfv = renderTfvars(makeAnswers({
      configureDiscord: true,
      discordApplicationId: '111',
      discordBotToken: 'btok',
      discordPublicKey: 'pkey',
    }));
    expect(tfv).toContain('discord_bot_token      = "btok"');
  });

  it('should write the Discord public key when configureDiscord is true', () => {
    const tfv = renderTfvars(makeAnswers({
      configureDiscord: true,
      discordApplicationId: '111',
      discordBotToken: 'btok',
      discordPublicKey: 'pkey',
    }));
    expect(tfv).toContain('discord_public_key     = "pkey"');
  });
});

describe('renderEnv', () => {
  it('should include the API_TOKEN line with the provided token', () => {
    const a = makeAnswers();
    const env = renderEnv(a);
    expect(env).toContain(`API_TOKEN=${a.apiToken}`);
  });
});

describe('renderGitignore', () => {
  it('should ignore the .env file', () => {
    const gi = renderGitignore(makeAnswers());
    expect(gi).toContain('.env\n');
  });

  it('should ignore the .make/ stamp directory', () => {
    const gi = renderGitignore(makeAnswers());
    expect(gi).toContain('.make/');
  });

  it('should ignore terraform state files', () => {
    const gi = renderGitignore(makeAnswers());
    expect(gi).toContain('terraform.tfstate');
  });
});
