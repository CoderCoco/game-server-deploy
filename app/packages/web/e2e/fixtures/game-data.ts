import type {
  GameStatus,
  CostEstimates,
  EnvInfo,
  WatchdogConfig,
  DiscordConfigRedacted,
} from '../../src/api.js';

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

/** A valid Discord snowflake (17–20 digits) for use in test inputs. */
export const VALID_GUILD_ID = '123456789012345678';
/** A second valid snowflake — useful for multi-guild specs. */
export const VALID_GUILD_ID_2 = '987654321098765432';
/** A valid user-shaped snowflake for admin/permission specs. */
export const VALID_USER_ID = '111122223333444455';

/**
 * First-run Discord config — no guilds, no admins, no secrets configured.
 * Triggers the `/discord` setup-wizard render path.
 */
export const FIRST_RUN_DISCORD_CONFIG: DiscordConfigRedacted = {
  clientId: '',
  allowedGuilds: [],
  admins: { userIds: [], roleIds: [] },
  gamePermissions: {},
  baseAllowedGuilds: [],
  baseAdmins: { userIds: [], roleIds: [] },
  botTokenSet: false,
  publicKeySet: false,
  interactionsEndpointUrl: null,
};

/**
 * Fully-configured Discord config — bot token + public key set, one allowlisted
 * guild, one admin user. Used to exercise the post-setup tabs.
 */
export const CONFIGURED_DISCORD_CONFIG: DiscordConfigRedacted = {
  clientId: '111111111111111111',
  allowedGuilds: [VALID_GUILD_ID],
  admins: { userIds: [VALID_USER_ID], roleIds: [] },
  gamePermissions: {},
  baseAllowedGuilds: [],
  baseAdmins: { userIds: [], roleIds: [] },
  botTokenSet: true,
  publicKeySet: true,
  interactionsEndpointUrl:
    'https://abc123.lambda-url.us-east-1.on.aws/',
};
