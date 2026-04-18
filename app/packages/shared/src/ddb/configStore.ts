import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DiscordConfig } from '../types.js';
import { asString, asStringArray, isSafeGameKey, sanitizeGamePermission } from '../sanitize.js';
import { getDocClient } from './client.js';

const CONFIG_PK = 'CONFIG#discord';
const CONFIG_SK = 'CONFIG';

/** Empty, mutable DiscordConfig used when no item exists yet. */
function emptyConfig(): DiscordConfig {
  return {
    clientId: '',
    allowedGuilds: [],
    admins: { userIds: [], roleIds: [] },
    gamePermissions: {},
  };
}

/**
 * Coerce a stored `data` payload into a valid DiscordConfig, dropping
 * unexpected types the same way DiscordConfigService.load() used to do for
 * on-disk JSON. Runs on every read so hand-edited DynamoDB items can't crash
 * the Lambda.
 */
function parseConfigData(raw: unknown): DiscordConfig {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawAdmins = (obj['admins'] ?? {}) as Record<string, unknown>;
  const rawGamePerms = (obj['gamePermissions'] ?? {}) as Record<string, unknown>;
  const gamePermissions: Record<string, ReturnType<typeof sanitizeGamePermission>> = {};
  for (const [game, perm] of Object.entries(rawGamePerms)) {
    if (isSafeGameKey(game)) gamePermissions[game] = sanitizeGamePermission(perm);
  }
  return {
    clientId: asString(obj['clientId']) ?? '',
    allowedGuilds: asStringArray(obj['allowedGuilds']),
    admins: {
      userIds: asStringArray(rawAdmins['userIds']),
      roleIds: asStringArray(rawAdmins['roleIds']),
    },
    gamePermissions,
  };
}

/** Read the single DiscordConfig row; returns an empty config if the item is absent. */
export async function getDiscordConfig(tableName: string): Promise<DiscordConfig> {
  const resp = await getDocClient().send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: CONFIG_PK, sk: CONFIG_SK },
      ConsistentRead: true,
    }),
  );
  if (!resp.Item) return emptyConfig();
  return parseConfigData(resp.Item['data']);
}

/** Overwrite the single DiscordConfig row. */
export async function putDiscordConfig(tableName: string, cfg: DiscordConfig): Promise<void> {
  await getDocClient().send(
    new PutCommand({
      TableName: tableName,
      Item: {
        pk: CONFIG_PK,
        sk: CONFIG_SK,
        data: cfg,
        updatedAt: Date.now(),
      },
    }),
  );
}
