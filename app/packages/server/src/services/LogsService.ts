import { Injectable } from '@nestjs/common';
import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  FilterLogEventsCommand,
  GetLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { logger } from '../logger.js';
import { ConfigService } from './ConfigService.js';

/**
 * Sleep for `ms` milliseconds, but reject immediately if `signal` is aborted.
 * Used by `streamLogs` so the poll loop exits promptly when the SSE client disconnects.
 */
function sleepInterruptible(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort);
  });
}

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
   * Async generator that polls `FilterLogEvents` every `pollInterval` ms and
   * yields new log lines as they arrive. De-duplicates by `eventId` so lines
   * are never emitted twice even when `startTime` windows overlap at the
   * boundary. The generator exits cleanly when `signal` is aborted (i.e.
   * when the SSE client disconnects).
   *
   * Queries the whole log group so that a stop+start of the ECS task
   * (which creates a new stream) is handled automatically without reconnecting.
   */
  async *streamLogs(
    game: string,
    signal: AbortSignal,
    pollInterval = 2000,
  ): AsyncGenerator<string> {
    const logGroup = `/ecs/${game}-server`;
    let startTime = Date.now();
    const seen = new Set<string>();

    while (!signal.aborted) {
      try {
        const resp = await this.getClient().send(
          new FilterLogEventsCommand({ logGroupName: logGroup, startTime, limit: 100 }),
          { abortSignal: signal },
        );
        for (const e of resp.events ?? []) {
          const id = e.eventId ?? `${e.timestamp}-${e.message}`;
          if (!seen.has(id)) {
            seen.add(id);
            yield e.message ?? '';
          }
          if ((e.timestamp ?? 0) >= startTime) {
            startTime = (e.timestamp ?? startTime) + 1;
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') break;
        logger.error('Log stream poll error', { err, game, logGroup });
        yield `[stream error] ${String(err)}`;
      }

      try {
        await sleepInterruptible(pollInterval, signal);
      } catch {
        break;
      }
    }
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
