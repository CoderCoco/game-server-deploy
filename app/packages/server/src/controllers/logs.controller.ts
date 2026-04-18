import { Controller, Get, Param, Query } from '@nestjs/common';
import { LogsService } from '../services/LogsService.js';

@Controller('logs')
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  @Get(':game')
  async getLogs(@Param('game') game: string, @Query('limit') limitRaw?: string) {
    const limit = parseInt(String(limitRaw ?? '50'), 10);
    const lines = await this.logs.getRecentLogs(game, limit);
    return { game, lines };
  }
}
