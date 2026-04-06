/**
 * Mock Admin Control Routes — Bre-B (BRE_B)
 *
 * Allows the Bank Simulator Dashboard (UI) to control mock behavior:
 *   GET  /admin/config          → Current mock configuration
 *   POST /admin/config          → Update rejection rate, latency, toggle on/off
 *   POST /admin/reject-next     → Force the next payment to be rejected
 *   POST /admin/timeout-next    → Force the next payment to timeout
 *   POST /admin/reset           → Clear idempotency store and reset config
 *   GET  /admin/stats           → Processed payment statistics
 */

import type { Express } from 'express';
import { logger } from '../observability/logger.js';

export interface MockConfig {
  enabled: boolean;
  rejectionRate: number; // 0.0 to 1.0
  minLatencyMs: number;
  maxLatencyMs: number;
  forceRejectNext: boolean;
  forceTimeoutNext: boolean;
  forceRejectCode: string;
}

const defaultConfig: MockConfig = {
  enabled: true,
  rejectionRate: 0.10,
  minLatencyMs: 80,
  maxLatencyMs: 400,
  forceRejectNext: false,
  forceTimeoutNext: false,
  forceRejectCode: 'BREB001',
};

export const mockConfig: MockConfig = { ...defaultConfig };

export const mockStats = {
  totalReceived: 0,
  totalAccepted: 0,
  totalRejected: 0,
  totalTimeout: 0,
  lastPaymentAt: null as string | null,
};

export function registerAdminRoutes(
  app: Express,
  processedPayments: Map<string, unknown>,
): void {
  app.get('/admin/config', (_req, res) => {
    res.json({ config: mockConfig, rail: 'BRE_B' });
  });

  app.post('/admin/config', (req, res) => {
    const body = req.body as Partial<MockConfig>;

    if (body.enabled !== undefined) mockConfig.enabled = body.enabled;
    if (body.rejectionRate !== undefined) mockConfig.rejectionRate = Math.max(0, Math.min(1, body.rejectionRate));
    if (body.minLatencyMs !== undefined) mockConfig.minLatencyMs = Math.max(0, body.minLatencyMs);
    if (body.maxLatencyMs !== undefined) mockConfig.maxLatencyMs = Math.max(body.minLatencyMs ?? mockConfig.minLatencyMs, body.maxLatencyMs);
    if (body.forceRejectCode !== undefined) mockConfig.forceRejectCode = body.forceRejectCode;

    logger.info({ config: mockConfig }, 'Bre-B mock config updated via admin');
    res.json({ config: mockConfig, rail: 'BRE_B' });
  });

  app.post('/admin/reject-next', (_req, res) => {
    mockConfig.forceRejectNext = true;
    logger.info('Bre-B mock: next payment will be REJECTED');
    res.json({ message: 'Next Bre-B payment will be rejected', code: mockConfig.forceRejectCode });
  });

  app.post('/admin/timeout-next', (_req, res) => {
    mockConfig.forceTimeoutNext = true;
    logger.info('Bre-B mock: next payment will TIMEOUT');
    res.json({ message: 'Next Bre-B payment will timeout (30s delay)' });
  });

  app.post('/admin/reset', (_req, res) => {
    Object.assign(mockConfig, defaultConfig);
    processedPayments.clear();
    mockStats.totalReceived = 0;
    mockStats.totalAccepted = 0;
    mockStats.totalRejected = 0;
    mockStats.totalTimeout = 0;
    mockStats.lastPaymentAt = null;
    logger.info('Bre-B mock: config and state reset');
    res.json({ message: 'Bre-B mock reset to defaults', config: mockConfig });
  });

  app.get('/admin/stats', (_req, res) => {
    res.json({
      rail: 'BRE_B',
      ...mockStats,
      idempotencyStoreSize: processedPayments.size,
      config: mockConfig,
    });
  });
}
