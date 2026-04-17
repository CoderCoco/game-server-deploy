import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import type { Task } from '@aws-sdk/client-ecs';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { FileManagerService } from './FileManagerService.js';
import type { ConfigService, TfOutputs } from './ConfigService.js';
import type { EcsService } from './EcsService.js';
import type { Ec2Service } from './Ec2Service.js';

const DEFAULT_OUTPUTS: TfOutputs = {
  aws_region: 'us-east-1',
  ecs_cluster_name: 'game-cluster',
  ecs_cluster_arn: 'arn:...',
  subnet_ids: 'subnet-a,subnet-b',
  security_group_id: 'sg-game',
  file_manager_security_group_id: 'sg-files',
  efs_file_system_id: 'fs-1',
  efs_access_points: { minecraft: 'fsap-mc' },
  domain_name: 'example.com',
  game_names: ['minecraft'],
  alb_dns_name: null,
  acm_certificate_arn: null,
};

type EcsStub = {
  listTasksByStartedBy: ReturnType<typeof vi.fn>;
  extractEniId: ReturnType<typeof vi.fn>;
  getTaskDefinition: ReturnType<typeof vi.fn>;
  registerTaskDefinition: ReturnType<typeof vi.fn>;
  runTask: ReturnType<typeof vi.fn>;
  stopTask: ReturnType<typeof vi.fn>;
};

function makeConfig(outputs: TfOutputs | null = DEFAULT_OUTPUTS): ConfigService {
  return {
    getTfOutputs: () => outputs,
    getRegion: () => 'us-east-1',
  } as unknown as ConfigService;
}

function makeEcs(overrides: Partial<EcsStub> = {}): EcsService & EcsStub {
  return {
    listTasksByStartedBy: vi.fn().mockResolvedValue([]),
    extractEniId: vi.fn().mockReturnValue(null),
    getTaskDefinition: vi.fn().mockResolvedValue({
      cpu: 1024,
      memory: 2048,
      executionRoleArn: 'arn:aws:iam::123:role/exec',
    }),
    registerTaskDefinition: vi.fn().mockResolvedValue('arn:aws:ecs:::task-definition/filebrowser-minecraft:1'),
    runTask: vi.fn().mockResolvedValue({ taskArn: 'arn-fm' }),
    stopTask: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as EcsService & EcsStub;
}

function makeEc2(ip: string | null = '1.2.3.4'): Ec2Service {
  return { getPublicIp: vi.fn().mockResolvedValue(ip) } as unknown as Ec2Service;
}

describe('FileManagerService', () => {
  describe('getStatus', () => {
    it('returns not_deployed when terraform outputs missing', async () => {
      const svc = new FileManagerService(makeConfig(null), makeEcs(), makeEc2());
      expect((await svc.getStatus('minecraft')).state).toBe('not_deployed');
    });

    it('returns stopped when no tasks exist', async () => {
      const ecs = makeEcs({ listTasksByStartedBy: vi.fn().mockResolvedValue([]) });
      const svc = new FileManagerService(makeConfig(), ecs, makeEc2());
      expect((await svc.getStatus('minecraft')).state).toBe('stopped');
      expect(ecs.listTasksByStartedBy).toHaveBeenCalledWith('game-cluster', 'filemgr-minecraft');
    });

    it('returns running with URL built from public IP on port 8080', async () => {
      const task: Task = { taskArn: 'arn-fm', lastStatus: 'RUNNING' };
      const ecs = makeEcs({
        listTasksByStartedBy: vi.fn().mockResolvedValue([task]),
        extractEniId: vi.fn().mockReturnValue('eni-1'),
      });
      const svc = new FileManagerService(makeConfig(), ecs, makeEc2('5.6.7.8'));
      const status = await svc.getStatus('minecraft');
      expect(status.state).toBe('running');
      expect(status.url).toBe('http://5.6.7.8:8080');
      expect(status.taskArn).toBe('arn-fm');
    });

    it('returns running without URL when public IP cannot be resolved', async () => {
      const ecs = makeEcs({
        listTasksByStartedBy: vi.fn().mockResolvedValue([{ lastStatus: 'RUNNING' }]),
        extractEniId: vi.fn().mockReturnValue('eni-1'),
      });
      const svc = new FileManagerService(makeConfig(), ecs, makeEc2(null));
      const status = await svc.getStatus('minecraft');
      expect(status.state).toBe('running');
      expect(status.url).toBeUndefined();
    });

    it('returns starting when task not yet running', async () => {
      const ecs = makeEcs({
        listTasksByStartedBy: vi.fn().mockResolvedValue([{ taskArn: 'arn-fm', lastStatus: 'PROVISIONING' }]),
      });
      const svc = new FileManagerService(makeConfig(), ecs, makeEc2());
      const status = await svc.getStatus('minecraft');
      expect(status.state).toBe('starting');
      expect(status.taskArn).toBe('arn-fm');
    });
  });

  describe('start', () => {
    it('fails if terraform outputs missing', async () => {
      const svc = new FileManagerService(makeConfig(null), makeEcs(), makeEc2());
      const result = await svc.start('minecraft');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/terraform apply/i);
    });

    it('fails when game has no EFS access point', async () => {
      const outputs: TfOutputs = { ...DEFAULT_OUTPUTS, efs_access_points: {} };
      const svc = new FileManagerService(makeConfig(outputs), makeEcs(), makeEc2());
      const result = await svc.start('minecraft');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/no efs access point/i);
    });

    it('fails when file_manager_security_group_id not set', async () => {
      const outputs: TfOutputs = { ...DEFAULT_OUTPUTS, file_manager_security_group_id: '' };
      const svc = new FileManagerService(makeConfig(outputs), makeEcs(), makeEc2());
      const result = await svc.start('minecraft');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/file_manager_security_group_id/);
    });

    it('fails when file manager is already running', async () => {
      const ecs = makeEcs({
        listTasksByStartedBy: vi.fn().mockResolvedValue([{ taskArn: 'existing' }]),
      });
      const svc = new FileManagerService(makeConfig(), ecs, makeEc2());
      const result = await svc.start('minecraft');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/already running/i);
    });

    it('fails when the game task definition has no execution role', async () => {
      const ecs = makeEcs({
        getTaskDefinition: vi.fn().mockResolvedValue(null),
      });
      const svc = new FileManagerService(makeConfig(), ecs, makeEc2());
      const result = await svc.start('minecraft');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/execution role/i);
    });

    it('registers a filebrowser task definition then runs it', async () => {
      const ecs = makeEcs();
      const svc = new FileManagerService(makeConfig(), ecs, makeEc2());
      const result = await svc.start('minecraft');

      expect(result.success).toBe(true);
      expect(result.taskArn).toBe('arn-fm');

      const regArgs = ecs.registerTaskDefinition.mock.calls[0]![0];
      expect(regArgs.family).toBe('filebrowser-minecraft');
      expect(regArgs.networkMode).toBe('awsvpc');
      expect(regArgs.requiresCompatibilities).toEqual(['FARGATE']);
      expect(regArgs.cpu).toBe('256');
      expect(regArgs.memory).toBe('512');
      expect(regArgs.executionRoleArn).toBe('arn:aws:iam::123:role/exec');

      const volume = regArgs.volumes[0];
      expect(volume.efsVolumeConfiguration.fileSystemId).toBe('fs-1');
      expect(volume.efsVolumeConfiguration.authorizationConfig.accessPointId).toBe('fsap-mc');
      expect(volume.efsVolumeConfiguration.transitEncryption).toBe('ENABLED');

      const container = regArgs.containerDefinitions[0];
      expect(container.image).toContain('filebrowser');
      expect(container.portMappings[0].containerPort).toBe(8080);
      expect(container.mountPoints[0].containerPath).toBe('/srv');
      expect(container.command).toContain('--noauth');
      expect(container.logConfiguration.options['awslogs-group']).toBe('/ecs/filebrowser-minecraft');
      expect(container.logConfiguration.options['awslogs-region']).toBe('us-east-1');

      const runArgs = ecs.runTask.mock.calls[0]![0];
      expect(runArgs.cluster).toBe('game-cluster');
      expect(runArgs.taskDefinition).toBe('filebrowser-minecraft');
      expect(runArgs.startedBy).toBe('filemgr-minecraft');
      expect(runArgs.networkConfiguration.awsvpcConfiguration.subnets).toEqual(['subnet-a', 'subnet-b']);
      expect(runArgs.networkConfiguration.awsvpcConfiguration.securityGroups).toEqual(['sg-files']);
      expect(runArgs.networkConfiguration.awsvpcConfiguration.assignPublicIp).toBe('ENABLED');
    });

    it('fails when task-definition registration returns null', async () => {
      const ecs = makeEcs({
        registerTaskDefinition: vi.fn().mockResolvedValue(null),
      });
      const svc = new FileManagerService(makeConfig(), ecs, makeEc2());
      const result = await svc.start('minecraft');
      expect(result.success).toBe(false);
      expect(ecs.runTask).not.toHaveBeenCalled();
    });

    it('fails when runTask returns null', async () => {
      const ecs = makeEcs({
        runTask: vi.fn().mockResolvedValue(null),
      });
      const svc = new FileManagerService(makeConfig(), ecs, makeEc2());
      const result = await svc.start('minecraft');
      expect(result.success).toBe(false);
    });
  });

  describe('stop', () => {
    it('fails when outputs missing', async () => {
      const svc = new FileManagerService(makeConfig(null), makeEcs(), makeEc2());
      expect((await svc.stop('minecraft')).success).toBe(false);
    });

    it('fails when no file manager running', async () => {
      const ecs = makeEcs({ listTasksByStartedBy: vi.fn().mockResolvedValue([]) });
      const svc = new FileManagerService(makeConfig(), ecs, makeEc2());
      const result = await svc.stop('minecraft');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/no file manager running/i);
    });

    it('stops the first task when running', async () => {
      const ecs = makeEcs({
        listTasksByStartedBy: vi.fn().mockResolvedValue([{ taskArn: 'arn-1' }]),
      });
      const svc = new FileManagerService(makeConfig(), ecs, makeEc2());
      const result = await svc.stop('minecraft');
      expect(result.success).toBe(true);
      expect(ecs.stopTask).toHaveBeenCalledWith('game-cluster', 'arn-1', expect.any(String));
    });

    it('returns failure when stopTask throws', async () => {
      const ecs = makeEcs({
        listTasksByStartedBy: vi.fn().mockResolvedValue([{ taskArn: 'arn-1' }]),
        stopTask: vi.fn().mockRejectedValue(new Error('nope')),
      });
      const svc = new FileManagerService(makeConfig(), ecs, makeEc2());
      const result = await svc.stop('minecraft');
      expect(result.success).toBe(false);
      expect(result.message).toContain('nope');
    });
  });
});
