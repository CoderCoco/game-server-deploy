import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { PendingInteraction } from '../types.js';
import { getDocClient } from './client.js';

/** TTL for pending interactions. Discord interaction tokens expire after 15 minutes. */
const PENDING_TTL_SECONDS = 15 * 60;

function pendingPk(taskArn: string): string {
  return `PENDING#${taskArn}`;
}

/** Write a pending-interaction row. `expiresAt` is set to now + 15m (epoch seconds for DDB TTL). */
export async function putPending(
  tableName: string,
  item: Omit<PendingInteraction, 'expiresAt'>,
): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + PENDING_TTL_SECONDS;
  await getDocClient().send(
    new PutCommand({
      TableName: tableName,
      Item: {
        pk: pendingPk(item.taskArn),
        sk: 'PENDING',
        data: { ...item, expiresAt },
        expiresAt,
        updatedAt: Date.now(),
      },
    }),
  );
}

/** Point-lookup by task ARN; returns `null` if absent or expired. */
export async function getPending(tableName: string, taskArn: string): Promise<PendingInteraction | null> {
  const resp = await getDocClient().send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: pendingPk(taskArn), sk: 'PENDING' },
      ConsistentRead: true,
    }),
  );
  const data = resp.Item?.['data'];
  return (data as PendingInteraction | undefined) ?? null;
}

/** Remove a pending-interaction row. Idempotent. */
export async function deletePending(tableName: string, taskArn: string): Promise<void> {
  await getDocClient().send(
    new DeleteCommand({
      TableName: tableName,
      Key: { pk: pendingPk(taskArn), sk: 'PENDING' },
    }),
  );
}
