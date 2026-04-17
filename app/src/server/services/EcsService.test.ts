import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  ECSClient,
  ListTasksCommand,
  DescribeTasksCommand,
  RunTaskCommand,
  StopTaskCommand,
  DescribeTaskDefinitionCommand,
  RegisterTaskDefinitionCommand,
  type Task,
} from '@aws-sdk/client-ecs';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { EcsService } from './EcsService.js';
import type { ConfigService, TfOutputs } from './ConfigService.js';
import type { Ec2Service } from './Ec2Service.js';

const ecsMock = mockClient(ECSClient);

const DEFAULT_OUTPUTS: TfOutputs = {
  aws_region: 'us-east-1',
  ecs_cluster_name: 'game-cluster',
  ecs_cluster_arn: 'arn:aws:ecs:us-east-1:123:cluster/game-cluster',
  subnet_ids: 'subnet-a, subnet-b',
  security_group_id: 'sg-game',
  file_manager_security_group_id: 'sg-files',
  efs_file_system_id: 'fs-1',
  efs_access_points: { minecraft: 'fsap-1' },
  domain_name: 'example.com',
  game_names: ['minecraft'],
  alb_dns_name: null,
  acm_certificate_arn: null,
};

function makeConfig(outputs: TfOutputs | null = DEFAULT_OUTPUTS): ConfigService {
  return {
    getRegion: () => 'us-east-1',
    getTfOutputs: () => outputs,
  } as unknown as ConfigService;
}

function makeEc2(ip: string | null = '1.2.3.4'): Ec2Service {
  return { getPublicIp: vi.fn().mockResolvedValue(ip) } as unknown as Ec2Service;
}

describe('EcsService', () => {
  beforeEach(() => {
    ecsMock.reset();
  });

  describe('extractEniId', () => {
    it('returns ENI id from ElasticNetworkInterface attachment', () => {
      const service = new EcsService(makeConfig(), makeEc2());
      const task: Task = {
        attachments: [
          {
            type: 'ElasticNetworkInterface',
            details: [
              { name: 'subnetId', value: 'subnet-a' },
              { name: 'networkInterfaceId', value: 'eni-abc' },
            ],
          },
        ],
      };
      expect(service.extractEniId(task)).toBe('eni-abc');
    });

    it('returns null when no ENI attachment present', () => {
      const service = new EcsService(makeConfig(), makeEc2());
      expect(service.extractEniId({ attachments: [] })).toBeNull();
      expect(service.extractEniId({})).toBeNull();
    });

    it('ignores non-ENI attachment types', () => {
      const service = new EcsService(makeConfig(), makeEc2());
      const task: Task = {
        attachments: [
          {
            type: 'SomethingElse',
            details: [{ name: 'networkInterfaceId', value: 'eni-wrong' }],
          },
        ],
      };
      expect(service.extractEniId(task)).toBeNull();
    });
  });

  describe('findRunningTask', () => {
    it('returns null when no tasks listed', async () => {
      ecsMock.on(ListTasksCommand).resolves({ taskArns: [] });
      const service = new EcsService(makeConfig(), makeEc2());
      expect(await service.findRunningTask('cluster', 'minecraft')).toBeNull();
    });

    it('scopes list to {game}-server family and RUNNING desired status', async () => {
      ecsMock.on(ListTasksCommand).resolves({ taskArns: [] });
      const service = new EcsService(makeConfig(), makeEc2());
      await service.findRunningTask('my-cluster', 'factorio');
      const input = ecsMock.commandCalls(ListTasksCommand)[0]!.args[0].input;
      expect(input.family).toBe('factorio-server');
      expect(input.desiredStatus).toBe('RUNNING');
      expect(input.cluster).toBe('my-cluster');
    });

    it('filters out STOPPED and DEPROVISIONING tasks', async () => {
      ecsMock.on(ListTasksCommand).resolves({ taskArns: ['arn1', 'arn2'] });
      ecsMock.on(DescribeTasksCommand).resolves({
        tasks: [
          { taskArn: 'arn1', lastStatus: 'STOPPED' },
          { taskArn: 'arn2', lastStatus: 'RUNNING' },
        ],
      });
      const service = new EcsService(makeConfig(), makeEc2());
      const task = await service.findRunningTask('c', 'g');
      expect(task?.taskArn).toBe('arn2');
    });

    it('returns null on API errors', async () => {
      ecsMock.on(ListTasksCommand).rejects(new Error('api-fail'));
      const service = new EcsService(makeConfig(), makeEc2());
      expect(await service.findRunningTask('c', 'g')).toBeNull();
    });
  });

  describe('getStatus', () => {
    it('returns not_deployed when terraform outputs missing', async () => {
      const service = new EcsService(makeConfig(null), makeEc2());
      const status = await service.getStatus('minecraft');
      expect(status.state).toBe('not_deployed');
      expect(status.message).toMatch(/terraform apply/i);
    });

    it('returns running with public IP + hostname for RUNNING task', async () => {
      ecsMock.on(ListTasksCommand).resolves({ taskArns: ['arn1'] });
      ecsMock.on(DescribeTasksCommand).resolves({
        tasks: [
          {
            taskArn: 'arn1',
            lastStatus: 'RUNNING',
            attachments: [
              {
                type: 'ElasticNetworkInterface',
                details: [{ name: 'networkInterfaceId', value: 'eni-xyz' }],
              },
            ],
          },
        ],
      });
      const ec2 = makeEc2('9.9.9.9');
      const service = new EcsService(makeConfig(), ec2);
      const status = await service.getStatus('minecraft');
      expect(status.state).toBe('running');
      expect(status.publicIp).toBe('9.9.9.9');
      expect(status.hostname).toBe('minecraft.example.com');
      expect(ec2.getPublicIp).toHaveBeenCalledWith('eni-xyz');
    });

    it('returns starting when task not yet RUNNING', async () => {
      ecsMock.on(ListTasksCommand).resolves({ taskArns: ['arn1'] });
      ecsMock.on(DescribeTasksCommand).resolves({
        tasks: [{ taskArn: 'arn1', lastStatus: 'PROVISIONING' }],
      });
      const service = new EcsService(makeConfig(), makeEc2());
      const status = await service.getStatus('minecraft');
      expect(status.state).toBe('starting');
      expect(status.taskArn).toBe('arn1');
    });

    it('returns stopped when no running task', async () => {
      ecsMock.on(ListTasksCommand).resolves({ taskArns: [] });
      const service = new EcsService(makeConfig(), makeEc2());
      const status = await service.getStatus('minecraft');
      expect(status.state).toBe('stopped');
    });

    it('omits hostname when no domain_name configured', async () => {
      const outputs: TfOutputs = { ...DEFAULT_OUTPUTS, domain_name: '' };
      ecsMock.on(ListTasksCommand).resolves({ taskArns: ['arn1'] });
      ecsMock.on(DescribeTasksCommand).resolves({
        tasks: [{ taskArn: 'arn1', lastStatus: 'RUNNING', attachments: [] }],
      });
      const service = new EcsService(makeConfig(outputs), makeEc2(null));
      const status = await service.getStatus('minecraft');
      expect(status.state).toBe('running');
      expect(status.hostname).toBeUndefined();
    });
  });

  describe('start', () => {
    it('returns failure if terraform outputs missing', async () => {
      const service = new EcsService(makeConfig(null), makeEc2());
      const result = await service.start('minecraft');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/terraform apply/i);
    });

    it('refuses to start if a task is already running', async () => {
      ecsMock.on(ListTasksCommand).resolves({ taskArns: ['arn1'] });
      ecsMock.on(DescribeTasksCommand).resolves({
        tasks: [{ taskArn: 'arn1', lastStatus: 'RUNNING' }],
      });
      const service = new EcsService(makeConfig(), makeEc2());
      const result = await service.start('minecraft');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/already running/i);
    });

    it('launches task with correct cluster/family/subnets/SG when no running task', async () => {
      ecsMock.on(ListTasksCommand).resolves({ taskArns: [] });
      ecsMock.on(RunTaskCommand).resolves({ tasks: [{ taskArn: 'arn-new' }] });

      const service = new EcsService(makeConfig(), makeEc2());
      const result = await service.start('minecraft');

      expect(result.success).toBe(true);
      expect(result.taskArn).toBe('arn-new');
      const input = ecsMock.commandCalls(RunTaskCommand)[0]!.args[0].input;
      expect(input.cluster).toBe('game-cluster');
      expect(input.taskDefinition).toBe('minecraft-server');
      expect(input.launchType).toBe('FARGATE');
      expect(input.networkConfiguration?.awsvpcConfiguration?.subnets).toEqual(['subnet-a', 'subnet-b']);
      expect(input.networkConfiguration?.awsvpcConfiguration?.securityGroups).toEqual(['sg-game']);
      expect(input.networkConfiguration?.awsvpcConfiguration?.assignPublicIp).toBe('ENABLED');
    });

    it('returns failure with reason when RunTask reports failures', async () => {
      ecsMock.on(ListTasksCommand).resolves({ taskArns: [] });
      ecsMock.on(RunTaskCommand).resolves({
        tasks: [],
        failures: [{ reason: 'CAPACITY' }],
      });
      const service = new EcsService(makeConfig(), makeEc2());
      const result = await service.start('minecraft');
      expect(result.success).toBe(false);
      expect(result.message).toContain('CAPACITY');
    });

    it('returns failure when RunTask throws', async () => {
      ecsMock.on(ListTasksCommand).resolves({ taskArns: [] });
      ecsMock.on(RunTaskCommand).rejects(new Error('throttled'));
      const service = new EcsService(makeConfig(), makeEc2());
      const result = await service.start('minecraft');
      expect(result.success).toBe(false);
      expect(result.message).toContain('throttled');
    });
  });

  describe('stop', () => {
    it('returns failure if terraform outputs missing', async () => {
      const service = new EcsService(makeConfig(null), makeEc2());
      const result = await service.stop('minecraft');
      expect(result.success).toBe(false);
    });

    it('returns failure when nothing is running', async () => {
      ecsMock.on(ListTasksCommand).resolves({ taskArns: [] });
      const service = new EcsService(makeConfig(), makeEc2());
      const result = await service.stop('minecraft');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/not currently running/i);
    });

    it('stops task when found', async () => {
      ecsMock.on(ListTasksCommand).resolves({ taskArns: ['arn1'] });
      ecsMock.on(DescribeTasksCommand).resolves({
        tasks: [{ taskArn: 'arn1', lastStatus: 'RUNNING' }],
      });
      ecsMock.on(StopTaskCommand).resolves({});
      const service = new EcsService(makeConfig(), makeEc2());
      const result = await service.stop('minecraft');
      expect(result.success).toBe(true);
      const input = ecsMock.commandCalls(StopTaskCommand)[0]!.args[0].input;
      expect(input.task).toBe('arn1');
      expect(input.cluster).toBe('game-cluster');
    });

    it('returns failure when StopTask throws', async () => {
      ecsMock.on(ListTasksCommand).resolves({ taskArns: ['arn1'] });
      ecsMock.on(DescribeTasksCommand).resolves({
        tasks: [{ taskArn: 'arn1', lastStatus: 'RUNNING' }],
      });
      ecsMock.on(StopTaskCommand).rejects(new Error('stop-error'));
      const service = new EcsService(makeConfig(), makeEc2());
      const result = await service.stop('minecraft');
      expect(result.success).toBe(false);
      expect(result.message).toContain('stop-error');
    });
  });

  describe('getTaskDefinition', () => {
    it('parses cpu, memory, executionRoleArn from task definition', async () => {
      ecsMock.on(DescribeTaskDefinitionCommand).resolves({
        taskDefinition: {
          cpu: '512',
          memory: '1024',
          executionRoleArn: 'arn:aws:iam::123:role/exec',
        },
      });
      const service = new EcsService(makeConfig(), makeEc2());
      const td = await service.getTaskDefinition('minecraft');
      expect(td).toEqual({
        cpu: 512,
        memory: 1024,
        executionRoleArn: 'arn:aws:iam::123:role/exec',
      });
    });

    it('applies default cpu/memory when fields absent', async () => {
      ecsMock.on(DescribeTaskDefinitionCommand).resolves({
        taskDefinition: { executionRoleArn: 'arn:...' },
      });
      const service = new EcsService(makeConfig(), makeEc2());
      const td = await service.getTaskDefinition('minecraft');
      expect(td?.cpu).toBe(1024);
      expect(td?.memory).toBe(2048);
    });

    it('returns null when no taskDefinition returned', async () => {
      ecsMock.on(DescribeTaskDefinitionCommand).resolves({});
      const service = new EcsService(makeConfig(), makeEc2());
      expect(await service.getTaskDefinition('minecraft')).toBeNull();
    });

    it('returns null on error', async () => {
      ecsMock.on(DescribeTaskDefinitionCommand).rejects(new Error('bad'));
      const service = new EcsService(makeConfig(), makeEc2());
      expect(await service.getTaskDefinition('minecraft')).toBeNull();
    });
  });

  describe('registerTaskDefinition', () => {
    it('returns ARN on success', async () => {
      ecsMock.on(RegisterTaskDefinitionCommand).resolves({
        taskDefinition: { taskDefinitionArn: 'arn:aws:ecs:::task-definition/foo:1' },
      });
      const service = new EcsService(makeConfig(), makeEc2());
      const arn = await service.registerTaskDefinition({ family: 'foo' });
      expect(arn).toBe('arn:aws:ecs:::task-definition/foo:1');
    });

    it('returns null on error', async () => {
      ecsMock.on(RegisterTaskDefinitionCommand).rejects(new Error('nope'));
      const service = new EcsService(makeConfig(), makeEc2());
      expect(await service.registerTaskDefinition({ family: 'foo' })).toBeNull();
    });
  });

  describe('runTask', () => {
    it('returns taskArn when launch succeeds', async () => {
      ecsMock.on(RunTaskCommand).resolves({ tasks: [{ taskArn: 'arn-x' }] });
      const service = new EcsService(makeConfig(), makeEc2());
      const result = await service.runTask({
        cluster: 'c',
        taskDefinition: 'td',
        launchType: 'FARGATE',
      });
      expect(result).toEqual({ taskArn: 'arn-x' });
    });

    it('returns null when RunTask reports failures', async () => {
      ecsMock.on(RunTaskCommand).resolves({
        tasks: [],
        failures: [{ reason: 'CAPACITY' }],
      });
      const service = new EcsService(makeConfig(), makeEc2());
      expect(
        await service.runTask({ cluster: 'c', taskDefinition: 'td' }),
      ).toBeNull();
    });

    it('returns null on error', async () => {
      ecsMock.on(RunTaskCommand).rejects(new Error('boom'));
      const service = new EcsService(makeConfig(), makeEc2());
      expect(await service.runTask({ cluster: 'c', taskDefinition: 'td' })).toBeNull();
    });
  });

  describe('listTasksByStartedBy', () => {
    it('returns empty when no task ARNs match', async () => {
      ecsMock.on(ListTasksCommand).resolves({ taskArns: [] });
      const service = new EcsService(makeConfig(), makeEc2());
      expect(await service.listTasksByStartedBy('c', 'filemgr-minecraft')).toEqual([]);
    });

    it('filters out STOPPED/DEPROVISIONING tasks', async () => {
      ecsMock.on(ListTasksCommand).resolves({ taskArns: ['a', 'b', 'c'] });
      ecsMock.on(DescribeTasksCommand).resolves({
        tasks: [
          { taskArn: 'a', lastStatus: 'RUNNING' },
          { taskArn: 'b', lastStatus: 'STOPPED' },
          { taskArn: 'c', lastStatus: 'DEPROVISIONING' },
        ],
      });
      const service = new EcsService(makeConfig(), makeEc2());
      const tasks = await service.listTasksByStartedBy('cluster', 'key');
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.taskArn).toBe('a');
    });

    it('returns empty array on error', async () => {
      ecsMock.on(ListTasksCommand).rejects(new Error('err'));
      const service = new EcsService(makeConfig(), makeEc2());
      expect(await service.listTasksByStartedBy('c', 'k')).toEqual([]);
    });
  });

  describe('stopTask', () => {
    it('sends StopTaskCommand with provided args', async () => {
      ecsMock.on(StopTaskCommand).resolves({});
      const service = new EcsService(makeConfig(), makeEc2());
      await service.stopTask('cluster', 'arn', 'because');
      const input = ecsMock.commandCalls(StopTaskCommand)[0]!.args[0].input;
      expect(input.cluster).toBe('cluster');
      expect(input.task).toBe('arn');
      expect(input.reason).toBe('because');
    });
  });
});
