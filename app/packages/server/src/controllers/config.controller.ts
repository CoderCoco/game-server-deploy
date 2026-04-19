import { Body, Controller, Get, Post } from '@nestjs/common';
import { ConfigService, type WatchdogConfig } from '../services/ConfigService.js';

/** Exposes the watchdog tuning knobs stored in `server_config.json` (idle-check cadence, thresholds). */
@Controller('config')
export class ConfigController {
  constructor(private readonly config: ConfigService) {}

  /** Returns the current watchdog config (interval, idle-check count, min packets). */
  @Get()
  get(): WatchdogConfig {
    return this.config.getConfig();
  }

  /**
   * Partially updates the watchdog config on disk. Any omitted field keeps its
   * current value. These settings are read by the app but baked into the
   * watchdog Lambda at `terraform apply` time, so changes here only take effect
   * after the next apply.
   */
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
