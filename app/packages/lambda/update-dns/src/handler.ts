/**
 * DNS updater Lambda — TypeScript port of the original `update_dns.py`.
 *
 * Triggered by EventBridge on `ECS Task State Change`.
 *
 * For non-HTTPS games (direct Fargate IP):
 *   - RUNNING → resolve ENI public IP → UPSERT Route 53 A record
 *   - STOPPED → DELETE Route 53 A record
 *
 * For HTTPS games (ALB-fronted):
 *   - RUNNING → resolve private IP → register with ALB target group
 *   - STOPPED → deregister from ALB target group
 *
 * New behaviour added in the serverless-Discord migration: on RUNNING, after
 * the DNS/ALB update, look up a pending Discord interaction by task ARN and
 * PATCH the original message with the resolved hostname/IP, then delete the
 * pending row. The Discord interaction token in the pending row is valid for
 * up to 15 minutes — same window as the ECS provisioning timeline.
 */
import {
  ECSClient,
  DescribeTasksCommand,
  type Task,
} from '@aws-sdk/client-ecs';
import {
  EC2Client,
  DescribeNetworkInterfacesCommand,
} from '@aws-sdk/client-ec2';
import {
  ElasticLoadBalancingV2Client,
  RegisterTargetsCommand,
  DeregisterTargetsCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  Route53Client,
  ChangeResourceRecordSetsCommand,
  ListResourceRecordSetsCommand,
} from '@aws-sdk/client-route-53';
import { deletePending, formatGameStatus, getPending } from '@gsd/shared';

const HOSTED_ZONE_ID = requireEnv('HOSTED_ZONE_ID');
const DOMAIN_NAME = requireEnv('DOMAIN_NAME');
const GAME_NAMES = (process.env['GAME_NAMES'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const DNS_TTL = parseInt(process.env['DNS_TTL'] ?? '30', 10);
const HTTPS_GAMES = new Set(
  (process.env['HTTPS_GAMES'] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
);
const ALB_TARGET_GROUPS: Record<string, string> = JSON.parse(
  process.env['ALB_TARGET_GROUPS'] ?? '{}',
);
const TABLE_NAME = process.env['TABLE_NAME'] ?? '';

/** Per-game connect message templates from Terraform, keyed by game name. */
const CONNECT_MESSAGES: Record<string, string> = JSON.parse(process.env['CONNECT_MESSAGES'] ?? '{}');

/** First container port per game, used to resolve the `{port}` placeholder. */
const GAME_PORTS: Record<string, number> = JSON.parse(process.env['GAME_PORTS'] ?? '{}');

const FAMILY_TO_GAME = new Map<string, string>(GAME_NAMES.map((g) => [`${g}-server`, g]));

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

function region(): string {
  return (
    process.env['AWS_REGION_'] ??
    process.env['AWS_REGION'] ??
    process.env['AWS_DEFAULT_REGION'] ??
    'us-east-1'
  );
}

const ec2 = new EC2Client({ region: region() });
const ecs = new ECSClient({ region: region() });
const elbv2 = new ElasticLoadBalancingV2Client({ region: region() });
const route53 = new Route53Client({});

function extractEniId(task: Task): string | null {
  for (const att of task.attachments ?? []) {
    if (att.type !== 'ElasticNetworkInterface') continue;
    for (const detail of att.details ?? []) {
      if (detail.name === 'networkInterfaceId') return detail.value ?? null;
    }
  }
  return null;
}

async function getEniPublicIp(eniId: string): Promise<string | null> {
  const resp = await ec2.send(new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [eniId] }));
  return resp.NetworkInterfaces?.[0]?.Association?.PublicIp ?? null;
}

async function getEniPrivateIp(eniId: string): Promise<string | null> {
  const resp = await ec2.send(new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [eniId] }));
  return resp.NetworkInterfaces?.[0]?.PrivateIpAddress ?? null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Retry a few times since ENI association can lag behind the RUNNING event.
 * Mirrors the 5-attempt loop with 3s sleeps from update_dns.py.
 */
async function resolveIp(
  taskArn: string,
  clusterArn: string,
  kind: 'public' | 'private',
): Promise<string | null> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const resp = await ecs.send(new DescribeTasksCommand({ cluster: clusterArn, tasks: [taskArn] }));
      const task = resp.tasks?.[0];
      if (!task) {
        await sleep(3000);
        continue;
      }
      const eniId = extractEniId(task);
      if (!eniId) {
        await sleep(3000);
        continue;
      }
      const ip = kind === 'public' ? await getEniPublicIp(eniId) : await getEniPrivateIp(eniId);
      if (ip) return ip;
    } catch (err) {
      console.error(`IP resolution attempt ${attempt} failed`, { err });
    }
    await sleep(3000);
  }
  return null;
}

async function upsertDns(dnsName: string, ip: string): Promise<void> {
  await route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: HOSTED_ZONE_ID,
      ChangeBatch: {
        Comment: `Game server auto-upsert for ${dnsName}`,
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: {
              Name: dnsName,
              Type: 'A',
              TTL: DNS_TTL,
              ResourceRecords: [{ Value: ip }],
            },
          },
        ],
      },
    }),
  );
}

async function currentRecordIp(dnsName: string): Promise<string | null> {
  try {
    const resp = await route53.send(
      new ListResourceRecordSetsCommand({
        HostedZoneId: HOSTED_ZONE_ID,
        StartRecordName: dnsName,
        StartRecordType: 'A',
        MaxItems: 1,
      }),
    );
    for (const rrs of resp.ResourceRecordSets ?? []) {
      if (rrs.Name?.replace(/\.$/, '') === dnsName.replace(/\.$/, '') && rrs.Type === 'A') {
        return rrs.ResourceRecords?.[0]?.Value ?? null;
      }
    }
  } catch (err) {
    console.warn('Could not look up current record', { dnsName, err });
  }
  return null;
}

async function deleteDns(dnsName: string): Promise<void> {
  const ip = await currentRecordIp(dnsName);
  if (!ip) {
    console.log(`No DNS record exists for ${dnsName} — nothing to delete.`);
    return;
  }
  try {
    await route53.send(
      new ChangeResourceRecordSetsCommand({
        HostedZoneId: HOSTED_ZONE_ID,
        ChangeBatch: {
          Comment: `Game server auto-delete for ${dnsName}`,
          Changes: [
            {
              Action: 'DELETE',
              ResourceRecordSet: {
                Name: dnsName,
                Type: 'A',
                TTL: DNS_TTL,
                ResourceRecords: [{ Value: ip }],
              },
            },
          ],
        },
      }),
    );
  } catch (err) {
    console.warn('Could not delete DNS record', { dnsName, err });
  }
}

async function registerAlb(tgArn: string, ip: string): Promise<void> {
  await elbv2.send(new RegisterTargetsCommand({ TargetGroupArn: tgArn, Targets: [{ Id: ip }] }));
}

async function deregisterAlb(tgArn: string, ip: string): Promise<void> {
  try {
    await elbv2.send(new DeregisterTargetsCommand({ TargetGroupArn: tgArn, Targets: [{ Id: ip }] }));
  } catch (err) {
    console.warn('Could not deregister ALB target', { tgArn, ip, err });
  }
}

const DISCORD_API = 'https://discord.com/api/v10';

async function patchOriginal(
  applicationId: string,
  interactionToken: string,
  content: string,
): Promise<void> {
  const url = `${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error('Discord PATCH failed', { status: resp.status, body });
  }
}

/**
 * If a Discord interaction is pending for this task, PATCH it with the
 * resolved hostname/IP and delete the pending row.
 */
async function notifyDiscordIfPending(
  taskArn: string,
  game: string,
  publicIp: string,
): Promise<void> {
  if (!TABLE_NAME) return;
  try {
    const pending = await getPending(TABLE_NAME, taskArn);
    if (!pending) return;
    const hostname = `${game}.${DOMAIN_NAME}`;
    const message = formatGameStatus(
      { game, state: 'running', publicIp, hostname, taskArn },
      CONNECT_MESSAGES[game],
      GAME_PORTS[game],
    );
    await patchOriginal(pending.applicationId, pending.interactionToken, message);
    await deletePending(TABLE_NAME, taskArn);
  } catch (err) {
    console.error('Discord followup notification failed', { err, taskArn });
  }
}

interface EcsStateChangeEvent {
  detail?: {
    lastStatus?: string;
    taskArn?: string;
    clusterArn?: string;
    group?: string;
  };
}

interface HandlerResult {
  status: string;
  game?: string;
  ip?: string;
  reason?: string;
  lastStatus?: string;
}

async function handleDirect(
  game: string,
  dnsName: string,
  taskArn: string,
  clusterArn: string,
  lastStatus: string,
): Promise<HandlerResult> {
  if (lastStatus === 'RUNNING') {
    const ip = await resolveIp(taskArn, clusterArn, 'public');
    if (!ip) {
      console.warn(`Could not resolve public IP for ${taskArn}`);
      return { status: 'error', reason: 'no_ip' };
    }
    await upsertDns(dnsName, ip);
    await notifyDiscordIfPending(taskArn, game, ip);
    return { status: 'upserted', game, ip };
  }
  if (lastStatus === 'STOPPED') {
    await deleteDns(dnsName);
    return { status: 'deleted', game };
  }
  return { status: 'no_action', lastStatus };
}

async function handleHttps(
  game: string,
  taskArn: string,
  clusterArn: string,
  lastStatus: string,
): Promise<HandlerResult> {
  const tgArn = ALB_TARGET_GROUPS[game];
  if (!tgArn) {
    console.error(`No ALB target group configured for HTTPS game ${game}`);
    return { status: 'error', reason: 'no_target_group' };
  }
  if (lastStatus === 'RUNNING') {
    const ip = await resolveIp(taskArn, clusterArn, 'private');
    if (!ip) return { status: 'error', reason: 'no_ip' };
    await registerAlb(tgArn, ip);
    await notifyDiscordIfPending(taskArn, game, ip);
    return { status: 'registered', game, ip };
  }
  if (lastStatus === 'STOPPED') {
    const ip = await resolveIp(taskArn, clusterArn, 'private');
    if (ip) await deregisterAlb(tgArn, ip);
    return { status: 'deregistered', game };
  }
  return { status: 'no_action', lastStatus };
}

/**
 * Fired by an EventBridge rule on `ECS Task State Change`. UPSERTs a Route 53 record
 * for `{game}.{hosted_zone_name}` on RUNNING and DELETEs on STOPPED — DNS is owned by
 * this Lambda rather than Terraform so records follow ephemeral task IPs without
 * fighting state. HTTPS games route through an ALB target group instead, and on
 * RUNNING this also PATCHes any `PENDING#{taskArn}` Discord interaction in DynamoDB
 * so the user sees the resolved address in the same message they clicked on.
 */
export const handler = async (event: EcsStateChangeEvent): Promise<HandlerResult> => {
  console.log('DNS updater triggered', JSON.stringify(event));
  const detail = event.detail ?? {};
  const lastStatus = detail.lastStatus ?? '';
  const taskArn = detail.taskArn ?? '';
  const clusterArn = detail.clusterArn ?? '';
  const family = (detail.group ?? '').replace('family:', '');
  const game = FAMILY_TO_GAME.get(family);

  if (!game) {
    console.log(`Task family ${family} is not a known game server — skipping.`);
    return { status: 'skipped', reason: `unknown family: ${family}` };
  }

  const dnsName = `${game}.${DOMAIN_NAME}`;
  const isHttps = HTTPS_GAMES.has(game);

  return isHttps
    ? handleHttps(game, taskArn, clusterArn, lastStatus)
    : handleDirect(game, dnsName, taskArn, clusterArn, lastStatus);
};
