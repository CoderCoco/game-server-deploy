import { Injectable } from '@nestjs/common';
import {
  ECSClient,
  ListTasksCommand,
  DescribeTasksCommand,
  RunTaskCommand,
  StopTaskCommand,
  DescribeTaskDefinitionCommand,
  type Task,
} from '@aws-sdk/client-ecs';
import { logger } from '../logger.js';
import { ConfigService } from './ConfigService.js';
import { Ec2Service } from './Ec2Service.js';

/**
 * Snapshot of a game's current state as surfaced to the UI/Discord. The
 * `state` distinguishes "running" (task `RUNNING`, IP resolved) from
 * "starting" (task exists but still provisioning) so the UI can show a
 * spinner rather than an unreachable hostname.
 */
export interface GameStatus {
  game: string;
  state: 'running' | 'starting' | 'stopped' | 'not_deployed' | 'error';
  publicIp?: string;
  hostname?: string;
  taskArn?: string;
  message?: string;
}

/**
 * Result shape for start/stop operations. Reused for both because the UI
 * treats them symmetrically (success toast on happy path, error toast on the
 * `message` otherwise).
 */
export interface StartResult {
  success: boolean;
  message: string;
  taskArn?: string;
}

/**
 * ECS facade for the management app. Wraps `RunTask` / `StopTask` /
 * `DescribeTasks` plus the FileBrowser-specific helpers used by
 * {@link FileManagerService}. There is intentionally no long-running ECS
 * Service here — the core cost-saving design is "run a one-off task only
 * when the user clicks Start, stop it when the watchdog or user decides".
 */
@Injectable()
export class EcsService {
  private client: ECSClient | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly ec2: Ec2Service,
  ) {}

  private getClient(): ECSClient {
    if (!this.client) {
      this.client = new ECSClient({ region: this.config.getRegion() });
    }
    return this.client;
  }

  /**
   * Dig the ENI ID out of a task's `attachments` array. Needed because the
   * public IP isn't on the task itself — it has to be looked up via EC2
   * using this ENI. Returns `null` if the task has no ENI attachment yet
   * (common while a task is still provisioning).
   */
  extractEniId(task: Task): string | null {
    for (const att of task.attachments ?? []) {
      if (att.type !== 'ElasticNetworkInterface') continue;
      for (const detail of att.details ?? []) {
        if (detail.name === 'networkInterfaceId') return detail.value ?? null;
      }
    }
    return null;
  }

  /**
   * Locate the current non-stopped task for a game, keyed by the `{game}-server`
   * task-definition family Terraform provisions. `ListTasks` is filtered to
   * `desiredStatus: RUNNING` and STOPPED/DEPROVISIONING tasks are filtered
   * out of the describe result — leaving the single active task, if any.
   */
  async findRunningTask(cluster: string, game: string): Promise<Task | null> {
    try {
      const listResp = await this.getClient().send(
        new ListTasksCommand({ cluster, family: `${game}-server`, desiredStatus: 'RUNNING' }),
      );
      if (!listResp.taskArns?.length) return null;

      const descResp = await this.getClient().send(
        new DescribeTasksCommand({ cluster, tasks: listResp.taskArns }),
      );
      return (
        descResp.tasks?.find(
          (t) => t.lastStatus !== 'STOPPED' && t.lastStatus !== 'DEPROVISIONING',
        ) ?? null
      );
    } catch (err) {
      logger.error('Failed to find running task', { err, game });
      return null;
    }
  }

  /**
   * Assemble the full status (state + IP + hostname) for a single game.
   * Consolidates the task lookup, ENI resolution and DNS-name construction
   * so controllers can map directly to an API response.
   */
  async getStatus(game: string): Promise<GameStatus> {
    const outputs = this.config.getTfOutputs();
    if (!outputs) return { game, state: 'not_deployed', message: 'Run terraform apply first.' };

    const cluster = outputs.ecs_cluster_name;
    const domain = outputs.domain_name;

    try {
      const task = await this.findRunningTask(cluster, game);
      if (task) {
        if (task.lastStatus === 'RUNNING') {
          const eniId = this.extractEniId(task);
          const publicIp = eniId ? await this.ec2.getPublicIp(eniId) : null;
          return {
            game,
            state: 'running',
            publicIp: publicIp ?? undefined,
            hostname: domain ? `${game}.${domain}` : undefined,
            taskArn: task.taskArn,
          };
        }
        return { game, state: 'starting', taskArn: task.taskArn };
      }
      return { game, state: 'stopped' };
    } catch (err) {
      logger.error('Failed to get server status', { err, game });
      return { game, state: 'error', message: String(err) };
    }
  }

  /**
   * Launch a one-off Fargate task from the game's `{game}-server` task
   * definition. Refuses to start a second task when one is already running
   * (ECS would happily run duplicates otherwise). The DNS record is created
   * asynchronously by the update-dns Lambda when the task reaches RUNNING.
   */
  async start(game: string): Promise<StartResult> {
    const outputs = this.config.getTfOutputs();
    if (!outputs)
      return { success: false, message: "Terraform not applied. Run 'terraform apply' first." };

    const { ecs_cluster_name: cluster, subnet_ids, security_group_id: sg } = outputs;
    const subnets = subnet_ids.split(',').map((s) => s.trim()).filter(Boolean);

    const existing = await this.findRunningTask(cluster, game);
    if (existing) return { success: false, message: `${game} is already running.` };

    logger.info('Starting game server', { game, cluster });
    try {
      const resp = await this.getClient().send(
        new RunTaskCommand({
          cluster,
          taskDefinition: `${game}-server`,
          count: 1,
          launchType: 'FARGATE',
          networkConfiguration: {
            awsvpcConfiguration: { subnets, securityGroups: [sg], assignPublicIp: 'ENABLED' },
          },
        }),
      );
      if (resp.tasks?.length) {
        const taskArn = resp.tasks[0]!.taskArn;
        logger.info('Game server started', { game, taskArn });
        return { success: true, message: `${game} is starting. It may take 2–5 minutes.`, taskArn };
      }
      const reason = resp.failures?.[0]?.reason ?? 'unknown';
      logger.error('RunTask failed', { game, reason, failures: resp.failures });
      return { success: false, message: `Failed to start ${game}: ${reason}` };
    } catch (err) {
      logger.error('Exception starting game server', { err, game });
      return { success: false, message: String(err) };
    }
  }

  /**
   * Stop the active task for `game`. The STOPPED state-change event fires
   * the update-dns Lambda which deletes the Route 53 record — no DNS
   * cleanup needed here.
   */
  async stop(game: string): Promise<StartResult> {
    const outputs = this.config.getTfOutputs();
    if (!outputs) return { success: false, message: 'Terraform not applied.' };

    const cluster = outputs.ecs_cluster_name;
    const task = await this.findRunningTask(cluster, game);
    if (!task) return { success: false, message: `${game} is not currently running.` };

    logger.info('Stopping game server', { game, taskArn: task.taskArn });
    try {
      await this.getClient().send(
        new StopTaskCommand({ cluster, task: task.taskArn, reason: 'Stopped via management app' }),
      );
      return { success: true, message: `${game} is stopping.` };
    } catch (err) {
      logger.error('Exception stopping game server', { err, game });
      return { success: false, message: String(err) };
    }
  }

  /**
   * Fetch the latest revision of `{game}-server` to read its CPU/memory (for
   * cost estimates) and execution role (reused when the FileBrowser task
   * definition is registered on the fly).
   */
  async getTaskDefinition(game: string): Promise<{ cpu: number; memory: number; executionRoleArn: string } | null> {
    try {
      const resp = await this.getClient().send(
        new DescribeTaskDefinitionCommand({ taskDefinition: `${game}-server` }),
      );
      const td = resp.taskDefinition;
      if (!td) return null;
      return {
        cpu: parseInt(td.cpu ?? '1024', 10),
        memory: parseInt(td.memory ?? '2048', 10),
        executionRoleArn: td.executionRoleArn ?? '',
      };
    } catch (err) {
      logger.error('Failed to describe task definition', { err, game });
      return null;
    }
  }

  /**
   * Register a new task-definition revision on the fly. Used exclusively by
   * {@link FileManagerService.start} to build the FileBrowser task def per
   * game — game-server task definitions themselves are Terraform-managed.
   */
  async registerTaskDefinition(params: Parameters<ECSClient['send']>[0] extends import('@aws-sdk/client-ecs').RegisterTaskDefinitionCommand ? never : import('@aws-sdk/client-ecs').RegisterTaskDefinitionCommandInput): Promise<string | null> {
    const { RegisterTaskDefinitionCommand } = await import('@aws-sdk/client-ecs');
    try {
      const resp = await this.getClient().send(new RegisterTaskDefinitionCommand(params));
      const arn = resp.taskDefinition?.taskDefinitionArn ?? null;
      logger.info('Registered task definition', { family: params.family, arn });
      return arn;
    } catch (err) {
      logger.error('Failed to register task definition', { err, family: params.family });
      return null;
    }
  }

  /**
   * Low-level `RunTask` passthrough for callers that need to set their own
   * `startedBy` tag or networking (notably the FileBrowser launcher).
   * {@link EcsService.start} is the preferred entry point for game servers.
   */
  async runTask(params: import('@aws-sdk/client-ecs').RunTaskCommandInput): Promise<{ taskArn: string } | null> {
    try {
      const resp = await this.getClient().send(new RunTaskCommand(params));
      if (resp.tasks?.length) {
        const taskArn = resp.tasks[0]!.taskArn!;
        logger.info('Task started', { taskArn, startedBy: params.startedBy });
        return { taskArn };
      }
      const reason = resp.failures?.[0]?.reason ?? 'unknown';
      logger.error('RunTask failed', { reason, failures: resp.failures, params });
      return null;
    } catch (err) {
      logger.error('Exception running task', { err });
      return null;
    }
  }

  /**
   * Find active tasks tagged with a given `startedBy` value — the marker
   * the FileBrowser launcher uses (`filemgr-{game}`) to locate its own
   * tasks without relying on a bespoke task-definition family.
   */
  async listTasksByStartedBy(cluster: string, startedBy: string): Promise<Task[]> {
    try {
      const listResp = await this.getClient().send(
        new ListTasksCommand({ cluster, startedBy, desiredStatus: 'RUNNING' }),
      );
      if (!listResp.taskArns?.length) return [];
      const descResp = await this.getClient().send(
        new DescribeTasksCommand({ cluster, tasks: listResp.taskArns }),
      );
      return (
        descResp.tasks?.filter(
          (t) => t.lastStatus !== 'STOPPED' && t.lastStatus !== 'DEPROVISIONING',
        ) ?? []
      );
    } catch (err) {
      logger.error('Failed to list tasks by startedBy', { err, startedBy });
      return [];
    }
  }

  /**
   * Raw `StopTask` wrapper for callers that already hold an ARN (FileBrowser
   * and similar) and don't want the family-based lookup {@link EcsService.stop}
   * performs.
   */
  async stopTask(cluster: string, taskArn: string, reason: string): Promise<void> {
    await this.getClient().send(new StopTaskCommand({ cluster, task: taskArn, reason }));
  }
}
