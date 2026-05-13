import { Module } from '@nestjs/common';
import { ConfigService } from '../services/ConfigService.js';
import { Ec2Service } from '../services/Ec2Service.js';
import { EcsService } from '../services/EcsService.js';
import { LogsService } from '../services/LogsService.js';
import { CostService } from '../services/CostService.js';
import { FileManagerService } from '../services/FileManagerService.js';

/**
 * Feature module grouping every AWS-facing service (ECS, EC2, CloudWatch
 * Logs, Cost Explorer, the FileBrowser task helper) plus the `ConfigService`
 * they all depend on. Imported by `AppModule` so controllers get these via
 * Nest's DI without wiring each provider individually.
 */
@Module({
  providers: [ConfigService, Ec2Service, EcsService, LogsService, CostService, FileManagerService],
  exports: [ConfigService, Ec2Service, EcsService, LogsService, CostService, FileManagerService],
})
export class AwsModule {}
