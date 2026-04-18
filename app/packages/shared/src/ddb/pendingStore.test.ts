import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { deletePending, getPending, putPending } from './pendingStore.js';
import { __resetDocClient } from './client.js';

const ddb = mockClient(DynamoDBDocumentClient);

const TABLE = 'test-discord';
const ARN = 'arn:aws:ecs:us-east-1:123:task/abc';

describe('putPending', () => {
  beforeEach(() => {
    ddb.reset();
    __resetDocClient();
  });

  it('should write a pending row keyed by the task ARN with a TTL 15 minutes out', async () => {
    ddb.on(PutCommand).resolves({});
    const before = Math.floor(Date.now() / 1000);
    await putPending(TABLE, {
      taskArn: ARN,
      applicationId: 'app1',
      interactionToken: 'tok1',
      userId: 'U1',
      guildId: 'G1',
      game: 'palworld',
      action: 'start',
    });
    const after = Math.floor(Date.now() / 1000);

    const calls = ddb.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    const item = calls[0]!.args[0]!.input.Item!;
    expect(item['pk']).toBe(`PENDING#${ARN}`);
    expect(item['sk']).toBe('PENDING');
    const data = item['data'] as Record<string, unknown>;
    expect(data['applicationId']).toBe('app1');
    expect(data['interactionToken']).toBe('tok1');
    expect(data['game']).toBe('palworld');
    expect(data['action']).toBe('start');

    const ttl = item['expiresAt'] as number;
    // Accept a small window to account for test runtime jitter.
    expect(ttl).toBeGreaterThanOrEqual(before + 15 * 60);
    expect(ttl).toBeLessThanOrEqual(after + 15 * 60 + 2);
  });
});

describe('getPending', () => {
  beforeEach(() => {
    ddb.reset();
    __resetDocClient();
  });

  it('should return null when no row exists for the ARN', async () => {
    ddb.on(GetCommand).resolves({});
    const result = await getPending(TABLE, ARN);
    expect(result).toBeNull();
  });

  it('should return the stored pending interaction', async () => {
    ddb.on(GetCommand).resolves({
      Item: {
        pk: `PENDING#${ARN}`,
        sk: 'PENDING',
        data: {
          taskArn: ARN,
          applicationId: 'app1',
          interactionToken: 'tok1',
          userId: 'U1',
          guildId: 'G1',
          game: 'palworld',
          action: 'start',
          expiresAt: 1234,
        },
      },
    });
    const result = await getPending(TABLE, ARN);
    expect(result).toMatchObject({
      taskArn: ARN,
      game: 'palworld',
      action: 'start',
    });
  });

  it('should perform a strongly consistent read to avoid races with RunTask', async () => {
    ddb.on(GetCommand).resolves({});
    await getPending(TABLE, ARN);
    const calls = ddb.commandCalls(GetCommand);
    expect(calls[0]!.args[0]!.input.ConsistentRead).toBe(true);
  });
});

describe('deletePending', () => {
  beforeEach(() => {
    ddb.reset();
    __resetDocClient();
  });

  it('should delete the row keyed by the task ARN', async () => {
    ddb.on(DeleteCommand).resolves({});
    await deletePending(TABLE, ARN);
    const calls = ddb.commandCalls(DeleteCommand);
    expect(calls).toHaveLength(1);
    const key = calls[0]!.args[0]!.input.Key!;
    expect(key['pk']).toBe(`PENDING#${ARN}`);
    expect(key['sk']).toBe('PENDING');
  });
});
