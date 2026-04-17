import { Injectable } from '@nestjs/common';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from '@aws-sdk/client-cost-explorer';
import { logger } from '../logger.js';

const FARGATE_VCPU_PER_HOUR = 0.04048;
const FARGATE_GB_PER_HOUR = 0.004445;

export interface GameEstimate {
  vcpu: number;
  memoryGb: number;
  costPerHour: number;
  costPerDay24h: number;
  costPerMonth4hpd: number;
}

export interface CostEstimates {
  games: Record<string, GameEstimate>;
  totalPerHourIfAllOn: number;
}

export interface ActualCosts {
  daily: { date: string; cost: number }[];
  total: number;
  currency: string;
  days: number;
  error?: string;
}

@Injectable()
export class CostService {
  private client: CostExplorerClient | null = null;

  private getClient(): CostExplorerClient {
    if (!this.client) {
      // Cost Explorer is only available in us-east-1
      this.client = new CostExplorerClient({ region: 'us-east-1' });
    }
    return this.client;
  }

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
