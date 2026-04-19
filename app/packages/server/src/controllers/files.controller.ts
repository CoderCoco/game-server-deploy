import { Controller, Get, Param, Post } from '@nestjs/common';
import { FileManagerService } from '../services/FileManagerService.js';

/** Endpoints for the ad-hoc EFS file-manager task (browse save files without a running game server). */
@Controller('files')
export class FilesController {
  constructor(private readonly files: FileManagerService) {}

  /** Returns whether a file-manager task is currently running for `game`, with connection details if so. */
  @Get(':game')
  getStatus(@Param('game') game: string) {
    return this.files.getStatus(game);
  }

  /** Launches an ECS task that mounts the game's EFS access point so the user can inspect/copy save data. */
  @Post(':game/start')
  start(@Param('game') game: string) {
    return this.files.start(game);
  }

  /** Stops the file-manager task for `game` (no-op if none is running). */
  @Post(':game/stop')
  stop(@Param('game') game: string) {
    return this.files.stop(game);
  }
}
