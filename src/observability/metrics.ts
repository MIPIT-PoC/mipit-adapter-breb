import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

// Legacy per-rail metrics
export const brebPaymentsTotal = new client.Counter({
  name: 'mipit_adapter_breb_payments_total',
  help: 'Total Bre-B payments processed by this adapter',
  labelNames: ['status'],
  registers: [registry],
});

export const brebPaymentLatency = new client.Histogram({
  name: 'mipit_adapter_breb_payment_latency_ms',
  help: 'Bre-B payment processing latency in milliseconds',
  labelNames: ['status'],
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [registry],
});

export const brebRetryCount = new client.Counter({
  name: 'mipit_adapter_breb_retries_total',
  help: 'Total retry attempts for Bre-B payments',
  labelNames: ['outcome'], // P04: transient_retry | permanent_error | exhausted
  registers: [registry],
});

// P07 — Unified adapter metrics (rail label)
const RAIL = 'BRE_B';

export const adapterRequestsTotal = new client.Counter({
  name: 'mipit_adapter_requests_total',
  help: 'Total adapter requests by rail and status (P07 unified)',
  labelNames: ['rail', 'status'] as const,
  registers: [registry],
});

export const adapterLatencyMs = new client.Histogram({
  name: 'mipit_adapter_latency_ms',
  help: 'Adapter request latency in ms by rail',
  labelNames: ['rail'] as const,
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [registry],
});

export const adapterRetriesTotal = new client.Counter({
  name: 'mipit_adapter_retries_total',
  help: 'Adapter retries by rail',
  labelNames: ['rail'] as const,
  registers: [registry],
});

export const adapterErrorsTotal = new client.Counter({
  name: 'mipit_adapter_errors_total',
  help: 'Adapter errors by rail and error code',
  labelNames: ['rail', 'error'] as const,
  registers: [registry],
});

export function recordAdapterRequest(status: 'success' | 'rejected' | 'error', latencyMs?: number, errorCode?: string): void {
  brebPaymentsTotal.inc({ status });
  adapterRequestsTotal.inc({ rail: RAIL, status: status.toUpperCase() });
  if (latencyMs !== undefined) {
    brebPaymentLatency.observe({ status }, latencyMs);
    adapterLatencyMs.observe({ rail: RAIL }, latencyMs);
  }
  if (errorCode) {
    adapterErrorsTotal.inc({ rail: RAIL, error: errorCode });
  }
}
