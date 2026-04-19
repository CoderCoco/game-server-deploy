import { Injectable } from '@nestjs/common';
import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { logger } from '../logger.js';
import { ConfigService } from './ConfigService.js';

/**
 * Fetches recent CloudWatch Logs lines for a game's ECS task so the UI can
 * render a tail. Assumes the Terraform-provisioned log group naming
 * convention `/ecs/{game}-server`.
 */
@Injectable()
export class LogsService {
  private client: CloudWatchLogsClient | null = null;

  constructor(private readonly config: ConfigService) {}

  private getClient(): CloudWatchLogsClient {
    if (!this.client) {
      this.client = new CloudWatchLogsClient({ region: this.config.getRegion() });
    }
    return this.client;
  }

  /**
   * Return up to `limit` recent messages from the most recently written log
   * stream in `/ecs/{game}-server`. Errors are folded into a single-element
   * array so the caller always renders *something* — failures in the logs
   * tab shouldn't take the rest of the dashboard down.
   */
  async getRecentLogs(game: string, limit = 50): Promise<string[]> {
    const logGroup = `/ecs/${game}-server`;
    try {
      const streams = await this.getClient().send(
        new DescribeLogStreamsCommand({
          logGroupName: logGroup,
          orderBy: 'LastEventTime',
          descending: true,
          limit: 1,
        }),
      );
      if (!streams.logStreams?.length) {
        return [`No log streams found for ${game}.`];
      }
      const streamName = streams.logStreams[0]!.logStreamName!;
      const events = await this.getClient().send(
        new GetLogEventsCommand({
          logGroupName: logGroup,
          logStreamName: streamName,
          limit,
          startFromHead: false,
        }),
      );
      return events.events?.map((e) => e.message ?? '') ?? [];
    } catch (err) {
      logger.error('Failed to fetch logs', { err, game, logGroup });
      return [`Error fetching logs for ${game}: ${String(err)}`];
    }
  }
}
