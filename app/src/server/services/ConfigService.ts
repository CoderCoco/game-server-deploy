import { injectable } from 'tsyringe';
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

@injectable()
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
