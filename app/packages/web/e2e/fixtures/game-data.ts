import type { GameStatus, CostEstimates, ActualCosts, EnvInfo, WatchdogConfig } from '../../src/api.js';

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

/** Multi-game estimates fixture for sort / filter specs on the Costs page. */
export const MULTI_GAME_COST_DATA: CostEstimates = {
  games: {
    minecraft: {
      vcpu: 1,
      memoryGb: 2,
      costPerHour: 0.08,
      costPerDay24h: 1.92,
      costPerMonth4hpd: 9.6,
    },
    valheim: {
      vcpu: 2,
      memoryGb: 4,
      costPerHour: 0.16,
      costPerDay24h: 3.84,
      costPerMonth4hpd: 19.2,
    },
    palworld: {
      vcpu: 4,
      memoryGb: 8,
      costPerHour: 0.32,
      costPerDay24h: 7.68,
      costPerMonth4hpd: 38.4,
    },
  },
  totalPerHourIfAllOn: 0.56,
};

/**
 * Build a deterministic `ActualCosts` payload with `days` daily entries.
 * The first half of the window costs $0.50/day and the second half costs
 * $1.00/day so the Costs page renders a non-zero delta-vs-prior pill when
 * the page fetches both the current `days=7` and the doubled `days=14`
 * windows from the same stub.
 */
export function makeActualCosts(days: number): ActualCosts {
  const daily = Array.from({ length: days }, (_, i) => ({
    date: `2026-04-${String((i % 30) + 1).padStart(2, '0')}`,
    cost: i < days / 2 ? 0.5 : 1.0,
  }));
  const total = daily.reduce((sum, d) => sum + d.cost, 0);
  return { daily, total: Math.round(total * 100) / 100, currency: 'USD', days };
}
