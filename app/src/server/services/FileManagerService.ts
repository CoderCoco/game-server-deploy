import { injectable } from 'tsyringe';
import { type Task } from '@aws-sdk/client-ecs';
import { logger } from '../logger.js';
import { ConfigService } from './ConfigService.js';
import { EcsService } from './EcsService.js';
import { Ec2Service } from './Ec2Service.js';

const FILEBROWSER_IMAGE = 'filebrowser/filebrowser:latest';
const FILEBROWSER_PORT = 8080;
const STARTED_BY_PREFIX = 'filemgr-';

export interface FileMgrStatus {
  game: string;
  state: 'running' | 'starting' | 'stopped' | 'not_deployed';
  url?: string;
  taskArn?: string;
}

export interface FileMgrResult {
  success: boolean;
  message: string;
  taskArn?: string;
}

@injectable()
export class FileManagerService {
  constructor(
    private readonly config: ConfigService,
    private readonly ecs: EcsService,
    private readonly ec2: Ec2Service,
  ) {}

  private startedByKey(game: string): string {
    return `${STARTED_BY_PREFIX}${game}`;
  }

  async getStatus(game: string): Promise<FileMgrStatus> {
    const outputs = this.config.getTfOutputs();
    if (!outputs) return { game, state: 'not_deployed' };

    const tasks = await this.ecs.listTasksByStartedBy(
      outputs.ecs_cluster_name,
      this.startedByKey(game),
    );

    if (!tasks.length) return { game, state: 'stopped' };

    const task = tasks[0]!;
    if (task.lastStatus === 'RUNNING') {
      const eniId = this.ecs.extractEniId(task);
      const publicIp = eniId ? await this.ec2.getPublicIp(eniId) : null;
      const url = publicIp ? `http://${publicIp}:${FILEBROWSER_PORT}` : undefined;
      logger.debug('File manager status', { game, publicIp, url });
      return { game, state: 'running', url, taskArn: task.taskArn };
    }

    return { game, state: 'starting', taskArn: task.taskArn };
  }

  async start(game: string): Promise<FileMgrResult> {
    const outputs = this.config.getTfOutputs();
    if (!outputs) {
      return { success: false, message: "Terraform not applied. Run 'terraform apply' first." };
    }

    const apId = outputs.efs_access_points[game];
    if (!apId) {
      logger.error('No EFS access point for game', { game, available: outputs.efs_access_points });
      return { success: false, message: `No EFS access point found for '${game}'.` };
    }

    const filemgrSg = outputs.file_manager_security_group_id;
    if (!filemgrSg) {
      return { success: false, message: 'file_manager_security_group_id not in Terraform outputs. Run terraform apply.' };
    }

    // Guard: don't start if already running
    const existing = await this.ecs.listTasksByStartedBy(outputs.ecs_cluster_name, this.startedByKey(game));
    if (existing.length) {
      return { success: false, message: `File manager for '${game}' is already running.` };
    }

    // Get execution role from the game's own task definition
    const taskDef = await this.ecs.getTaskDefinition(game);
    if (!taskDef?.executionRoleArn) {
      logger.error('Could not get execution role ARN', { game, taskDef });
      return {
        success: false,
        message: `Could not get execution role for '${game}'. Ensure the game's task definition exists (run terraform apply).`,
      };
    }

    const region = this.config.getRegion();
    const logGroup = `/ecs/filebrowser-${game}`;
    const family = `filebrowser-${game}`;

    logger.info('Registering FileBrowser task definition', { game, family, apId, logGroup });

    const registered = await this.ecs.registerTaskDefinition({
      family,
      networkMode: 'awsvpc',
      requiresCompatibilities: ['FARGATE'],
      cpu: '256',
      memory: '512',
      executionRoleArn: taskDef.executionRoleArn,
      volumes: [
        {
          name: 'game-data',
          efsVolumeConfiguration: {
            fileSystemId: outputs.efs_file_system_id,
            transitEncryption: 'ENABLED',
            authorizationConfig: { accessPointId: apId, iam: 'DISABLED' },
          },
        },
      ],
      containerDefinitions: [
        {
          name: 'filebrowser',
          image: FILEBROWSER_IMAGE,
          essential: true,
          // Use command flags instead of env vars — more reliable across image versions
          command: [
            '--noauth',
            '--root', '/srv',
            '--port', String(FILEBROWSER_PORT),
            '--address', '0.0.0.0',
            '--database', '/tmp/filebrowser.db',
          ],
          portMappings: [
            { containerPort: FILEBROWSER_PORT, hostPort: FILEBROWSER_PORT, protocol: 'tcp' },
          ],
          mountPoints: [{ sourceVolume: 'game-data', containerPath: '/srv', readOnly: false }],
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-group': logGroup,
              'awslogs-region': region,
              'awslogs-stream-prefix': 'ecs',
              'awslogs-create-group': 'true',
            },
          },
        },
      ],
    });

    if (!registered) {
      return { success: false, message: `Failed to register FileBrowser task definition for '${game}'. Check server logs.` };
    }

    const subnets = outputs.subnet_ids.split(',').map((s) => s.trim()).filter(Boolean);
    logger.info('Launching FileBrowser task', { game, subnets, sg: filemgrSg });

    const result = await this.ecs.runTask({
      cluster: outputs.ecs_cluster_name,
      taskDefinition: family,
      count: 1,
      launchType: 'FARGATE',
      startedBy: this.startedByKey(game),
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets,
          securityGroups: [filemgrSg],
          assignPublicIp: 'ENABLED',
        },
      },
    });

    if (result) {
      return {
        success: true,
        message: `File manager for '${game}' is starting. It will be ready in ~30 seconds.`,
        taskArn: result.taskArn,
      };
    }
    return { success: false, message: `Failed to launch file manager for '${game}'. Check server logs for details.` };
  }

  async stop(game: string): Promise<FileMgrResult> {
    const outputs = this.config.getTfOutputs();
    if (!outputs) return { success: false, message: 'Terraform not applied.' };

    const tasks = await this.ecs.listTasksByStartedBy(
      outputs.ecs_cluster_name,
      this.startedByKey(game),
    );

    if (!tasks.length) {
      return { success: false, message: `No file manager running for '${game}'.` };
    }

    const task = tasks[0] as Task;
    logger.info('Stopping file manager', { game, taskArn: task.taskArn });
    try {
      await this.ecs.stopTask(outputs.ecs_cluster_name, task.taskArn!, 'Stopped via management app');
      return { success: true, message: `File manager for '${game}' is stopping.` };
    } catch (err) {
      logger.error('Failed to stop file manager', { err, game });
      return { success: false, message: String(err) };
    }
  }
}
