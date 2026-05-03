import type { GameStatus, CostEstimates, EnvInfo, WatchdogConfig } from '../../src/api.js';

/** Stub response for `GET /api/env`. */
export const ENV_DATA: EnvInfo = {
  region: 'us-east-1',
  domain: 'example.com',
  environment: 'dev',
};

/** A single stopped game — use as the default single-game fixture. */
export const STOPPED_GAME: GameStatus = {
  game: 'minecraft',
  state: 'stopped',
};

/** A single running game with a public IP. */
export const RUNNING_GAME: GameStatus = {
  game: 'minecraft',
  state: 'running',
  publicIp: '1.2.3.4',
  hostname: 'minecraft.example.com',
  taskArn: 'arn:aws:ecs:us-east-1:123:task/minecraft/abc',
};

/** Two-game fixture covering stopped + running states. */
export const MULTI_GAME_STATUSES: GameStatus[] = [
  STOPPED_GAME,
  { game: 'valheim', state: 'running', publicIp: '5.6.7.8' },
];

/** Stub response for `GET /api/config` (the watchdog tuning panel). */
export const WATCHDOG_CONFIG: WatchdogConfig = {
  watchdog_interval_minutes: 15,
  watchdog_idle_checks: 4,
  watchdog_min_packets: 100,
};

/** Stub response for `GET /api/costs/estimate`. */
export const COST_DATA: CostEstimates = {
  games: {
    minecraft: {
      vcpu: 1,
      memoryGb: 2,
      costPerHour: 0.08,
      costPerDay24h: 1.92,
      costPerMonth4hpd: 9.6,
    },
  },
  totalPerHourIfAllOn: 0.08,
};

/**
 * A handful of CloudWatch lines with mixed log levels — used by the LogsPage
 * specs to exercise level-badge detection, search highlighting, and the
 * Levels filter.
 */
export const SAMPLE_LOG_LINES: string[] = [
  '2026-05-03T12:00:00Z INFO Server started on port 25565',
  '2026-05-03T12:00:01Z DEBUG Loaded world "world" in 1.2s',
  '2026-05-03T12:00:02Z WARN Deprecated config option "max-tick-time"',
  '2026-05-03T12:00:03Z ERROR Connection refused from 10.0.0.5',
  '2026-05-03T12:00:04Z Player joined the game',
];
