import { Body, Controller, Get, Post } from '@nestjs/common';
import { ConfigService, type WatchdogConfig } from '../services/ConfigService.js';

@Controller('config')
export class ConfigController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  get(): WatchdogConfig {
    return this.config.getConfig();
  }

  @Post()
  update(@Body() body: Partial<WatchdogConfig>): { success: true; config: WatchdogConfig } {
    const current = this.config.getConfig();
    const updated: WatchdogConfig = {
      watchdog_interval_minutes: body.watchdog_interval_minutes ?? current.watchdog_interval_minutes,
      watchdog_idle_checks: body.watchdog_idle_checks ?? current.watchdog_idle_checks,
      watchdog_min_packets: body.watchdog_min_packets ?? current.watchdog_min_packets,
    };
    this.config.saveConfig(updated);
    return { success: true, config: updated };
  }
}
