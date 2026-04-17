import 'reflect-metadata';
import { container } from 'tsyringe';
import { ConfigService } from './services/ConfigService.js';
import { EcsService } from './services/EcsService.js';
import { Ec2Service } from './services/Ec2Service.js';
import { LogsService } from './services/LogsService.js';
import { CostService } from './services/CostService.js';
import { FileManagerService } from './services/FileManagerService.js';

container.registerSingleton(ConfigService);
container.registerSingleton(EcsService);
container.registerSingleton(Ec2Service);
container.registerSingleton(LogsService);
container.registerSingleton(CostService);
container.registerSingleton(FileManagerService);

export { container };
