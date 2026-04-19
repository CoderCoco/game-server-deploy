import { Module } from '@nestjs/common';
import { ConfigService } from '../services/ConfigService.js';
import { Ec2Service } from '../services/Ec2Service.js';
import { EcsService } from '../services/EcsService.js';
import { LogsService } from '../services/LogsService.js';
import { CostService } from '../services/CostService.js';
import { FileManagerService } from '../services/FileManagerService.js';

@Module({
  providers: [ConfigService, Ec2Service, EcsService, LogsService, CostService, FileManagerService],
  exports: [ConfigService, Ec2Service, EcsService, LogsService, CostService, FileManagerService],
})
export class AwsModule {}
