import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  GetLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { LogsService } from './LogsService.js';
import type { ConfigService } from './ConfigService.js';

const cwMock = mockClient(CloudWatchLogsClient);

function makeConfig(): ConfigService {
  return { getRegion: () => 'us-east-1' } as unknown as ConfigService;
}

describe('LogsService', () => {
  let service: LogsService;

  beforeEach(() => {
    cwMock.reset();
    service = new LogsService(makeConfig());
  });

  it('returns "no streams" message when log group has no streams', async () => {
    cwMock.on(DescribeLogStreamsCommand).resolves({ logStreams: [] });
    const lines = await service.getRecentLogs('minecraft');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/no log streams/i);
  });

  it('uses /ecs/{game}-server log group and fetches newest stream', async () => {
    cwMock.on(DescribeLogStreamsCommand).resolves({
      logStreams: [{ logStreamName: 'ecs/stream1' }],
    });
    cwMock.on(GetLogEventsCommand).resolves({
      events: [{ message: 'line1' }, { message: 'line2' }],
    });

    const lines = await service.getRecentLogs('minecraft', 25);
    expect(lines).toEqual(['line1', 'line2']);

    const descInput = cwMock.commandCalls(DescribeLogStreamsCommand)[0]!.args[0].input;
    expect(descInput.logGroupName).toBe('/ecs/minecraft-server');
    expect(descInput.orderBy).toBe('LastEventTime');
    expect(descInput.descending).toBe(true);
    expect(descInput.limit).toBe(1);

    const getInput = cwMock.commandCalls(GetLogEventsCommand)[0]!.args[0].input;
    expect(getInput.logGroupName).toBe('/ecs/minecraft-server');
    expect(getInput.logStreamName).toBe('ecs/stream1');
    expect(getInput.limit).toBe(25);
    expect(getInput.startFromHead).toBe(false);
  });

  it('defaults event limit to 50', async () => {
    cwMock.on(DescribeLogStreamsCommand).resolves({
      logStreams: [{ logStreamName: 's' }],
    });
    cwMock.on(GetLogEventsCommand).resolves({ events: [] });
    await service.getRecentLogs('minecraft');
    const input = cwMock.commandCalls(GetLogEventsCommand)[0]!.args[0].input;
    expect(input.limit).toBe(50);
  });

  it('returns empty array when events undefined', async () => {
    cwMock.on(DescribeLogStreamsCommand).resolves({
      logStreams: [{ logStreamName: 's' }],
    });
    cwMock.on(GetLogEventsCommand).resolves({});
    const lines = await service.getRecentLogs('minecraft');
    expect(lines).toEqual([]);
  });

  it('maps missing event.message to empty string', async () => {
    cwMock.on(DescribeLogStreamsCommand).resolves({
      logStreams: [{ logStreamName: 's' }],
    });
    cwMock.on(GetLogEventsCommand).resolves({
      events: [{ message: 'a' }, {}],
    });
    const lines = await service.getRecentLogs('minecraft');
    expect(lines).toEqual(['a', '']);
  });

  it('returns an error message when the API throws', async () => {
    cwMock.on(DescribeLogStreamsCommand).rejects(new Error('denied'));
    const lines = await service.getRecentLogs('minecraft');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/error fetching logs for minecraft/i);
    expect(lines[0]).toContain('denied');
  });
});
