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
