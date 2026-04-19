import { Controller, Get, Param, Query } from '@nestjs/common';
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
}
