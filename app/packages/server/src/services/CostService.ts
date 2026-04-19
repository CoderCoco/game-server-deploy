import { Injectable } from '@nestjs/common';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from '@aws-sdk/client-cost-explorer';
import { logger } from '../logger.js';

const FARGATE_VCPU_PER_HOUR = 0.04048;
const FARGATE_GB_PER_HOUR = 0.004445;

/** Per-game Fargate cost projection derived from its CPU/memory spec. */
export interface GameEstimate {
  vcpu: number;
  memoryGb: number;
  costPerHour: number;
  costPerDay24h: number;
  costPerMonth4hpd: number;
}

/** Aggregate of per-game estimates plus the cost if every game were running simultaneously. */
export interface CostEstimates {
  games: Record<string, GameEstimate>;
  totalPerHourIfAllOn: number;
}

/**
 * Actual-billed-cost snapshot for the Cost Explorer tab. `error` is set when
 * the Cost Explorer call failed so the UI can show a message instead of
 * silently rendering zeros.
 */
export interface ActualCosts {
  daily: { date: string; cost: number }[];
  total: number;
  currency: string;
  days: number;
  error?: string;
}

/**
 * Produces the numbers that back the Cost Explorer tab: static Fargate
 * estimates derived from each game's task-definition CPU/memory, and the
 * actual billed total pulled from AWS Cost Explorer (ECS + Fargate only).
 */
@Injectable()
export class CostService {
  private client: CostExplorerClient | null = null;

  /**
   * Lazily construct the Cost Explorer client. The service is only available
   * in `us-east-1`, so the region is hardcoded here regardless of where the
   * rest of the infra lives.
   */
  private getClient(): CostExplorerClient {
    if (!this.client) {
      // Cost Explorer is only available in us-east-1
      this.client = new CostExplorerClient({ region: 'us-east-1' });
    }
    return this.client;
  }

  /**
   * Translate a Fargate task's raw `cpu` (1024 = 1 vCPU) and `memory` (MiB)
   * into projected dollar costs. Pure arithmetic — no AWS calls — so it's
   * safe to run in a tight loop over every game.
   */
  estimateForSpec(cpuUnits: number, memoryMib: number): GameEstimate {
    const vcpu = cpuUnits / 1024;
    const memGb = memoryMib / 1024;
    const hourly = vcpu * FARGATE_VCPU_PER_HOUR + memGb * FARGATE_GB_PER_HOUR;
    return {
      vcpu,
      memoryGb: memGb,
      costPerHour: Math.round(hourly * 10000) / 10000,
      costPerDay24h: Math.round(hourly * 24 * 100) / 100,
      costPerMonth4hpd: Math.round(hourly * 4 * 30 * 100) / 100,
    };
  }

  /**
   * Pull daily billed cost for ECS + Fargate over the trailing `days` window
   * from Cost Explorer. Swallows errors into the returned `error` field so
   * the UI can keep rendering the rest of the dashboard if Cost Explorer is
   * unavailable or not yet enabled on the account.
   */
  async getActualCosts(days = 7): Promise<ActualCosts> {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    const fmt = (d: Date) => d.toISOString().split('T')[0]!;

    try {
      const resp = await this.getClient().send(
        new GetCostAndUsageCommand({
          TimePeriod: { Start: fmt(start), End: fmt(end) },
          Granularity: 'DAILY',
          Filter: {
            Dimensions: {
              Key: 'SERVICE',
              Values: ['Amazon Elastic Container Service', 'AWS Fargate'],
            },
          },
          Metrics: ['UnblendedCost'],
        }),
      );

      let total = 0;
      const daily = (resp.ResultsByTime ?? []).map((r) => {
        const cost = parseFloat(r.Total?.['UnblendedCost']?.Amount ?? '0');
        total += cost;
        return { date: r.TimePeriod?.Start ?? '', cost: Math.round(cost * 10000) / 10000 };
      });

      return { daily, total: Math.round(total * 100) / 100, currency: 'USD', days };
    } catch (err) {
      logger.error('Failed to fetch actual costs', { err });
      return { daily: [], total: 0, currency: 'USD', days, error: String(err) };
    }
  }
}
