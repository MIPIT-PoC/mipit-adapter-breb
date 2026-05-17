/**
 * P04 — Uniform retry helper for Bre-B adapter (mirrors PIX/SPEI's retry.ts).
 *
 * Before this file existed, `client.ts` inlined its own backoff loop with
 * a different math (`200 * attempt`) than PIX/SPEI (`500 * 2^(n-1)`), and
 * the `brebRetryCount` Prometheus counter was declared but never incremented.
 *
 * Now both happen in this shared helper. The client wraps its fetch in
 * `withRetry()` and the metric ticks on every backoff.
 */

import { brebRetryCount } from '../observability/metrics.js';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  jitter?: boolean;
}

/**
 * Permanent error — won't be retried (4xx-class semantically).
 * Throw this from the action to short-circuit the retry loop.
 */
export class BreBPermanentError extends Error {
  constructor(message: string, public statusCode?: number, public body?: unknown) {
    super(message);
    this.name = 'BreBPermanentError';
  }
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const jitter = opts.jitter ?? true;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const permanent = err instanceof BreBPermanentError;
      if (permanent || attempt === maxAttempts) {
        brebRetryCount.inc({ outcome: permanent ? 'permanent_error' : 'exhausted' });
        throw err;
      }
      brebRetryCount.inc({ outcome: 'transient_retry' });
      const expDelay = baseDelayMs * Math.pow(2, attempt - 1);
      const delay = jitter ? Math.random() * expDelay : expDelay;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
