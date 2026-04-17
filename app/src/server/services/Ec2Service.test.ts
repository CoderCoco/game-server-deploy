import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  EC2Client,
  DescribeNetworkInterfacesCommand,
} from '@aws-sdk/client-ec2';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { Ec2Service } from './Ec2Service.js';
import type { ConfigService } from './ConfigService.js';

const ec2Mock = mockClient(EC2Client);

function makeConfig(): ConfigService {
  return { getRegion: () => 'us-east-1' } as unknown as ConfigService;
}

describe('Ec2Service', () => {
  let service: Ec2Service;

  beforeEach(() => {
    ec2Mock.reset();
    service = new Ec2Service(makeConfig());
  });

  describe('getPublicIp', () => {
    it('returns the public IP when attached', async () => {
      ec2Mock.on(DescribeNetworkInterfacesCommand).resolves({
        NetworkInterfaces: [{ Association: { PublicIp: '54.1.2.3' } }],
      });
      expect(await service.getPublicIp('eni-abc')).toBe('54.1.2.3');
    });

    it('returns null when no association/public IP', async () => {
      ec2Mock.on(DescribeNetworkInterfacesCommand).resolves({
        NetworkInterfaces: [{}],
      });
      expect(await service.getPublicIp('eni-abc')).toBeNull();
    });

    it('returns null when no interfaces returned', async () => {
      ec2Mock.on(DescribeNetworkInterfacesCommand).resolves({ NetworkInterfaces: [] });
      expect(await service.getPublicIp('eni-abc')).toBeNull();
    });

    it('returns null on API error', async () => {
      ec2Mock.on(DescribeNetworkInterfacesCommand).rejects(new Error('boom'));
      expect(await service.getPublicIp('eni-abc')).toBeNull();
    });

    it('passes ENI id to the command', async () => {
      ec2Mock.on(DescribeNetworkInterfacesCommand).resolves({ NetworkInterfaces: [] });
      await service.getPublicIp('eni-123');
      const input = ec2Mock.commandCalls(DescribeNetworkInterfacesCommand)[0]!.args[0].input;
      expect(input.NetworkInterfaceIds).toEqual(['eni-123']);
    });
  });

  describe('getPrivateIp', () => {
    it('returns the private IP when present', async () => {
      ec2Mock.on(DescribeNetworkInterfacesCommand).resolves({
        NetworkInterfaces: [{ PrivateIpAddress: '10.0.1.5' }],
      });
      expect(await service.getPrivateIp('eni-abc')).toBe('10.0.1.5');
    });

    it('returns null when absent', async () => {
      ec2Mock.on(DescribeNetworkInterfacesCommand).resolves({ NetworkInterfaces: [{}] });
      expect(await service.getPrivateIp('eni-abc')).toBeNull();
    });

    it('returns null on API error', async () => {
      ec2Mock.on(DescribeNetworkInterfacesCommand).rejects(new Error('nope'));
      expect(await service.getPrivateIp('eni-abc')).toBeNull();
    });
  });
});
