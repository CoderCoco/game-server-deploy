import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { getDiscordConfig, putDiscordConfig } from './configStore.js';
import { __resetDocClient } from './client.js';

const ddb = mockClient(DynamoDBDocumentClient);

const TABLE = 'test-discord';

describe('getDiscordConfig', () => {
  beforeEach(() => {
    ddb.reset();
    __resetDocClient();
  });

  it('should return an empty config when the row is missing so a fresh deploy still boots', async () => {
    ddb.on(GetCommand).resolves({});
    const cfg = await getDiscordConfig(TABLE);
    expect(cfg).toEqual({
      clientId: '',
      allowedGuilds: [],
      admins: { userIds: [], roleIds: [] },
      gamePermissions: {},
    });
  });

  it('should parse a well-formed stored config verbatim', async () => {
    ddb.on(GetCommand).resolves({
      Item: {
        pk: 'CONFIG#discord',
        sk: 'CONFIG',
        data: {
          clientId: 'abc123',
          allowedGuilds: ['G1', 'G2'],
          admins: { userIds: ['U1'], roleIds: ['R1'] },
          gamePermissions: {
            palworld: { userIds: ['U2'], roleIds: [], actions: ['start'] },
          },
        },
      },
    });
    const cfg = await getDiscordConfig(TABLE);
    expect(cfg.clientId).toBe('abc123');
    expect(cfg.allowedGuilds).toEqual(['G1', 'G2']);
    expect(cfg.admins).toEqual({ userIds: ['U1'], roleIds: ['R1'] });
    expect(cfg.gamePermissions.palworld).toEqual({
      userIds: ['U2'],
      roleIds: [],
      actions: ['start'],
    });
  });

  it('should sanitize malformed stored data instead of throwing', async () => {
    ddb.on(GetCommand).resolves({
      Item: {
        pk: 'CONFIG#discord',
        sk: 'CONFIG',
        data: {
          clientId: 42,
          allowedGuilds: 'not-an-array',
          admins: { userIds: [null, 'U1'] },
          gamePermissions: {
            palworld: { userIds: 'nope', roleIds: ['R1'], actions: ['start', 'invalid'] },
          },
        },
      },
    });
    const cfg = await getDiscordConfig(TABLE);
    expect(cfg.clientId).toBe('');
    expect(cfg.allowedGuilds).toEqual([]);
    expect(cfg.admins.userIds).toEqual(['U1']);
    expect(cfg.gamePermissions.palworld).toEqual({
      userIds: [],
      roleIds: ['R1'],
      actions: ['start'],
    });
  });

  it('should drop prototype-pollution game keys on read', async () => {
    ddb.on(GetCommand).resolves({
      Item: {
        data: {
          gamePermissions: {
            __proto__: { userIds: ['attacker'], roleIds: [], actions: ['start'] },
            palworld: { userIds: [], roleIds: [], actions: ['start'] },
          },
        },
      },
    });
    const cfg = await getDiscordConfig(TABLE);
    expect(Object.keys(cfg.gamePermissions)).toEqual(['palworld']);
  });

  it('should issue a strongly consistent read for config', async () => {
    ddb.on(GetCommand).resolves({});
    await getDiscordConfig(TABLE);
    const calls = ddb.commandCalls(GetCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0]!.input.ConsistentRead).toBe(true);
  });
});

describe('putDiscordConfig', () => {
  beforeEach(() => {
    ddb.reset();
    __resetDocClient();
  });

  it('should write the config under the fixed partition key', async () => {
    ddb.on(PutCommand).resolves({});
    await putDiscordConfig(TABLE, {
      clientId: 'abc',
      allowedGuilds: ['G1'],
      admins: { userIds: [], roleIds: [] },
      gamePermissions: {},
    });
    const calls = ddb.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    const item = calls[0]!.args[0]!.input.Item!;
    expect(item['pk']).toBe('CONFIG#discord');
    expect(item['sk']).toBe('CONFIG');
    expect(item['data']).toMatchObject({ clientId: 'abc', allowedGuilds: ['G1'] });
    expect(typeof item['updatedAt']).toBe('number');
  });
});
