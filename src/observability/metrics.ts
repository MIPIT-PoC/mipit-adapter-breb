import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

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
