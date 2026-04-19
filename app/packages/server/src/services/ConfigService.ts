import { Injectable } from '@nestjs/common';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';

// Workspace move: ConfigService now lives one extra directory level deep
// (app/packages/server/src/services/ instead of app/src/server/services/),
// so the relative walk to the repo's `terraform/` folder needs one more `..`.
const __dirname = dirname(fileURLToPath(import.meta.url));
const TF_STATE_PATH = join(__dirname, '../../../../../../terraform/terraform.tfstate');
const CONFIG_PATH = join(__dirname, '../../../../../../app/server_config.json');

/**
 * Shape of the subset of Terraform root outputs the management app consumes.
 * Mirrors the `output` blocks in `terraform/*.tf`; add fields here (and in
 * `getTfOutputs()` below) when a new output becomes a dependency.
 */
export interface TfOutputs {
  aws_region: string;
  ecs_cluster_name: string;
  ecs_cluster_arn: string;
  subnet_ids: string;
  security_group_id: string;
  file_manager_security_group_id: string;
  efs_file_system_id: string;
  efs_access_points: Record<string, string>;
  domain_name: string;
  game_names: string[];
  alb_dns_name: string | null;
  acm_certificate_arn: string | null;
  discord_table_name: string;
  discord_bot_token_secret_arn: string;
  discord_public_key_secret_arn: string;
  interactions_invoke_url: string | null;
}

/**
 * User-editable watchdog tuning knobs persisted to `server_config.json`.
 * Consumed by the watchdog Lambda via Terraform variables; the UI only
 * displays/edits them — changes require `terraform apply` to take effect.
 */
export interface WatchdogConfig {
  watchdog_interval_minutes: number;
  watchdog_idle_checks: number;
  watchdog_min_packets: number;
}

const DEFAULT_CONFIG: WatchdogConfig = {
  watchdog_interval_minutes: 15,
  watchdog_idle_checks: 4,
  watchdog_min_packets: 100,
};

/**
 * Owns every runtime configuration source the management app reads:
 *  - `terraform.tfstate` (outputs of the last `terraform apply`) — parsed
 *    lazily and cached in-memory until {@link ConfigService.invalidateCache}
 *    is called.
 *  - `server_config.json` — the user-editable file holding the watchdog
 *    tunables and the optional API bearer token.
 *  - A handful of process env vars (`AWS_DEFAULT_REGION`, `API_TOKEN`).
 *
 * Every other service injects this one instead of touching `process.env` or
 * reading files directly, so tests can stub env/file access cleanly.
 */
@Injectable()
export class ConfigService {
  private tfCache: TfOutputs | null = null;

  /**
   * Drop the cached tfstate parse. Called from the `/api/games` and
   * `/api/status` handlers so a fresh `terraform apply` is picked up without
   * a server restart; tests also call it between scenarios.
   */
  invalidateCache(): void {
    this.tfCache = null;
  }

  /**
   * Parse `terraform/terraform.tfstate` (once, then memoised) and project the
   * pieces the app cares about. Returns `null` when the state file is absent
   * (pre-`terraform apply`) or unparseable — callers treat that as "infra
   * not deployed yet" and degrade gracefully.
   */
  getTfOutputs(): TfOutputs | null {
    if (this.tfCache) return this.tfCache;

    if (!existsSync(TF_STATE_PATH)) {
      logger.warn('Terraform state not found', { path: TF_STATE_PATH });
      return null;
    }

    try {
      const raw = JSON.parse(readFileSync(TF_STATE_PATH, 'utf-8')) as {
        outputs?: Record<string, { value: unknown }>;
      };
      const out = raw.outputs ?? {};
      const get = <T>(key: string, fallback: T): T =>
        key in out ? (out[key]!.value as T) : fallback;

      this.tfCache = {
        aws_region: get('aws_region', 'us-east-1'),
        ecs_cluster_name: get('ecs_cluster_name', ''),
        ecs_cluster_arn: get('ecs_cluster_arn', ''),
        subnet_ids: get('subnet_ids', ''),
        security_group_id: get('security_group_id', ''),
        file_manager_security_group_id: get('file_manager_security_group_id', ''),
        efs_file_system_id: get('efs_file_system_id', ''),
        efs_access_points: get('efs_access_points', {}),
        domain_name: get('domain_name', ''),
        game_names: get('game_names', []),
        alb_dns_name: get('alb_dns_name', null),
        acm_certificate_arn: get('acm_certificate_arn', null),
        discord_table_name: get('discord_table_name', ''),
        discord_bot_token_secret_arn: get('discord_bot_token_secret_arn', ''),
        discord_public_key_secret_arn: get('discord_public_key_secret_arn', ''),
        interactions_invoke_url: get('interactions_invoke_url', null),
      };

      logger.debug('Loaded Terraform outputs', { games: this.tfCache.game_names });
      return this.tfCache;
    } catch (err) {
      logger.error('Failed to parse Terraform state', { err, path: TF_STATE_PATH });
      return null;
    }
  }

  /**
   * Read the AWS region hint from the process environment.
   * Extracted so tests can stub env access via `vi.spyOn` instead of
   * mutating `process.env` directly (which is flaky across tests).
   */
  readEnvRegion(): string | undefined {
    return process.env['AWS_DEFAULT_REGION'];
  }

  /** Read the API bearer token from `API_TOKEN`. Extracted for test-stubbing. */
  readEnvApiToken(): string | undefined {
    return process.env['API_TOKEN'];
  }

  /**
   * Token required on every `/api/*` request's `Authorization: Bearer <token>` header.
   *
   * Resolution order:
   *  1. Env var `API_TOKEN` — wins when set, including when explicitly set to an
   *     empty string. Empty is normalized to `null` (treated as "no token
   *     configured") so setting `API_TOKEN=""` does not fall back to the file.
   *  2. `api_token` field in `server_config.json`.
   *
   * Returns `null` when no token is configured. The auth middleware + startup
   * check interpret null differently depending on environment:
   *  - `NODE_ENV=production` → `index.ts` refuses to start. An empty env var
   *    is therefore NOT a supported "auth disabled" mode in production.
   *  - development → the middleware logs a warning and allows unauthenticated
   *    requests so local iteration isn't blocked.
   */
  getApiToken(): string | null {
    const env = this.readEnvApiToken();
    if (env !== undefined) {
      return env.length > 0 ? env : null;
    }
    if (!existsSync(CONFIG_PATH)) return null;
    try {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as { api_token?: unknown };
      return typeof raw.api_token === 'string' && raw.api_token.length > 0 ? raw.api_token : null;
    } catch (err) {
      logger.warn('Could not read api_token from config file', { err });
      return null;
    }
  }

  /**
   * Resolve the AWS region for SDK clients. Prefers the region Terraform
   * provisioned into (so the app always points at the real infra), falls
   * back to `AWS_DEFAULT_REGION`, then to `us-east-1`.
   */
  getRegion(): string {
    return (
      this.getTfOutputs()?.aws_region ??
      this.readEnvRegion() ??
      'us-east-1'
    );
  }

  /**
   * Load the watchdog tunables from `server_config.json`, merged over the
   * built-in defaults so partially-populated files still work. Returns a
   * fresh object on every call — safe for callers to mutate.
   */
  getConfig(): WatchdogConfig {
    if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
    try {
      const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Partial<WatchdogConfig>;
      return { ...DEFAULT_CONFIG, ...saved };
    } catch (err) {
      logger.warn('Could not read config file, using defaults', { err });
      return { ...DEFAULT_CONFIG };
    }
  }

  /**
   * Persist the full watchdog config to `server_config.json`. Note: the
   * watchdog Lambda only reads these values via Terraform variables, so a
   * save here is not effective until the next `terraform apply`.
   */
  saveConfig(config: WatchdogConfig): void {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    logger.info('Config saved', config);
  }
}
