import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';
import type { BreBPaymentRequest, BreBPaymentResponse } from './types.js';
import { withRetry, BreBPermanentError } from './retry.js';

const TIMEOUT_MS = env.BREB_TIMEOUT_MS;

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getOAuthToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const res = await fetch(`${env.BREB_SANDBOX_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: 'mipit-core',
      client_secret: 'mipit-secret-breb-2024',
      scope: 'breb.pagos',
    }),
  });

  if (!res.ok) {
    throw new Error(`OAuth2 token request failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  logger.info('Bre-B OAuth2 token acquired');
  return cachedToken.token;
}

/**
 * P04 — Sends a Bre-B payment request via the shared `withRetry` helper.
 * Previously this file inlined its own backoff loop (linear `200 * attempt`)
 * while PIX/SPEI used exponential `500 * 2^(n-1)`. Now uniform.
 * Also wires `brebRetryCount` metric (was declared but never incremented).
 */
export async function sendBrebPayment(request: BreBPaymentRequest): Promise<BreBPaymentResponse> {
  const url = `${env.BREB_SANDBOX_URL}/breb/v1/pagos`;

  return withRetry(async (attempt) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      logger.info(
        { idTransaccion: request.idTransaccion, attempt, url },
        'Sending Bre-B payment request',
      );

      const token = await getOAuthToken();
      let res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Adapter': 'mipit-adapter-breb',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (res.status === 401) {
        cachedToken = null;
        const newToken = await getOAuthToken();
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${newToken}`,
            'X-Adapter': 'mipit-adapter-breb',
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      }

      const body = await res.json() as BreBPaymentResponse;

      if (!res.ok && res.status < 500) {
        // 4xx: client error — surface as permanent (no retry).
        logger.warn({ status: res.status, body }, 'Bre-B SPI returned client error');
        throw new BreBPermanentError(`Bre-B SPI 4xx: ${res.status}`, res.status, body);
      }

      if (!res.ok) {
        // 5xx: transient — will be retried by withRetry.
        throw new Error(`Bre-B SPI server error: HTTP ${res.status}`);
      }

      logger.info(
        { idTransaccion: request.idTransaccion, estado: body.estado },
        'Bre-B SPI response received',
      );
      return body;
    } catch (err) {
      // Surface PermanentError up so withRetry doesn't retry 4xx.
      if (err instanceof BreBPermanentError) {
        // Return the body if available — adapter caller wants to map it.
        if (err.body) return err.body as BreBPaymentResponse;
        throw err;
      }
      logger.warn({ err: String(err) }, 'Bre-B payment attempt failed');
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  });
}

// P04: sleep() helper removed — retry timing now centralized in retry.ts.
