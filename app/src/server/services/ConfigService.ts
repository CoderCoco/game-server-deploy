import { Injectable } from '@nestjs/common';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TF_STATE_PATH = join(__dirname, '../../../../../terraform/terraform.tfstate');
const CONFIG_PATH = join(__dirname, '../../../../../app/server_config.json');

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
}

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

@Injectable()
export class ConfigService {
  private tfCache: TfOutputs | null = null;

  invalidateCache(): void {
    this.tfCache = null;
  }

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

  getRegion(): string {
    return (
      this.getTfOutputs()?.aws_region ??
      this.readEnvRegion() ??
      'us-east-1'
    );
  }

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

  saveConfig(config: WatchdogConfig): void {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    logger.info('Config saved', config);
  }
}
