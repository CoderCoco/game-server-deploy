import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { ConfigService } from './ConfigService.js';

const mockExists = existsSync as unknown as ReturnType<typeof vi.fn>;
const mockRead = readFileSync as unknown as ReturnType<typeof vi.fn>;
const mockWrite = writeFileSync as unknown as ReturnType<typeof vi.fn>;

function makeState(outputs: Record<string, { value: unknown }>): string {
  return JSON.stringify({ outputs });
}

describe('ConfigService', () => {
  let service: ConfigService;

  beforeEach(() => {
    service = new ConfigService();
  });

  describe('getTfOutputs', () => {
    it('returns null and warns when state file does not exist', () => {
      mockExists.mockReturnValue(false);
      expect(service.getTfOutputs()).toBeNull();
    });

    it('parses outputs and fills defaults for missing keys', () => {
      mockExists.mockReturnValue(true);
      mockRead.mockReturnValue(
        makeState({
          aws_region: { value: 'us-west-2' },
          ecs_cluster_name: { value: 'my-cluster' },
          game_names: { value: ['minecraft', 'factorio'] },
        }),
      );

      const outputs = service.getTfOutputs();
      expect(outputs).not.toBeNull();
      expect(outputs!.aws_region).toBe('us-west-2');
      expect(outputs!.ecs_cluster_name).toBe('my-cluster');
      expect(outputs!.game_names).toEqual(['minecraft', 'factorio']);
      expect(outputs!.subnet_ids).toBe('');
      expect(outputs!.alb_dns_name).toBeNull();
      expect(outputs!.efs_access_points).toEqual({});
    });

    it('applies fallback aws_region when outputs omit it', () => {
      mockExists.mockReturnValue(true);
      mockRead.mockReturnValue(makeState({}));
      expect(service.getTfOutputs()!.aws_region).toBe('us-east-1');
    });

    it('caches parsed outputs across calls', () => {
      mockExists.mockReturnValue(true);
      mockRead.mockReturnValue(makeState({ aws_region: { value: 'eu-central-1' } }));

      service.getTfOutputs();
      service.getTfOutputs();

      expect(mockRead).toHaveBeenCalledTimes(1);
    });

    it('invalidateCache forces a re-read', () => {
      mockExists.mockReturnValue(true);
      mockRead.mockReturnValue(makeState({ aws_region: { value: 'a' } }));

      service.getTfOutputs();
      service.invalidateCache();
      mockRead.mockReturnValue(makeState({ aws_region: { value: 'b' } }));

      expect(service.getTfOutputs()!.aws_region).toBe('b');
      expect(mockRead).toHaveBeenCalledTimes(2);
    });

    it('returns null on invalid JSON', () => {
      mockExists.mockReturnValue(true);
      mockRead.mockReturnValue('not-json{');
      expect(service.getTfOutputs()).toBeNull();
    });
  });

  describe('getRegion', () => {
    it('uses aws_region from outputs when available', () => {
      mockExists.mockReturnValue(true);
      mockRead.mockReturnValue(makeState({ aws_region: { value: 'ap-south-1' } }));
      expect(service.getRegion()).toBe('ap-south-1');
    });

    it('falls back to AWS_DEFAULT_REGION env var when outputs unavailable', () => {
      mockExists.mockReturnValue(false);
      const prev = process.env['AWS_DEFAULT_REGION'];
      process.env['AWS_DEFAULT_REGION'] = 'eu-west-3';
      try {
        expect(service.getRegion()).toBe('eu-west-3');
      } finally {
        if (prev === undefined) delete process.env['AWS_DEFAULT_REGION'];
        else process.env['AWS_DEFAULT_REGION'] = prev;
      }
    });

    it('falls back to us-east-1 when no outputs and no env var', () => {
      mockExists.mockReturnValue(false);
      const prev = process.env['AWS_DEFAULT_REGION'];
      delete process.env['AWS_DEFAULT_REGION'];
      try {
        expect(service.getRegion()).toBe('us-east-1');
      } finally {
        if (prev !== undefined) process.env['AWS_DEFAULT_REGION'] = prev;
      }
    });
  });

  describe('getConfig', () => {
    it('returns defaults when config file missing', () => {
      mockExists.mockReturnValue(false);
      expect(service.getConfig()).toEqual({
        watchdog_interval_minutes: 15,
        watchdog_idle_checks: 4,
        watchdog_min_packets: 100,
      });
    });

    it('merges saved config over defaults', () => {
      mockExists.mockReturnValue(true);
      mockRead.mockReturnValue(
        JSON.stringify({ watchdog_idle_checks: 10, watchdog_min_packets: 250 }),
      );
      expect(service.getConfig()).toEqual({
        watchdog_interval_minutes: 15,
        watchdog_idle_checks: 10,
        watchdog_min_packets: 250,
      });
    });

    it('returns defaults if config file is malformed', () => {
      mockExists.mockReturnValue(true);
      mockRead.mockReturnValue('{bad json');
      const config = service.getConfig();
      expect(config.watchdog_interval_minutes).toBe(15);
      expect(config.watchdog_idle_checks).toBe(4);
      expect(config.watchdog_min_packets).toBe(100);
    });
  });

  describe('saveConfig', () => {
    it('writes JSON-stringified config to disk', () => {
      const config = {
        watchdog_interval_minutes: 30,
        watchdog_idle_checks: 6,
        watchdog_min_packets: 500,
      };
      service.saveConfig(config);
      expect(mockWrite).toHaveBeenCalledTimes(1);
      const [, payload] = mockWrite.mock.calls[0]!;
      expect(JSON.parse(payload as string)).toEqual(config);
    });
  });
});
