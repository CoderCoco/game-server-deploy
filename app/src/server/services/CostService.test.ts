import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from '@aws-sdk/client-cost-explorer';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { CostService } from './CostService.js';

const ceMock = mockClient(CostExplorerClient);

describe('CostService', () => {
  let service: CostService;

  beforeEach(() => {
    ceMock.reset();
    service = new CostService();
  });

  describe('estimateForSpec', () => {
    it('computes Fargate hourly / daily / monthly costs for 1 vCPU + 2 GiB', () => {
      const est = service.estimateForSpec(1024, 2048);
      expect(est.vcpu).toBe(1);
      expect(est.memoryGb).toBe(2);
      // 1 * 0.04048 + 2 * 0.004445 = 0.04937
      expect(est.costPerHour).toBeCloseTo(0.0494, 4);
      // 0.04937 * 24 = 1.18488 -> 1.18
      expect(est.costPerDay24h).toBeCloseTo(1.18, 2);
      // 0.04937 * 4 * 30 = 5.9244 -> 5.92
      expect(est.costPerMonth4hpd).toBeCloseTo(5.92, 2);
    });

    it('scales linearly with CPU and memory', () => {
      const half = service.estimateForSpec(512, 1024);
      const full = service.estimateForSpec(1024, 2048);
      expect(half.costPerHour).toBeCloseTo(full.costPerHour / 2, 6);
    });

    it('rounds hourly cost to 4 decimals and daily/monthly to 2 decimals', () => {
      const est = service.estimateForSpec(256, 512);
      expect(Number.isFinite(est.costPerHour)).toBe(true);
      const hourStr = est.costPerHour.toString();
      const decimals = hourStr.split('.')[1] ?? '';
      expect(decimals.length).toBeLessThanOrEqual(4);
    });
  });

  describe('getActualCosts', () => {
    it('aggregates daily costs and returns total', async () => {
      ceMock.on(GetCostAndUsageCommand).resolves({
        ResultsByTime: [
          { TimePeriod: { Start: '2026-04-10', End: '2026-04-11' }, Total: { UnblendedCost: { Amount: '1.2345', Unit: 'USD' } } },
          { TimePeriod: { Start: '2026-04-11', End: '2026-04-12' }, Total: { UnblendedCost: { Amount: '2.5000', Unit: 'USD' } } },
        ],
      });

      const result = await service.getActualCosts(2);
      expect(result.days).toBe(2);
      expect(result.currency).toBe('USD');
      expect(result.daily).toEqual([
        { date: '2026-04-10', cost: 1.2345 },
        { date: '2026-04-11', cost: 2.5 },
      ]);
      // 1.2345 + 2.5 = 3.7345 -> rounded to 2 decimals = 3.73
      expect(result.total).toBeCloseTo(3.73, 2);
      expect(result.error).toBeUndefined();
    });

    it('filters by ECS and Fargate services', async () => {
      ceMock.on(GetCostAndUsageCommand).resolves({ ResultsByTime: [] });
      await service.getActualCosts(7);
      const calls = ceMock.commandCalls(GetCostAndUsageCommand);
      expect(calls).toHaveLength(1);
      const input = calls[0]!.args[0].input;
      expect(input.Filter?.Dimensions?.Key).toBe('SERVICE');
      expect(input.Filter?.Dimensions?.Values).toEqual([
        'Amazon Elastic Container Service',
        'AWS Fargate',
      ]);
      expect(input.Granularity).toBe('DAILY');
      expect(input.Metrics).toEqual(['UnblendedCost']);
    });

    it('returns error shape when Cost Explorer throws', async () => {
      ceMock.on(GetCostAndUsageCommand).rejects(new Error('AccessDenied'));
      const result = await service.getActualCosts(7);
      expect(result.total).toBe(0);
      expect(result.daily).toEqual([]);
      expect(result.days).toBe(7);
      expect(result.error).toContain('AccessDenied');
    });

    it('handles missing cost amount gracefully', async () => {
      ceMock.on(GetCostAndUsageCommand).resolves({
        ResultsByTime: [{ TimePeriod: { Start: '2026-04-10' }, Total: {} }],
      });
      const result = await service.getActualCosts(1);
      expect(result.daily).toEqual([{ date: '2026-04-10', cost: 0 }]);
      expect(result.total).toBe(0);
    });

    it('defaults to 7 days when called with no argument', async () => {
      ceMock.on(GetCostAndUsageCommand).resolves({ ResultsByTime: [] });
      const result = await service.getActualCosts();
      expect(result.days).toBe(7);
    });
  });
});
