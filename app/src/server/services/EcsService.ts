import { injectable } from 'tsyringe';
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

export interface GameStatus {
  game: string;
  state: 'running' | 'starting' | 'stopped' | 'not_deployed' | 'error';
  publicIp?: string;
  hostname?: string;
  taskArn?: string;
  message?: string;
}

export interface StartResult {
  success: boolean;
  message: string;
  taskArn?: string;
}

@injectable()
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

  extractEniId(task: Task): string | null {
    for (const att of task.attachments ?? []) {
      if (att.type !== 'ElasticNetworkInterface') continue;
      for (const detail of att.details ?? []) {
        if (detail.name === 'networkInterfaceId') return detail.value ?? null;
      }
    }
    return null;
  }

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

  async stopTask(cluster: string, taskArn: string, reason: string): Promise<void> {
    await this.getClient().send(new StopTaskCommand({ cluster, task: taskArn, reason }));
  }
}
