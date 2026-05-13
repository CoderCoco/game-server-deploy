import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '../services/ConfigService.js';

/**
 * Environment metadata endpoint. Returns deployment-level info (region, domain)
 * for UI display — e.g., the top bar env pill that shows "PROD · us-east-1".
 */
@Controller()
export class EnvController {
  constructor(private readonly config: ConfigService) {}

  /**
   * Returns environment context derived from Terraform outputs. The UI uses
   * this to show the active region + environment label in the top bar.
   */
  @Get('env')
  getEnv(): { region: string; domain: string; environment: string } {
    const outputs = this.config.getTfOutputs();
    const region = outputs?.aws_region ?? 'local';
    const domain = outputs?.domain_name ?? '';

    // Derive environment label from domain or fall back to 'local'
    // This is purely cosmetic for the UI — not a security gate
    const environment = domain ? 'PROD' : 'local';

    return { region, domain, environment };
  }
}
