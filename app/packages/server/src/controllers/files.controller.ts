import { Controller, Get, Param, Post } from '@nestjs/common';
import { FileManagerService } from '../services/FileManagerService.js';

@Controller('files')
export class FilesController {
  constructor(private readonly files: FileManagerService) {}

  @Get(':game')
  getStatus(@Param('game') game: string) {
    return this.files.getStatus(game);
  }

  @Post(':game/start')
  start(@Param('game') game: string) {
    return this.files.start(game);
  }

  @Post(':game/stop')
  stop(@Param('game') game: string) {
    return this.files.stop(game);
  }
}
