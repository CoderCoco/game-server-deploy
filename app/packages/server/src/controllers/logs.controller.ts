import { Controller, Get, MessageEvent, Param, Query, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { LogsService } from '../services/LogsService.js';

/** Tails CloudWatch logs from the `/ecs/{game}-server` log group. */
@Controller('logs')
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  /** Returns the most recent `limit` (default 50) log lines for a game's ECS task. */
  @Get(':game')
  async getLogs(@Param('game') game: string, @Query('limit') limitRaw?: string) {
    const limit = parseInt(String(limitRaw ?? '50'), 10);
    const lines = await this.logs.getRecentLogs(game, limit);
    return { game, lines };
  }

  /**
   * SSE stream of new log lines for a game, delivered as they arrive from
   * `FilterLogEvents`. The client receives `{ data: { line: "..." } }` events.
   * Auth: `Authorization: Bearer` header OR `?token=` query param (the latter
   * is required because the browser's native `EventSource` cannot set headers).
   */
  @Sse(':game/stream')
  streamLogs(@Param('game') game: string): Observable<MessageEvent> {
    const ac = new AbortController();

    return new Observable<MessageEvent>((subscriber) => {
      const run = async () => {
        try {
          for await (const line of this.logs.streamLogs(game, ac.signal)) {
            subscriber.next({ data: { line } } as MessageEvent);
          }
          subscriber.complete();
        } catch (err) {
          if ((err as Error).name === 'AbortError') {
            subscriber.complete();
          } else {
            subscriber.error(err);
          }
        }
      };
      void run();

      return () => ac.abort();
    });
  }
}
