import { Controller, Get, Param, Post } from '@nestjs/common';
import { ConfigService } from '../services/ConfigService.js';
import { EcsService } from '../services/EcsService.js';

@Controller()
export class GamesController {
  constructor(
    private readonly config: ConfigService,
    private readonly ecs: EcsService,
  ) {}

  @Get('games')
  listGames(): { games: string[] } {
    this.config.invalidateCache();
    const outputs = this.config.getTfOutputs();
    return { games: outputs?.game_names ?? [] };
  }

  @Get('status')
  async listStatus() {
    this.config.invalidateCache();
    const outputs = this.config.getTfOutputs();
    if (!outputs) return [];
    return Promise.all(outputs.game_names.map((g) => this.ecs.getStatus(g)));
  }

  @Get('status/:game')
  getStatus(@Param('game') game: string) {
    return this.ecs.getStatus(game);
  }

  @Post('start/:game')
  start(@Param('game') game: string) {
    return this.ecs.start(game);
  }

  @Post('stop/:game')
  stop(@Param('game') game: string) {
    return this.ecs.stop(game);
  }
}
