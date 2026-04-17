import { injectable } from 'tsyringe';
import { EC2Client, DescribeNetworkInterfacesCommand } from '@aws-sdk/client-ec2';
import { logger } from '../logger.js';
import { ConfigService } from './ConfigService.js';

@injectable()
export class Ec2Service {
  private client: EC2Client | null = null;

  constructor(private readonly config: ConfigService) {}

  private getClient(): EC2Client {
    if (!this.client) {
      this.client = new EC2Client({ region: this.config.getRegion() });
    }
    return this.client;
  }

  async getPublicIp(eniId: string): Promise<string | null> {
    try {
      const resp = await this.getClient().send(
        new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [eniId] }),
      );
      const ip = resp.NetworkInterfaces?.[0]?.Association?.PublicIp ?? null;
      logger.debug('Resolved public IP', { eniId, ip });
      return ip;
    } catch (err) {
      logger.error('Failed to resolve public IP', { err, eniId });
      return null;
    }
  }

  async getPrivateIp(eniId: string): Promise<string | null> {
    try {
      const resp = await this.getClient().send(
        new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [eniId] }),
      );
      const ip = resp.NetworkInterfaces?.[0]?.PrivateIpAddress ?? null;
      logger.debug('Resolved private IP', { eniId, ip });
      return ip;
    } catch (err) {
      logger.error('Failed to resolve private IP', { err, eniId });
      return null;
    }
  }
}
